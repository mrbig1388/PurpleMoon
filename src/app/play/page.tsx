/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { Download, Heart } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import {
  getCustomFingerprints,
  installAdLearnHelpers,
  rememberRawPlaylist,
} from '@/lib/ad-learn';
import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { useDownload } from '@/lib/Download/DownloadContext';
import DownloadEpisodeSelector from '@/lib/Download/DownloadEpisodeSelector';
import {
  filterAdsFromM3U8,
  stripDiscontinuityLegacy,
} from '@/lib/m3u8-ad-filter';
import { SearchResult } from '@/lib/types';
import {
  getArtPlayerType,
  getVideoResolutionFromM3u8,
  processImageUrl,
  VideoSourceTestResult,
} from '@/lib/utils';

import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

// Wake Lock API 类型声明
interface WakeLockSentinel extends EventTarget {
  readonly released: boolean;
  readonly type: 'screen';
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

const PLAYER_PLAYBACK_RATE_KEY = 'moontv_player_playback_rate';
const DEFAULT_PLAYBACK_RATE = 1;
const ALLOWED_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

const sanitizePlaybackRate = (rate?: number | null): number => {
  if (typeof rate !== 'number' || Number.isNaN(rate)) {
    return DEFAULT_PLAYBACK_RATE;
  }
  const matched = ALLOWED_PLAYBACK_RATES.find(
    (allowed) => Math.abs(allowed - rate) < 0.001
  );
  return matched ?? DEFAULT_PLAYBACK_RATE;
};

const loadPlaybackRate = (): number => {
  if (typeof window === 'undefined') {
    return DEFAULT_PLAYBACK_RATE;
  }
  try {
    const raw = localStorage.getItem(PLAYER_PLAYBACK_RATE_KEY);
    if (!raw) return DEFAULT_PLAYBACK_RATE;
    const parsed = parseFloat(raw);
    return sanitizePlaybackRate(parsed);
  } catch {
    return DEFAULT_PLAYBACK_RATE;
  }
};

// 规范化年份字符串：提取四位数字年份；支持 "unknown" / 空值处理
function normalizeYearForMatch(year?: string): string {
  if (!year) return '';
  const trimmed = year.trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return '';
  const match = trimmed.match(/\d{4}/);
  return match ? match[0] : '';
}

// 判断候选源年份是否满足期望年份
function matchesRequestedYear(
  candidateYear?: string,
  requestedYear?: string
): boolean {
  const reqNorm = normalizeYearForMatch(requestedYear);
  if (!reqNorm) return true;
  const candNorm = normalizeYearForMatch(candidateYear);
  if (!candNorm) return true;
  return candNorm === reqNorm;
}

// 阿拉伯数字与中文数字互转映射
const numberMap: Record<string, string> = {
  '1': '一',
  '2': '二',
  '3': '三',
  '4': '四',
  '5': '五',
  '6': '六',
  '7': '七',
  '8': '八',
  '9': '九',
  '10': '十',
};

const reverseNumberMap: Record<string, string> = {
  一: '1',
  二: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
  十: '10',
};

function generateNumberVariants(title: string): string[] {
  const variants: string[] = [];

  const arabicMatch = title.match(/^(.*?)\s*([1-9]|10)\s*$/);
  if (arabicMatch) {
    const baseTitle = arabicMatch[1].trim();
    const num = arabicMatch[2];
    const chineseNum = numberMap[num];
    if (chineseNum) {
      variants.push(`${baseTitle}${chineseNum}`);
      variants.push(`${baseTitle} ${chineseNum}`);
      variants.push(`${baseTitle}第${chineseNum}季`);
      variants.push(`${baseTitle}第${num}季`);
    }
  }

  const chineseMatch = title.match(/^(.*?)\s*([一二三四五六七八九十])\s*$/);
  if (chineseMatch) {
    const baseTitle = chineseMatch[1].trim();
    const chineseNum = chineseMatch[2];
    const arabicNum = reverseNumberMap[chineseNum];
    if (arabicNum) {
      variants.push(`${baseTitle}${arabicNum}`);
      variants.push(`${baseTitle} ${arabicNum}`);
      variants.push(`${baseTitle}第${chineseNum}季`);
      variants.push(`${baseTitle}第${arabicNum}季`);
    }
  }

  const seasonMatch = title.match(
    /^(.*?)\s*第([1-9]|10|[一二三四五六七八九十])季\s*$/
  );
  if (seasonMatch) {
    const baseTitle = seasonMatch[1].trim();
    const num = seasonMatch[2];
    if (numberMap[num]) {
      const chineseNum = numberMap[num];
      variants.push(`${baseTitle}第${chineseNum}季`);
      variants.push(`${baseTitle}${num}`);
      variants.push(`${baseTitle} ${num}`);
    } else if (reverseNumberMap[num]) {
      const arabicNum = reverseNumberMap[num];
      variants.push(`${baseTitle}第${arabicNum}季`);
      variants.push(`${baseTitle}${arabicNum}`);
      variants.push(`${baseTitle} ${arabicNum}`);
    }
  }

  return variants;
}

function generateChinesePunctuationVariants(title: string): string[] {
  const variants: string[] = [];
  if (!title.includes('：') && !title.includes(':')) {
    const spaceReplaced = title.replace(/\s+/g, '：');
    if (spaceReplaced !== title) {
      variants.push(spaceReplaced);
    }
  }
  if (title.includes('：') || title.includes(':')) {
    const colonReplaced = title.replace(/[：:]/g, ' ').replace(/\s+/g, ' ');
    if (colonReplaced !== title) {
      variants.push(colonReplaced);
    }
  }
  return variants;
}

function generateSearchVariants(title: string): string[] {
  if (!title) return [];
  const variants = new Set<string>();
  const cleanTitle = title.trim();
  variants.add(cleanTitle);

  const noPunctuation = cleanTitle
    .replace(/[：:，,。！？!?.、\-—–\s]+/g, ' ')
    .trim();
  if (noPunctuation && noPunctuation !== cleanTitle) {
    variants.add(noPunctuation);
  }

  generateNumberVariants(cleanTitle).forEach((v) => variants.add(v));
  generateChinesePunctuationVariants(cleanTitle).forEach((v) =>
    variants.add(v)
  );

  const mainTitle = cleanTitle.split(/[：:\-—–]/)[0]?.trim();
  if (mainTitle && mainTitle !== cleanTitle && mainTitle.length >= 2) {
    variants.add(mainTitle);
  }

  return Array.from(variants).slice(0, 5);
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在初始化...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  const [favorited, setFavorited] = useState(false);

  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [skipConfig]);

  const hasSkippedIntroRef = useRef(false);
  const hasSkippedOutroRef = useRef(false);
  // 记录上次尝试 seek 跳过片头的时间戳（节流防重入）
  const lastIntroSkipAttemptRef = useRef<number>(0);
  // 标记新流正在挂载/切换中，屏蔽旧集残留的 timeupdate 事件污染新集状态
  const isLoadingNewStreamRef = useRef(false);
  // 标记当前流是否已执行过首次 canplay 初始化，避免播放途中缓冲恢复再次触发 canplay 造成重渲染或闪烁
  const hasHandledCanPlayRef = useRef(false);
  // 防止跳过片尾与 video:ended 同时触发导致连跳两集
  const isSkipControllerTriggeredRef = useRef(false);
  const videoEndedHandledRef = useRef(false);
  // 区分换集与手动换源
  const isEpisodeChangingRef = useRef(false);
  const isManualSourceSwitchRef = useRef(false);
  // 标记换集/换源后是否需要确保自动播放
  const shouldAutoPlayAfterSwitchRef = useRef(false);
  // 标记正在切换源/集，防止浏览器重置倍速覆盖用户设置
  const isSourceSwitchingRef = useRef(false);

  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const searchType = searchParams.get('stype') || '';
  const searchTitle = searchParams.get('stitle') || '';
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);

  // 支持从 URL ?index= 参数初始化集数（1-based 转换为 0-based）
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState<number>(() => {
    const indexParam = searchParams.get('index');
    if (indexParam) {
      const parsed = parseInt(indexParam, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed - 1;
      }
    }
    return 0;
  });

  const currentSourceRef = useRef(searchParams.get('source') || '');
  const currentIdRef = useRef(searchParams.get('id') || '');
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
  }, [
    currentSource,
    currentId,
    videoTitle,
    videoYear,
    detail,
    currentEpisodeIndex,
  ]);

  useEffect(() => {
    hasSkippedIntroRef.current = false;
    hasSkippedOutroRef.current = false;
    lastIntroSkipAttemptRef.current = 0;
    videoEndedHandledRef.current = false;
    const timer = setTimeout(() => {
      isSkipControllerTriggeredRef.current = false;
    }, 800);
    return () => clearTimeout(timer);
  }, [currentEpisodeIndex]);

  const [videoUrl, setVideoUrl] = useState('');
  const totalEpisodes = detail?.episodes?.length || 0;
  const [videoDoubanId, setVideoDoubanId] = useState(0);

  const resumeTimeRef = useRef<number | null>(null);
  const historyRestoredKeyRef = useRef<string | null>(null);
  const skipConfigLoadedKeyRef = useRef<string | null>(null);
  const lastVolumeRef = useRef<number>(0.7);
  const lastPlaybackRateRef = useRef<number>(loadPlaybackRate());

  // 实时检测到的视频分辨率（使用 ref 直接维护 DOM 徽章，避免触发 React 组件树重渲染）
  const detectedResolutionRef = useRef<string>('');

  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 优选测速进度状态
  const [speedTestProgress, setSpeedTestProgress] = useState<{
    completed: number;
    total: number;
  }>({ completed: 0, total: 0 });

  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          // ignore
        }
      }
    }
    return true;
  });

  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, VideoSourceTestResult>
  >(new Map());

  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);
  const [showDownloadSelector, setShowDownloadSelector] = useState(false);
  const { addDownloadTask, setShowDownloadPanel } = useDownload();

  const handleDownloadEpisodes = useCallback(
    async (episodeIndexes: number[]) => {
      if (!detail || !detail.episodes || episodeIndexes.length === 0) {
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = '无法获取视频地址';
        }
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const episodeIndex of episodeIndexes) {
        if (episodeIndex >= detail.episodes.length) {
          failCount++;
          continue;
        }

        const episodeUrl = detail.episodes[episodeIndex];
        const isM3u8 =
          episodeUrl.toLowerCase().includes('.m3u8') ||
          episodeUrl.toLowerCase().includes('/m3u8/');

        if (isM3u8) {
          try {
            const downloadTitle = `${videoTitle || detail.title}_第${
              episodeIndex + 1
            }集`;
            await addDownloadTask(episodeUrl, downloadTitle, 'TS', {
              source: currentSource || undefined,
              videoId: currentId || undefined,
              episodeIndex,
            });
            successCount++;
          } catch (err) {
            console.error(`添加分片下载任务失败 (第${episodeIndex + 1}集):`, err);
            failCount++;
          }
        } else {
          try {
            const a = document.createElement('a');
            a.href = episodeUrl;
            a.download = `${videoTitle || detail.title}_第${episodeIndex + 1}集.mp4`;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            successCount++;
            await new Promise((r) => setTimeout(r, 300));
          } catch (err) {
            console.error(`下载失败 (第${episodeIndex + 1}集):`, err);
            failCount++;
          }
        }
      }

      if (artPlayerRef.current) {
        if (failCount === 0) {
          artPlayerRef.current.notice.show = `已添加 ${successCount} 个分片下载任务`;
        } else if (successCount === 0) {
          artPlayerRef.current.notice.show = '添加下载任务失败，请重试';
        } else {
          artPlayerRef.current.notice.show = `成功添加 ${successCount} 个，失败 ${failCount} 个`;
        }
      }
    },
    [detail, videoTitle, addDownloadTask, currentSource, currentId]
  );

  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const badgeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // 获取播放器当前实际根节点（兼容 FULLSCREEN_WEB_IN_BODY 将 $player 挂载到 body 的情况）
  const getPlayerRoot = (): HTMLElement | null => {
    return (
      (artPlayerRef.current?.template?.$player as HTMLElement | undefined) ||
      artRef.current
    );
  };

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 检测是否为移动设备
  const isMobileDevice = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      ) || window.innerWidth < 768
    );
  }, []);

  // 轻量级并发可用性探测与优选（不创建隐藏 <video>/Hls、不下载 .ts 视频分片，优先保障起播与换源速度）
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    const isMobile = isMobileDevice();
    const candidateSources = isMobile ? sources.slice(0, 6) : sources;
    const MAX_CONCURRENT_TEST = 4;

    const allResults: Array<{
      source: SearchResult;
      testResult: VideoSourceTestResult;
    } | null> = new Array(candidateSources.length).fill(null);

    const newVideoInfoMap = new Map<string, VideoSourceTestResult>();

    setSpeedTestProgress({ completed: 0, total: candidateSources.length });
    let completedCount = 0;
    let shouldStopEarly = false;
    let fastValidCount = 0;

    const testOne = async (index: number) => {
      if (shouldStopEarly) return;
      const source = candidateSources[index];
      const sourceKey = `${source.source}-${source.id}`;
      try {
        if (!source.episodes || source.episodes.length === 0) {
          newVideoInfoMap.set(sourceKey, {
            quality: '不可用',
            loadSpeed: '不可用',
            pingTime: 0,
            hasError: true,
          });
          return;
        }
        const episodeUrl =
          source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];
        const testResult = await getVideoResolutionFromM3u8(episodeUrl);
        allResults[index] = { source, testResult };
        newVideoInfoMap.set(sourceKey, testResult);

        if (testResult.pingTime > 0 && testResult.pingTime <= 600) {
          fastValidCount++;
          if (fastValidCount >= 2) {
            shouldStopEarly = true;
          }
        }
      } catch (_error) {
        allResults[index] = null;
        newVideoInfoMap.set(sourceKey, {
          quality: '不可用',
          loadSpeed: '不可用',
          pingTime: 0,
          hasError: true,
        });
      } finally {
        completedCount++;
        setSpeedTestProgress({
          completed: completedCount,
          total: candidateSources.length,
        });
      }
    };

    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT_TEST, candidateSources.length) },
      async () => {
        while (cursor < candidateSources.length && !shouldStopEarly) {
          const current = cursor++;
          await testOne(current);
        }
      }
    );
    await Promise.all(workers);

    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: VideoSourceTestResult;
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    if (successfulResults.length === 0) return sources[0];

    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    const resultsWithScore = successfulResults.map((result) => ({
      ...result,
      score: calculateSourceScore(result.testResult, minPing, maxPing),
    }));

    resultsWithScore.sort((a, b) => b.score - a.score);
    return resultsWithScore[0].source;
  };

  const calculateSourceScore = (
    testResult: VideoSourceTestResult,
    minPing: number,
    maxPing: number
  ): number => {
    let score = 0;

    const qualityScore = (() => {
      switch (testResult.quality.toUpperCase()) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080P':
          return 75;
        case '720P':
          return 60;
        case '可用':
          return 70;
        case '480P':
          return 40;
        case 'SD':
          return 20;
        default:
          return 50;
      }
    })();
    score += qualityScore * 0.3;

    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0;
      if (maxPing === minPing) return 100;
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.7;

    return Math.round(score * 100) / 100;
  };

  // 根据视频宽高计算分辨率标签（同时兼容横屏和竖屏视频）
  const getResolutionLabel = (width: number, height: number): string => {
    if (!width || !height) return '';
    const maxDim = Math.max(width, height);
    const minDim = Math.min(width, height);

    if (maxDim >= 3840 || minDim >= 2160) return '4K';
    if (maxDim >= 2560 || minDim >= 1440) return '2K';
    if (maxDim >= 1920 || minDim >= 1080) return '1080P';
    if (maxDim >= 1280 || minDim >= 720) return '720P';
    if (maxDim >= 854 || minDim >= 480) return '480P';
    return 'SD';
  };

  // 生成分辨率徽章 HTML（不使用 backdrop-filter，保证浏览器硬件视频叠加层 Direct Composition 不回退）
  const buildResolutionBadgeHtml = (resolution: string): string => {
    if (!resolution) return '';
    const resUpper = resolution.toUpperCase();
    let bgStyle =
      'background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(255, 255, 255, 0.25); color: #e5e7eb;';

    if (resUpper === '4K') {
      bgStyle =
        'background: linear-gradient(135deg, #f59e0b, #ea580c); border: 1px solid rgba(251, 191, 36, 0.6); color: #ffffff;';
    } else if (resUpper === '2K') {
      bgStyle =
        'background: linear-gradient(135deg, #8b5cf6, #ec4899); border: 1px solid rgba(167, 139, 250, 0.6); color: #ffffff;';
    } else if (resUpper === '1080P') {
      bgStyle =
        'background: linear-gradient(135deg, #10b981, #059669); border: 1px solid rgba(52, 211, 153, 0.5); color: #ffffff;';
    } else if (resUpper === '720P') {
      bgStyle =
        'background: linear-gradient(135deg, #3b82f6, #2563eb); border: 1px solid rgba(96, 165, 250, 0.5); color: #ffffff;';
    }

    return `<div style="padding: 3px 9px; border-radius: 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; user-select: none; ${bgStyle}">${resUpper}</div>`;
  };

  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detailData?.episodes[episodeIndex] || '';
    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    } else {
      isLoadingNewStreamRef.current = false;
      isEpisodeChangingRef.current = false;
      setIsVideoLoading(false);
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }
    video.disableRemotePlayback = false;
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen'
        );
      }
    } catch (_err) {
      console.debug('Wake Lock 请求失败或未受支持');
    }
  };

  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch (_err) {
      console.debug('Wake Lock 释放失败');
    }
  };

  const cleanupPlayer = () => {
    if (clockIntervalRef.current) {
      clearInterval(clockIntervalRef.current);
      clockIntervalRef.current = null;
    }
    if (badgeHideTimerRef.current) {
      clearTimeout(badgeHideTimerRef.current);
      badgeHideTimerRef.current = null;
    }
    if (artPlayerRef.current) {
      try {
        const art = artPlayerRef.current;
        const video = (art.video || art.template?.$video) as
          | HTMLVideoElement
          | undefined;

        if (video?.hls) {
          try {
            video.hls.stopLoad();
            video.hls.detachMedia();
            video.hls.destroy();
          } catch {
            // ignore
          }
          video.hls = null;
        }
        if (art.hls) {
          try {
            art.hls.stopLoad();
            art.hls.detachMedia();
            art.hls.destroy();
          } catch {
            // ignore
          }
          art.hls = null;
        }

        if (video) {
          try {
            video.pause();
            video.removeAttribute('src');
            Array.from(video.getElementsByTagName('source')).forEach((s) =>
              s.remove()
            );
            video.load();
          } catch {
            // ignore
          }
        }

        artPlayerRef.current.destroy();
        artPlayerRef.current = null;
      } catch (_err) {
        console.warn('清理播放器资源时出错:', _err);
        artPlayerRef.current = null;
      }
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';
    const absSeconds = Math.abs(seconds);
    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const remainingSeconds = Math.round(absSeconds % 60);

    if (hours === 0) {
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);
      skipConfigRef.current = newConfig;

      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }

      if (artPlayerRef.current && artPlayerRef.current.setting) {
        artPlayerRef.current.setting.update({
          name: '跳过片头片尾',
          switch: newConfig.enable,
        });
        artPlayerRef.current.setting.update({
          name: '设置片头',
          tooltip:
            newConfig.intro_time > 0
              ? formatTime(newConfig.intro_time)
              : '设置片头时间',
        });
        artPlayerRef.current.setting.update({
          name: '设置片尾',
          tooltip:
            newConfig.outro_time < 0
              ? `-${formatTime(-newConfig.outro_time)}`
              : '设置片尾时间',
        });
      }

      console.log('跳过配置已同步:', newConfig);
    } catch (_err) {
      console.debug('保存跳过配置失败');
    }
  };

  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any
          ) {
            if (response.data && typeof response.data === 'string') {
              try {
                const extra = (process.env.NEXT_PUBLIC_AD_BLOCK_PATTERNS || '')
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean);
                installAdLearnHelpers();
                rememberRawPlaylist(response.data);
                const r = filterAdsFromM3U8(response.data, {
                  baseUrl: context?.url,
                  extraPatterns: extra,
                  extraFingerprints: getCustomFingerprints(
                    process.env.NEXT_PUBLIC_AD_FINGERPRINTS
                  ),
                });
                if (r.removedSegments > 0) {
                  console.info(
                    `[去广告] 已移除 ${
                      r.removedSegments
                    } 个分片（约 ${r.removedSeconds.toFixed(1)} 秒）`
                  );
                } else if (
                  r.skippedReason &&
                  r.skippedReason !== 'not-media-playlist'
                ) {
                  console.info(`[去广告] 未过滤：${r.skippedReason}`);
                }
                try {
                  (window as any).__adFilterLast = {
                    url: context?.url,
                    ...r,
                    content: undefined,
                  };
                } catch {
                  // ignore
                }
                // 先执行广告分片识别与过滤，再统一清除剩余的 #EXT-X-DISCONTINUITY 标记，
                // 防止定长分块源（每 5 片 / 约 10s 插入一次伪 DISCONTINUITY）触发 Hls.js 周期性重置 timestampOffset 导致 0.2s 跳帧卡顿
                response.data = stripDiscontinuityLegacy(r.content);
              } catch {
                response.data = stripDiscontinuityLegacy(response.data);
              }
            }
            return onSuccess(response, stats, context, null);
          };
        }
        load(context, config, callbacks);
      };
    }
  }

  // 直接在现有的 <video> 元素上挂载/切换流（不经过 Artplayer 内部会在 canplay 时强制重置 currentTime = 0 的 switchUrl）
  const attachStreamToVideo = (
    video: HTMLVideoElement,
    url: string,
    art: any
  ) => {
    if (!video || !url) return;
    isLoadingNewStreamRef.current = true;
    hasHandledCanPlayRef.current = false;

    if (video.hls) {
      try {
        video.hls.stopLoad();
        video.hls.detachMedia();
        video.hls.destroy();
      } catch {
        // ignore
      }
      video.hls = null;
    }
    if (art?.hls) {
      try {
        art.hls.stopLoad();
        art.hls.detachMedia();
        art.hls.destroy();
      } catch {
        // ignore
      }
      art.hls = null;
    }

    const streamType = getArtPlayerType(url);

    // 换集时先将进度归零并重置片头跳过标记，防止上一集的播放时间戳残留触发误判
    if (isEpisodeChangingRef.current) {
      hasSkippedIntroRef.current = false;
      hasSkippedOutroRef.current = false;
      lastIntroSkipAttemptRef.current = 0;
      try {
        video.currentTime = 0;
      } catch {
        // ignore
      }
    }

    // 仅在手动换源且有待恢复进度时启用 HLS startPosition 直达目标分片；
    // 片头跳过统一交由流就绪后的 canplay / timeupdate 跳转，兼容去广告及含时间戳跳变的 M3U8 流
    const startPos =
      isManualSourceSwitchRef.current &&
      resumeTimeRef.current &&
      resumeTimeRef.current > 1
        ? Math.floor(resumeTimeRef.current)
        : -1;

    if (streamType === 'm3u8' && Hls && Hls.isSupported()) {
      const hlsConfig: any = {
        debug: false,
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        backBufferLength: 30,
        maxBufferSize: 100 * 1000 * 1000,
        loader: blockAdEnabledRef.current
          ? CustomHlsJsLoader
          : Hls.DefaultConfig.loader,
      };
      if (startPos > 0) {
        hlsConfig.startPosition = startPos;
      }

      const hls = new Hls(hlsConfig);

      hls.loadSource(url);
      hls.attachMedia(video);
      video.hls = hls;
      if (art) art.hls = hls;

      ensureVideoSource(video, url);

      hls.on(Hls.Events.ERROR, function (_event: any, data: any) {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              isLoadingNewStreamRef.current = false;
              hls.destroy();
              setIsVideoLoading(false);
              break;
          }
        }
      });
    } else {
      video.src = url;
      ensureVideoSource(video, url);
      video.load();
      isLoadingNewStreamRef.current = false;
      if (shouldAutoPlayAfterSwitchRef.current) {
        video.play().catch(() => {
          // ignore
        });
      }
    }
  };

  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  useEffect(() => {
    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        const detailResponse = await fetch(
          `/api/detail?source=${encodeURIComponent(
            source
          )}&id=${encodeURIComponent(id)}`
        );
        if (!detailResponse.ok) throw new Error('获取详情失败');
        const detailData = (await detailResponse.json()) as SearchResult;
        setAvailableSources([detailData]);
        return [detailData];
      } catch (_err) {
        console.error('获取详情失败:', _err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      try {
        const variants = generateSearchVariants(query);
        const searchQueries = variants.length > 0 ? variants : [query.trim()];
        const allRawResults: SearchResult[] = [];
        const seenKeys = new Set<string>();

        const appendResults = (list: unknown) => {
          if (!Array.isArray(list)) return;
          for (const item of list) {
            const key = `${item.source}-${item.id}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              allRawResults.push(item);
            }
          }
        };

        const primaryQuery = searchQueries[0];
        if (primaryQuery) {
          const response = await fetch(
            `/api/search?q=${encodeURIComponent(primaryQuery)}`
          );
          if (!response.ok) {
            throw new Error('搜索失败');
          }
          const data = await response.json();
          appendResults(data.results);
        }

        const targetNorm = (videoTitleRef.current || query)
          .replaceAll(' ', '')
          .toLowerCase();
        const hasExactInFirst = allRawResults.some(
          (r) => r.title.replaceAll(' ', '').toLowerCase() === targetNorm
        );

        // 若首个主查询未命中精确标题，最多取 2 个高优先级变体并发补偿查询，避免串行等待与触发频控
        if (!hasExactInFirst && searchQueries.length > 1) {
          const extraQueries = searchQueries.slice(1, 3).filter(Boolean);
          const extraResponses = await Promise.allSettled(
            extraQueries.map(async (q) => {
              const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
              if (!res.ok) return [];
              const d = await res.json();
              return Array.isArray(d.results) ? d.results : [];
            })
          );
          for (const settled of extraResponses) {
            if (settled.status === 'fulfilled') {
              appendResults(settled.value);
            }
          }
        }

        const targetTitleNorm = (videoTitleRef.current || query)
          .replaceAll(' ', '')
          .toLowerCase();
        const requestedYear = videoYearRef.current;

        const matchesType = (result: SearchResult) =>
          searchType
            ? (searchType === 'tv' && result.episodes.length > 1) ||
              (searchType === 'movie' && result.episodes.length === 1)
            : true;

        // 分级匹配：1. 标题完全一致 + 年份匹配 -> 2. 标题完全一致 -> 3. 包含标题 + 年份匹配
        const exactTitleAndYear = allRawResults.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
              targetTitleNorm &&
            matchesRequestedYear(result.year, requestedYear) &&
            matchesType(result)
        );

        const exactTitleOnly = allRawResults.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
              targetTitleNorm && matchesType(result)
        );

        const looseMatch = allRawResults.filter((result: SearchResult) => {
          const rTitle = result.title.replaceAll(' ', '').toLowerCase();
          return (
            (rTitle.includes(targetTitleNorm) ||
              targetTitleNorm.includes(rTitle)) &&
            matchesRequestedYear(result.year, requestedYear) &&
            matchesType(result)
          );
        });

        const results =
          exactTitleAndYear.length > 0
            ? exactTitleAndYear
            : exactTitleOnly.length > 0
            ? exactTitleOnly
            : looseMatch;

        setAvailableSources(results);
        return results;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '📍 正在获取视频详情...'
          : '🔍 正在搜索播放源...'
      );

      let sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      if (
        currentSource &&
        currentId &&
        !sourcesInfo.some(
          (s) => s.source === currentSource && s.id === currentId
        )
      ) {
        sourcesInfo = await fetchSourceDetail(currentSource, currentId);
      }
      if (sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      let detailData: SearchResult = sourcesInfo[0];
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (s) => s.source === currentSource && s.id === currentId
        );
        if (target) {
          detailData = target;
        } else {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      }

      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('💯 正在优选最佳播放源...');
        detailData = await preferBestSource(sourcesInfo);
      }

      // 在播放器挂载前预先并行读取历史进度与跳过片头片尾配置
      const storageKey = generateStorageKey(detailData.source, detailData.id);
      const [recordsResult, skipResult] = await Promise.allSettled([
        getAllPlayRecords(),
        getSkipConfig(detailData.source, detailData.id),
      ]);

      let resolvedSkipConfig = { enable: false, intro_time: 0, outro_time: 0 };
      if (skipResult.status === 'fulfilled' && skipResult.value) {
        resolvedSkipConfig = skipResult.value;
      }
      skipConfigLoadedKeyRef.current = storageKey;
      skipConfigRef.current = resolvedSkipConfig;
      setSkipConfig(resolvedSkipConfig);

      let initialEpIdx = currentEpisodeIndexRef.current;
      if (initialEpIdx >= detailData.episodes.length) {
        initialEpIdx = 0;
      }

      if (recordsResult.status === 'fulfilled' && recordsResult.value) {
        historyRestoredKeyRef.current = storageKey;
        const record = recordsResult.value[storageKey];
        if (record) {
          const targetIdx = Math.max(0, record.index - 1);
          if (targetIdx < detailData.episodes.length) {
            initialEpIdx = targetIdx;
          }
          // 若开启了跳过片头且历史进度仍在片头区间内，则不恢复片头内的秒数，直接让跳过片头生效
          if (
            resolvedSkipConfig.enable &&
            resolvedSkipConfig.intro_time > 0 &&
            record.play_time <= resolvedSkipConfig.intro_time + 2
          ) {
            resumeTimeRef.current = null;
          } else {
            resumeTimeRef.current = record.play_time;
          }
        }
      }

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setVideoDoubanId(detailData.douban_id || 0);
      setDetail(detailData);
      setCurrentEpisodeIndex(initialEpIdx);

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.set('index', String(initialEpIdx + 1));
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('🔅 准备就绪，即将开始播放...');
      setTimeout(() => setLoading(false), 300);
    };

    initAll();
  }, []);

  // 监听 currentSource 与 currentId，恢复历史进度或换源临时进度
  useEffect(() => {
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

      // 优先检查换源保存的 sessionStorage 临时进度
      const tempProgressKey = `temp_progress_${currentSource}_${currentId}_${currentEpisodeIndexRef.current}`;
      try {
        const tempProgressStr = sessionStorage.getItem(tempProgressKey);
        if (tempProgressStr) {
          const tempTime = parseFloat(tempProgressStr);
          sessionStorage.removeItem(tempProgressKey);
          if (!Number.isNaN(tempTime) && tempTime > 0) {
            resumeTimeRef.current = tempTime;
            historyRestoredKeyRef.current = generateStorageKey(
              currentSource,
              currentId
            );
            return;
          }
        }
      } catch {
        // ignore sessionStorage error
      }

      const key = generateStorageKey(currentSource, currentId);
      if (historyRestoredKeyRef.current === key) return;
      historyRestoredKeyRef.current = key;
      try {
        const allRecords = await getAllPlayRecords();
        const record = allRecords[key];
        if (record) {
          const targetIdx = Math.max(0, record.index - 1);
          if (targetIdx !== currentEpisodeIndexRef.current) {
            setCurrentEpisodeIndex(targetIdx);
          }
          if (
            skipConfigRef.current.enable &&
            skipConfigRef.current.intro_time > 0 &&
            record.play_time <= skipConfigRef.current.intro_time + 2
          ) {
            resumeTimeRef.current = null;
          } else {
            resumeTimeRef.current = record.play_time;
          }
        }
      } catch (_err) {
        console.debug('读取历史进度失败');
      }
    };
    initFromHistory();
  }, [currentSource, currentId]);

  useEffect(() => {
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;
      const key = generateStorageKey(currentSource, currentId);
      if (skipConfigLoadedKeyRef.current === key) return;
      skipConfigLoadedKeyRef.current = key;
      try {
        const config = await getSkipConfig(currentSource, currentId);
        const resolved = config || {
          enable: false,
          intro_time: 0,
          outro_time: 0,
        };
        skipConfigRef.current = resolved;
        setSkipConfig(resolved);
      } catch (_err) {
        console.debug('读取云端跳过配置失败');
      }
    };
    initSkipConfig();
  }, [currentSource, currentId]);

  // 订阅云端跳过片头片尾配置异步刷新事件，防止缓存未命中时丢失配置
  useEffect(() => {
    if (!currentSource || !currentId) return;
    const unsubscribe = subscribeToDataUpdates(
      'skipConfigsUpdated',
      (configs: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const updated = configs?.[key];
        if (updated) {
          skipConfigRef.current = updated;
          setSkipConfig(updated);
        }
      }
    );
    return unsubscribe;
  }, [currentSource, currentId]);

  // 同步当前集数与标题到全屏顶部标题栏（手机横屏全屏自动连播下一集时实时刷新集数显示）
  useEffect(() => {
    if (!artPlayerRef.current) return;
    const epTitle =
      (detail as any)?.episodes_titles?.[currentEpisodeIndex] ||
      `第 ${currentEpisodeIndex + 1} 集`;
    const fullTitle =
      totalEpisodes > 1 ? `${videoTitle}  ${epTitle}` : videoTitle;

    artPlayerRef.current.title = `${videoTitle} - 第${
      currentEpisodeIndex + 1
    }集`;

    const playerRoot = getPlayerRoot();
    const titleLayerEl = playerRoot?.querySelector(
      '.art-layer-fullscreen-title .fullscreen-title-text'
    ) as HTMLElement | null;
    if (titleLayerEl) {
      titleLayerEl.textContent = fullTitle;
    }
  }, [currentEpisodeIndex, videoTitle, detail, totalEpisodes]);

  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);
      isLoadingNewStreamRef.current = true;
      isEpisodeChangingRef.current = false;
      isManualSourceSwitchRef.current = true;
      shouldAutoPlayAfterSwitchRef.current = true;

      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      const oldSource = currentSourceRef.current;
      const oldId = currentIdRef.current;
      const currentSkipCfg = skipConfigRef.current;

      const newDetail = availableSources.find(
        (s) => s.source === newSource && s.id === newId
      );
      if (!newDetail) {
        isLoadingNewStreamRef.current = false;
        setIsVideoLoading(false);
        setError('未找到匹配结果');
        return;
      }

      let targetIndex = currentEpisodeIndex;
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
        hasSkippedIntroRef.current = false;
      } else if (currentPlayTime > 1) {
        resumeTimeRef.current = currentPlayTime;
        // 换源时保持当前实际播放进度，避免触发片头跳过导致进度突变
        hasSkippedIntroRef.current = true;
        try {
          sessionStorage.setItem(
            `temp_progress_${newSource}_${newId}_${targetIndex}`,
            String(currentPlayTime)
          );
        } catch {
          // ignore
        }
      }

      // 标记新源由换源逻辑接管进度与跳过配置，避免 initFromHistory / initSkipConfig 重复请求和重渲染导致卡顿
      const newStorageKey = generateStorageKey(newSource, newId);
      historyRestoredKeyRef.current = newStorageKey;
      skipConfigLoadedKeyRef.current = newStorageKey;

      // 后台异步清理旧源记录并迁移跳过配置，不阻塞视频流切换
      if (oldSource && oldId) {
        Promise.allSettled([
          deletePlayRecord(oldSource, oldId),
          deleteSkipConfig(oldSource, oldId),
          saveSkipConfig(newSource, newId, currentSkipCfg),
        ]).catch(() => {
          console.debug('后台迁移源记录失败');
        });
      }

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      newUrl.searchParams.set('index', String(targetIndex + 1));
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDoubanId(newDetail.douban_id || 0);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
      updateVideoUrl(newDetail, targetIndex);
    } catch (err) {
      isLoadingNewStreamRef.current = false;
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () =>
      document.removeEventListener('keydown', handleKeyboardShortcuts);
  }, []);

  const syncEpisodeIndexToUrl = (episodeIdx: number) => {
    try {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('index', String(episodeIdx + 1));
      window.history.replaceState({}, '', newUrl.toString());
    } catch {
      // ignore
    }
  };

  const handleEpisodeChange = (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      // 若点击的是当前正在播放的集数，重置片头标记并从头（或片头跳过点）重新播放
      if (episodeNumber === currentEpisodeIndexRef.current) {
        hasSkippedIntroRef.current = false;
        hasSkippedOutroRef.current = false;
        lastIntroSkipAttemptRef.current = 0;
        resumeTimeRef.current = null;
        if (artPlayerRef.current) {
          const introTime =
            skipConfigRef.current.enable && skipConfigRef.current.intro_time > 0
              ? skipConfigRef.current.intro_time
              : 0;
          artPlayerRef.current.currentTime = introTime;
          if (introTime > 0) {
            artPlayerRef.current.notice.show = `已自动跳过片头 (${formatTime(
              introTime
            )})`;
          }
          if (artPlayerRef.current.paused) {
            artPlayerRef.current.play().catch(() => {
              // ignore
            });
          }
        }
        return;
      }

      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      isLoadingNewStreamRef.current = true;
      isEpisodeChangingRef.current = true;
      isManualSourceSwitchRef.current = false;
      shouldAutoPlayAfterSwitchRef.current = true;
      hasSkippedIntroRef.current = false;
      hasSkippedOutroRef.current = false;
      lastIntroSkipAttemptRef.current = 0;
      resumeTimeRef.current = null;
      currentEpisodeIndexRef.current = episodeNumber;
      setCurrentEpisodeIndex(episodeNumber);
      updateVideoUrl(detailRef.current, episodeNumber);
      syncEpisodeIndexToUrl(episodeNumber);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      const nextIdx = idx - 1;
      isLoadingNewStreamRef.current = true;
      isEpisodeChangingRef.current = true;
      isManualSourceSwitchRef.current = false;
      shouldAutoPlayAfterSwitchRef.current = true;
      hasSkippedIntroRef.current = false;
      hasSkippedOutroRef.current = false;
      lastIntroSkipAttemptRef.current = 0;
      resumeTimeRef.current = null;
      currentEpisodeIndexRef.current = nextIdx;
      setCurrentEpisodeIndex(nextIdx);
      updateVideoUrl(d, nextIdx);
      syncEpisodeIndexToUrl(nextIdx);
    }
  };

  const handleNextEpisode = (isFromSkip = false) => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      if (!isFromSkip && artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      const nextIdx = idx + 1;
      isLoadingNewStreamRef.current = true;
      isEpisodeChangingRef.current = true;
      isManualSourceSwitchRef.current = false;
      shouldAutoPlayAfterSwitchRef.current = true;
      hasSkippedIntroRef.current = false;
      hasSkippedOutroRef.current = false;
      lastIntroSkipAttemptRef.current = 0;
      resumeTimeRef.current = null;
      currentEpisodeIndexRef.current = nextIdx;
      setCurrentEpisodeIndex(nextIdx);
      updateVideoUrl(d, nextIdx);
      syncEpisodeIndexToUrl(nextIdx);
    }
  };

  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }
    if (e.altKey && e.key === 'ArrowRight') {
      if (
        detailRef.current &&
        currentEpisodeIndexRef.current < detailRef.current.episodes.length - 1
      ) {
        handleNextEpisode();
        e.preventDefault();
      }
    }
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
    if (e.key === 'm' || e.key === 'M') {
      if (artPlayerRef.current) {
        artPlayerRef.current.muted = !artPlayerRef.current.muted;
        e.preventDefault();
      }
    }
  };

  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    )
      return;
    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;
    if (currentTime < 1 || !duration) return;

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1,
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });
      lastSaveTimeRef.current = Date.now();
    } catch (_err) {
      console.debug('保存播放进度失败');
    }
  };

  useEffect(() => {
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
      releaseWakeLock();
      cleanupPlayer();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        if (artPlayerRef.current && !artPlayerRef.current.paused)
          requestWakeLock();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (_err) {
        console.debug('获取收藏状态失败');
      }
    })();
  }, [currentSource, currentId]);

  useEffect(() => {
    if (!currentSource || !currentId) return;
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        setFavorited(!!favorites[key]);
      }
    );
    return unsubscribe;
  }, [currentSource, currentId]);

  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;
    try {
      if (favorited) {
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (_err) {
      console.debug('切换收藏失败');
    }
  };

  useEffect(() => {
    if (
      !Artplayer ||
      !Hls ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    )
      return;

    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }

    // 核心改进：如果播放器实例已存在，直接复用当前实例的 <video> 挂载新流，
    // 不调用 Artplayer 内部会在 video:canplay 时将 currentTime 强制清零的 switchUrl，
    // 既保证手机端横屏全屏自动跳过片尾连播下一集不退出全屏，又彻底解决片头跳过被重置为 0m0s 的问题！
    if (artPlayerRef.current && !loading) {
      if (isEpisodeChangingRef.current) {
        setIsVideoLoading(false);
      }

      const art = artPlayerRef.current;
      const newType = getArtPlayerType(videoUrl);
      if (art.option) {
        art.option.type = newType;
        art.option.url = videoUrl;
      }

      art.title = `${videoTitle} - 第${currentEpisodeIndex + 1}集`;
      art.poster = videoCover;

      const currentPlaybackRate = sanitizePlaybackRate(
        lastPlaybackRateRef.current || art.playbackRate || 1.0
      );

      isSourceSwitchingRef.current = true;

      const videoEl = (art.video || art.template?.$video) as
        | HTMLVideoElement
        | undefined;
      if (videoEl) {
        attachStreamToVideo(videoEl, videoUrl, art);
        if (Math.abs(currentPlaybackRate - 1.0) > 0.01) {
          art.playbackRate = currentPlaybackRate;
        }
      }

      isEpisodeChangingRef.current = false;
      setTimeout(() => {
        isSourceSwitchingRef.current = false;
      }, 300);
      return;
    }

    if (artPlayerRef.current) cleanupPlayer();

    try {
      Artplayer.PLAYBACK_RATE = ALLOWED_PLAYBACK_RATES;
      Artplayer.USE_RAF = false;
      Artplayer.FULLSCREEN_WEB_IN_BODY = true;

      const savedFit =
        typeof window !== 'undefined'
          ? localStorage.getItem('video_object_fit') || 'contain'
          : 'contain';
      const fitTooltipMap: Record<string, string> = {
        contain: '默认(完整显示)',
        cover: '填充(裁切)',
        fill: '拉伸(变形)',
      };

      const initialEpTitle =
        (detail as any)?.episodes_titles?.[currentEpisodeIndex] ||
        `第 ${currentEpisodeIndex + 1} 集`;
      const initialFullTitle =
        totalEpisodes > 1
          ? `${videoTitle}  ${initialEpTitle}`
          : videoTitle || '';

      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
        type: getArtPlayerType(videoUrl),
        poster: videoCover,
        volume: 0.7,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: false,
        mutex: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        theme: '#22c55e',
        lang: 'zh-cn',
        hotkey: false,
        fastForward: true,
        autoOrientation: true,
        lock: true,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
          playsInline: true,
          'webkit-playsinline': 'true',
        } as any,
        layers: [
          {
            name: 'fullscreen-title',
            html: `<div class="fullscreen-title-text" style="padding: 8px 14px; border-radius: 8px; background: rgba(0, 0, 0, 0.72); color: #ffffff; font-size: 14px; font-weight: 600; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></div>`,
            style: {
              position: 'absolute',
              top: '16px',
              left: '20px',
              zIndex: '50',
              pointerEvents: 'none',
              display: 'none',
            },
          },
          {
            name: 'fullscreen-clock',
            html: `<div class="fullscreen-clock-text" style="padding: 6px 12px; border-radius: 8px; background: rgba(0, 0, 0, 0.72); color: #ffffff; font-size: 13px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"></div>`,
            style: {
              position: 'absolute',
              top: '16px',
              right: '20px',
              zIndex: '50',
              pointerEvents: 'none',
              display: 'none',
            },
          },
          {
            name: 'resolution-badge',
            html: '',
            style: {
              position: 'absolute',
              top: '16px',
              right: '20px',
              zIndex: '45',
              pointerEvents: 'none',
              display: 'none',
            },
          },
        ],
        customType: {
          m3u8: function (video: HTMLVideoElement, url: string, art: any) {
            attachStreamToVideo(video, url, art);
          },
        },
        icons: {
          loading:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
        settings: [
          {
            name: 'video-fit',
            html: '显示模式',
            tooltip: fitTooltipMap[savedFit] || '默认(完整显示)',
            selector: [
              {
                html: '默认(完整显示)',
                value: 'contain',
                default: savedFit === 'contain',
              },
              {
                html: '填充(裁切)',
                value: 'cover',
                default: savedFit === 'cover',
              },
              {
                html: '拉伸(变形)',
                value: 'fill',
                default: savedFit === 'fill',
              },
            ],
            onSelect: function (item: any) {
              const fitVal = item.value || 'contain';
              try {
                localStorage.setItem('video_object_fit', fitVal);
              } catch {
                // ignore
              }
              const vEl = artPlayerRef.current?.video as
                | HTMLVideoElement
                | undefined;
              if (vEl) {
                vEl.style.objectFit = fitVal;
              }
              return item.html;
            },
          },
          {
            html: '去广告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabledRef.current ? '已开启' : '已关闭',
            switch: blockAdEnabledRef.current,
            onSwitch: function (item: any) {
              const newVal = !item.switch;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
                if (artPlayerRef.current) {
                  resumeTimeRef.current = artPlayerRef.current.currentTime;
                }
                setBlockAdEnabled(newVal);
              } catch (_e) {
                // ignore
              }
              return newVal;
            },
          },
          {
            name: '跳过片头片尾',
            html: '跳过片头片尾',
            switch: skipConfigRef.current.enable,
            onSwitch: function (item) {
              const newConfig = {
                ...skipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(newConfig);
              return !item.switch;
            },
          },
          {
            html: '删除跳过配置',
            onClick: function () {
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              });
              return '';
            },
          },
          {
            name: '设置片头',
            html: '设置片头',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
            tooltip:
              skipConfigRef.current.intro_time === 0
                ? '设置片头时间'
                : `${formatTime(skipConfigRef.current.intro_time)}`,
            onClick: function () {
              const currentTime = artPlayerRef.current?.currentTime || 0;
              if (currentTime > 0) {
                hasSkippedIntroRef.current = true;
                handleSkipConfigChange({
                  ...skipConfigRef.current,
                  intro_time: currentTime,
                  enable: true,
                });
                return `${formatTime(currentTime)}`;
              }
            },
          },
          {
            name: '设置片尾',
            html: '设置片尾',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfigRef.current.outro_time >= 0
                ? '设置片尾时间'
                : `-${formatTime(-skipConfigRef.current.outro_time)}`,
            onClick: function () {
              const outroTime =
                -(
                  artPlayerRef.current?.duration -
                  artPlayerRef.current?.currentTime
                ) || 0;
              if (outroTime < 0) {
                handleSkipConfigChange({
                  ...skipConfigRef.current,
                  outro_time: outroTime,
                  enable: true,
                });
                return `-${formatTime(-outroTime)}`;
              }
            },
          },
        ],
        controls: [
          {
            position: 'left',
            index: 13,
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              handleNextEpisode();
            },
          },
        ],
      });

      // 全屏标题与实时时钟更新逻辑（仅在全屏且控制栏显示时更新，隐藏时立即设为 display: none 并停止定时器）
      const updateClockText = () => {
        const playerRoot = getPlayerRoot();
        if (!playerRoot) return;
        const clockEl = playerRoot.querySelector(
          '.art-layer-fullscreen-clock .fullscreen-clock-text'
        ) as HTMLElement | null;
        if (clockEl) {
          const now = new Date();
          const hh = String(now.getHours()).padStart(2, '0');
          const mm = String(now.getMinutes()).padStart(2, '0');
          const txt = `${hh}:${mm}`;
          if (clockEl.textContent !== txt) {
            clockEl.textContent = txt;
          }
        }
      };

      const syncFullscreenLayers = (isFull: boolean, showControl = true) => {
        const playerRoot = getPlayerRoot();
        if (!playerRoot) return;
        const titleLayer = playerRoot.querySelector(
          '.art-layer-fullscreen-title'
        ) as HTMLElement | null;
        const clockLayer = playerRoot.querySelector(
          '.art-layer-fullscreen-clock'
        ) as HTMLElement | null;
        const badgeLayer = playerRoot.querySelector(
          '.art-layer-resolution-badge'
        ) as HTMLElement | null;

        if (isFull && showControl) {
          if (titleLayer) {
            titleLayer.style.display = 'block';
          }
          if (clockLayer) {
            updateClockText();
            clockLayer.style.display = 'block';
          }
          if (badgeLayer) {
            badgeLayer.style.top = '54px';
          }
          if (!clockIntervalRef.current) {
            clockIntervalRef.current = setInterval(updateClockText, 15000);
          }
        } else {
          if (titleLayer) titleLayer.style.display = 'none';
          if (clockLayer) clockLayer.style.display = 'none';
          if (!isFull && badgeLayer) {
            badgeLayer.style.top = '16px';
          }
          if (clockIntervalRef.current) {
            clearInterval(clockIntervalRef.current);
            clockIntervalRef.current = null;
          }
        }
      };

      // 显示并在 3 秒后自动隐藏分辨率徽章（隐藏时设为 display: none，避免透明浮层驻留影响硬件解码叠加层）
      const showResolutionBadgeTemporarily = () => {
        const playerRoot = getPlayerRoot();
        if (!playerRoot || !detectedResolutionRef.current) return;
        const badgeLayer = playerRoot.querySelector(
          '.art-layer-resolution-badge'
        ) as HTMLElement | null;
        if (!badgeLayer) return;

        badgeLayer.style.display = 'block';

        if (badgeHideTimerRef.current) clearTimeout(badgeHideTimerRef.current);
        badgeHideTimerRef.current = setTimeout(() => {
          if (badgeLayer) badgeLayer.style.display = 'none';
        }, 3000);
      };

      // 检测并更新真实视频分辨率
      const detectAndApplyResolution = () => {
        const videoEl = artPlayerRef.current?.video as
          | HTMLVideoElement
          | undefined;
        if (!videoEl) return;
        const label = getResolutionLabel(
          videoEl.videoWidth,
          videoEl.videoHeight
        );
        if (label) {
          const playerRoot = getPlayerRoot();
          const badgeLayer = playerRoot?.querySelector(
            '.art-layer-resolution-badge'
          ) as HTMLElement | null;
          if (
            detectedResolutionRef.current !== label ||
            (badgeLayer && !badgeLayer.innerHTML)
          ) {
            detectedResolutionRef.current = label;
            if (badgeLayer) {
              badgeLayer.innerHTML = buildResolutionBadgeHtml(label);
            }
          }
          showResolutionBadgeTemporarily();

          if (currentSourceRef.current && currentIdRef.current) {
            const sourceKey = `${currentSourceRef.current}-${currentIdRef.current}`;
            setPrecomputedVideoInfo((prev) => {
              const existing = prev.get(sourceKey);
              if (
                existing &&
                existing.quality === label &&
                existing.loadSpeed &&
                existing.loadSpeed !== '未知'
              ) {
                return prev;
              }
              const next = new Map(prev);
              next.set(sourceKey, {
                quality: label,
                loadSpeed:
                  existing?.loadSpeed && existing.loadSpeed !== '未知'
                    ? existing.loadSpeed
                    : '可用',
                pingTime: existing?.pingTime || 0,
              });
              return next;
            });
          }
        }
      };

      artPlayerRef.current.on('fullscreen', (state: boolean) => {
        syncFullscreenLayers(state || !!artPlayerRef.current?.fullscreenWeb);
      });

      artPlayerRef.current.on('fullscreenWeb', (state: boolean) => {
        syncFullscreenLayers(state || !!artPlayerRef.current?.fullscreen);
      });

      artPlayerRef.current.on('control', (state: boolean) => {
        if (state) {
          showResolutionBadgeTemporarily();
        }
        const isFull =
          !!artPlayerRef.current?.fullscreen ||
          !!artPlayerRef.current?.fullscreenWeb;
        if (!isFull) return;
        syncFullscreenLayers(true, state);
      });

      artPlayerRef.current.on('ready', () => {
        setError(null);
        const rootEl = getPlayerRoot();
        const initTitleEl = rootEl?.querySelector(
          '.art-layer-fullscreen-title .fullscreen-title-text'
        ) as HTMLElement | null;
        if (initTitleEl) {
          initTitleEl.textContent = initialFullTitle;
        }
        const vEl = artPlayerRef.current?.video as HTMLVideoElement | undefined;
        if (vEl && savedFit) {
          vEl.style.objectFit = savedFit;
        }
        const savedRate = sanitizePlaybackRate(lastPlaybackRateRef.current);
        if (artPlayerRef.current && Math.abs(savedRate - 1.0) > 0.01) {
          artPlayerRef.current.playbackRate = savedRate;
        }
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      });

      artPlayerRef.current.on('play', () => requestWakeLock());
      artPlayerRef.current.on('pause', () => {
        releaseWakeLock();
        const player = artPlayerRef.current;
        if (player) {
          const duration = player.duration || 0;
          const currentTime = player.currentTime || 0;
          const remainingOutro =
            skipConfigRef.current.outro_time < 0
              ? -skipConfigRef.current.outro_time
              : skipConfigRef.current.outro_time;
          // 避免在片尾区域暂停时将片尾时间覆写为历史进度
          if (
            skipConfigRef.current.enable &&
            remainingOutro > 0 &&
            duration > remainingOutro &&
            currentTime >= duration - remainingOutro
          ) {
            return;
          }
        }
        saveCurrentPlayProgress();
      });

      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        requestWakeLock();
      }

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });

      artPlayerRef.current.on('video:ratechange', () => {
        if (!artPlayerRef.current) return;
        const currentRate = artPlayerRef.current.playbackRate;
        // 换源或换集期间浏览器可能会将倍速短暂重置为 1.0，此时不覆盖用户保存的倍速
        if (
          isSourceSwitchingRef.current &&
          Math.abs(currentRate - 1.0) < 0.01 &&
          Math.abs(lastPlaybackRateRef.current - 1.0) > 0.01
        ) {
          return;
        }
        const sanitized = sanitizePlaybackRate(currentRate);
        lastPlaybackRateRef.current = sanitized;
        try {
          localStorage.setItem(PLAYER_PLAYBACK_RATE_KEY, String(sanitized));
        } catch {
          // ignore
        }
      });

      artPlayerRef.current.on('video:loadedmetadata', () => {
        isLoadingNewStreamRef.current = false;
        detectAndApplyResolution();
      });

      artPlayerRef.current.on('video:canplay', () => {
        isLoadingNewStreamRef.current = false;
        setIsVideoLoading(false);

        // 每次挂载新流仅执行一次首次 canplay 初始化，防止正常播放中因缓冲波动重复触发
        if (hasHandledCanPlayRef.current) return;
        hasHandledCanPlayRef.current = true;

        const player = artPlayerRef.current;
        if (player) {
          const duration = player.duration || 0;

          if (resumeTimeRef.current && resumeTimeRef.current > 0) {
            try {
              let target = resumeTimeRef.current;
              if (duration && target >= duration - 2) {
                target = Math.max(0, duration - 5);
              }
              if (Math.abs((player.currentTime || 0) - target) > 2.5) {
                player.currentTime = target;
              }
            } catch (_err) {
              console.debug('恢复播放进度失败');
            }
            resumeTimeRef.current = null;
            isManualSourceSwitchRef.current = false;
          } else if (
            skipConfigRef.current.enable &&
            skipConfigRef.current.intro_time > 0 &&
            !hasSkippedIntroRef.current
          ) {
            const introTime = skipConfigRef.current.intro_time;
            if (duration === 0 || duration > introTime + 5) {
              const cur = player.currentTime || 0;
              if (cur < introTime) {
                lastIntroSkipAttemptRef.current = Date.now();
                player.currentTime = introTime;
                player.notice.show = `已自动跳过片头 (${formatTime(
                  introTime
                )})`;
              }
            }
          }
        }

        setTimeout(() => {
          if (
            artPlayerRef.current &&
            Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
          ) {
            artPlayerRef.current.volume = lastVolumeRef.current;
          }
          const targetRate = sanitizePlaybackRate(lastPlaybackRateRef.current);
          if (
            artPlayerRef.current &&
            Math.abs(artPlayerRef.current.playbackRate - targetRate) > 0.01
          ) {
            artPlayerRef.current.playbackRate = targetRate;
          }
          const vEl = artPlayerRef.current?.video as
            | HTMLVideoElement
            | undefined;
          const currentFit =
            localStorage.getItem('video_object_fit') || 'contain';
          if (vEl && vEl.style.objectFit !== currentFit) {
            vEl.style.objectFit = currentFit;
          }
          // 若是自动跳过片尾、选集或换源触发的切换，确保在新流可播放时自动开始播放
          if (shouldAutoPlayAfterSwitchRef.current && artPlayerRef.current) {
            shouldAutoPlayAfterSwitchRef.current = false;
            if (artPlayerRef.current.paused) {
              artPlayerRef.current.play().catch(() => {
                // ignore
              });
            }
          }
        }, 0);

        detectAndApplyResolution();
      });

      artPlayerRef.current.on('video:timeupdate', () => {
        if (isLoadingNewStreamRef.current) return;
        const player = artPlayerRef.current;
        if (!player) return;

        const currentTime = player.currentTime || 0;
        const duration = player.duration || 0;

        const introTime = skipConfigRef.current.intro_time;
        const outroTime = skipConfigRef.current.outro_time;
        const remainingOutro = outroTime < 0 ? -outroTime : outroTime;

        const now = Date.now();
        const interval = 30000;
        if (now - lastSaveTimeRef.current > interval) {
          const isInOutroZone =
            skipConfigRef.current.enable &&
            remainingOutro > 0 &&
            duration > remainingOutro &&
            currentTime >= duration - remainingOutro;
          // 若片头尚未跳过完成（仍在片头区间等待跳过），不把片头内的秒数写入历史记录
          const isWaitingIntroSkip =
            skipConfigRef.current.enable &&
            introTime > 0 &&
            !hasSkippedIntroRef.current &&
            currentTime < introTime;
          if (!isInOutroZone && !isWaitingIntroSkip) {
            lastSaveTimeRef.current = now;
            if (typeof (window as any).requestIdleCallback === 'function') {
              (window as any).requestIdleCallback(() => {
                saveCurrentPlayProgress();
              });
            } else {
              setTimeout(() => {
                saveCurrentPlayProgress();
              }, 0);
            }
          }
        }

        if (!skipConfigRef.current.enable) return;
        if (resumeTimeRef.current && resumeTimeRef.current > 0) return;

        // 跳过片头逻辑：
        // 1. 当 currentTime < introTime 且视频已就绪未处于 seeking 时，执行跳转到 introTime；
        // 2. 只有当视频不处于 seeking 且正在播放（!player.paused）、真实播放进度已越过 introTime 后，才将 hasSkippedIntroRef 锁定为 true！
        if (introTime > 0 && !hasSkippedIntroRef.current) {
          if (currentTime < introTime) {
            if (
              player.video &&
              !player.video.seeking &&
              player.video.readyState >= 1 &&
              (duration === 0 || duration > introTime + 5)
            ) {
              if (now - lastIntroSkipAttemptRef.current > 800) {
                lastIntroSkipAttemptRef.current = now;
                player.currentTime = introTime;
                player.notice.show = `已自动跳过片头 (${formatTime(
                  introTime
                )})`;
              }
            }
          } else if (
            currentTime >= introTime &&
            player.video &&
            !player.video.seeking &&
            !player.paused
          ) {
            hasSkippedIntroRef.current = true;
          }
        }

        if (remainingOutro > 0) {
          if (
            duration > remainingOutro &&
            currentTime >= duration - remainingOutro &&
            !hasSkippedOutroRef.current &&
            !isSkipControllerTriggeredRef.current
          ) {
            const d = detailRef.current;
            const idx = currentEpisodeIndexRef.current;
            if (d && d.episodes && idx < d.episodes.length - 1) {
              if (!player.paused) {
                hasSkippedOutroRef.current = true;
                isSkipControllerTriggeredRef.current = true;
                player.notice.show = `已自动跳过片尾 (${formatTime(
                  remainingOutro
                )})，即将播放下一集`;
                // 不调用 player.pause()，直接原位切换下一集 URL，保持手机横屏全屏与自动连播状态
                handleNextEpisode(true);
                return;
              }
            } else if (d && d.episodes && idx === d.episodes.length - 1) {
              hasSkippedOutroRef.current = true;
              player.notice.show = '已到达最后一集片尾';
            }
          }
        }
      });

      artPlayerRef.current.on('error', (_err: any) => {
        isLoadingNewStreamRef.current = false;
        setIsVideoLoading(false);
        if (artPlayerRef.current?.currentTime > 0) return;
      });

      artPlayerRef.current.on('video:ended', () => {
        releaseWakeLock();
        if (
          videoEndedHandledRef.current ||
          isSkipControllerTriggeredRef.current
        ) {
          return;
        }
        videoEndedHandledRef.current = true;
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (d && d.episodes && idx < d.episodes.length - 1) {
          setTimeout(() => {
            handleNextEpisode(true);
          }, 500);
        }
      });

      // 绑定轻触/点击唤醒分辨率徽章
      const playerEl = getPlayerRoot();
      if (playerEl) {
        const handleUserInteract = () => {
          showResolutionBadgeTemporarily();
        };
        playerEl.addEventListener('touchstart', handleUserInteract, {
          passive: true,
        });
        playerEl.addEventListener('click', handleUserInteract, {
          passive: true,
        });
      }
    } catch (_err) {
      isLoadingNewStreamRef.current = false;
      setIsVideoLoading(false);
      setError('播放器初始化失败');
    }
  }, [Artplayer, Hls, videoUrl, loading, blockAdEnabled]);

  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
      releaseWakeLock();
      cleanupPlayer();
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            <div className='relative mb-8'>
              <div className='relative mx-auto w-28 h-28 flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <img
                  src='/logo.png'
                  alt='Logo'
                  className='w-full h-full object-contain drop-shadow-2xl select-none animate-pulse'
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            <div className='mb-6 w-full max-w-[20rem] mx-auto'>
              <div className='flex justify-center space-x-2 mb-4'>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'searching' || loadingStage === 'fetching'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'preferring' ||
                        loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'preferring'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'ready'
                      ? 'bg-green-500 scale-125'
                      : 'bg-gray-300'
                  }`}
                ></div>
              </div>
              <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'searching' ||
                      loadingStage === 'fetching'
                        ? '33%'
                        : loadingStage === 'preferring'
                        ? '66%'
                        : '100%',
                  }}
                ></div>
              </div>
            </div>

            <div className='space-y-2'>
              <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
                {loadingMessage}
              </p>
              {loadingStage === 'preferring' && speedTestProgress.total > 0 && (
                <p className='text-sm text-gray-500 dark:text-gray-400'>
                  已完成 {speedTestProgress.completed} /{' '}
                  {speedTestProgress.total} 个播放源测速
                </p>
              )}
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-pink-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>😵</div>
                <div className='absolute -inset-2 bg-gradient-to-r from-red-500 to-pink-600 rounded-2xl opacity-20 animate-pulse'></div>
              </div>
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-red-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-yellow-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
                哎呀，出现了一些问题
              </h2>
              <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
                  {error}
                </p>
              </div>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                请检查网络连接或尝试刷新页面
              </p>
            </div>

            <div className='space-y-3'>
              <button
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='w-full px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
              >
                {videoTitle ? '🔍 返回搜索' : '← 返回上页'}
              </button>
              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200'
              >
                🔄 重新尝试
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/play'>
      <div className='flex flex-col w-full max-w-full min-w-0 gap-3 py-4 px-4 sm:px-5 lg:px-[3rem] 2xl:px-20'>
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {videoTitle || '影片标题'}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400'>
                {` > ${
                  (detail as any)?.episodes_titles?.[currentEpisodeIndex] ||
                  `第 ${currentEpisodeIndex + 1} 集`
                }`}
              </span>
            )}
          </h1>
        </div>

        <div className='space-y-2'>
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
                  isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 5l7 7-7 7'
                />
              </svg>
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
              </span>
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${
                  isEpisodeSelectorCollapsed
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-green-400'
                }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${
              isEpisodeSelectorCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            <div
              className={`h-full min-w-0 transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${
                isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                ></div>
                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      <div className='relative mb-6'>
                        <div className='relative mx-auto w-28 h-28 flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <img
                            src='/logo.png'
                            alt='Logo'
                            className='w-full h-full object-contain drop-shadow-2xl select-none animate-pulse'
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        </div>
                        <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                          <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                          <div
                            className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                            style={{ animationDelay: '0.5s' }}
                          ></div>
                          <div
                            className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                            style={{ animationDelay: '1s' }}
                          ></div>
                        </div>
                      </div>
                      <div className='space-y-2'>
                        <p className='text-xl font-semibold text-white animate-pulse'>
                          {videoLoadingStage === 'sourceChanging'
                            ? '🔯 切换播放源...'
                            : '🔅 视频加载中...'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              className={`h-[300px] lg:h-full min-w-0 overflow-hidden transition-all duration-300 ease-in-out ${
                isEpisodeSelectorCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                episodes_titles={(detail as any)?.episodes_titles || []}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                videoYear={videoYear}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
              />
            </div>
          </div>
        </div>

        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
                {videoTitle || '影片标题'}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  className='ml-3 flex-shrink-0 hover:opacity-80 transition-opacity'
                  title={favorited ? '取消收藏' : '加入收藏'}
                >
                  <FavoriteIcon filled={favorited} />
                </button>
                <button
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDownloadSelector(true);
                  }}
                  className='ml-2.5 flex-shrink-0 p-1.5 rounded-lg text-gray-600 hover:text-green-500 dark:text-gray-300 dark:hover:text-green-400 hover:bg-green-500/10 transition-colors'
                  title='选择集数分片下载'
                >
                  <Download className='h-6 w-6 stroke-[1.5]' />
                </button>
              </h1>
              <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0'>
                {detail?.class && (
                  <span className='text-green-600 font-semibold'>
                    {detail.class}
                  </span>
                )}
                {(detail?.year || videoYear) && (
                  <span>{detail?.year || videoYear}</span>
                )}
                {detail?.source_name && (
                  <span className='border border-gray-500/60 px-2 py-[1px] rounded'>
                    {detail.source_name}
                  </span>
                )}
                {detail?.type_name && <span>{detail.type_name}</span>}
              </div>
              {detail?.desc && (
                <div
                  className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {detail.desc}
                </div>
              )}
            </div>
          </div>

          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='relative bg-gray-300 dark:bg-gray-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
                {videoCover ? (
                  <>
                    <img
                      src={processImageUrl(videoCover)}
                      alt={videoTitle}
                      className='w-full h-full object-cover'
                    />
                    {videoDoubanId !== 0 && (
                      <a
                        href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='absolute top-3 left-3'
                      >
                        <div className='bg-green-500 text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
                          <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          >
                            <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                            <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                          </svg>
                        </div>
                      </a>
                    )}
                  </>
                ) : (
                  <span className='text-gray-600 dark:text-gray-400'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <DownloadEpisodeSelector
        isOpen={showDownloadSelector}
        onClose={() => setShowDownloadSelector(false)}
        totalEpisodes={totalEpisodes}
        episodesTitles={(detail as any)?.episodes_titles || []}
        videoTitle={videoTitle}
        currentEpisodeIndex={currentEpisodeIndex}
        onDownload={handleDownloadEpisodes}
        onOpenDownloadPanel={() => setShowDownloadPanel(true)}
      />
    </PageLayout>
  );
}

const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444'
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <img
            src='/logo.png'
            alt='Logo'
            className='w-24 h-24 object-contain drop-shadow-2xl select-none animate-pulse'
          />
        </div>
      }
    >
      <PlayPageClient />
    </Suspense>
  );
}
