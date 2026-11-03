/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

export interface VideoSourceTestResult {
  quality: string; // 如720p、1080p、可用、不可用等
  loadSpeed: string; // 可用状态或速率描述
  pingTime: number; // 网络延迟（毫秒）
  hasError?: boolean;
}

/**
 * 根据视频 URL 推断 Artplayer 播放类型
 */
export function getArtPlayerType(url: string): string {
  if (!url) return 'm3u8';
  const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
  if (cleanUrl.endsWith('.mp4')) return 'mp4';
  if (cleanUrl.endsWith('.flv')) return 'flv';
  if (cleanUrl.endsWith('.webm')) return 'webm';
  if (cleanUrl.endsWith('.ogg')) return 'ogg';
  if (cleanUrl.endsWith('.mkv')) return 'mkv';
  if (cleanUrl.includes('.m3u8')) return 'm3u8';
  return 'm3u8';
}

function sanitizeImageProxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * 获取图片代理 URL 设置
 */
export function getImageProxyUrl(): string | null {
  if (typeof window === 'undefined') return null;

  // 本地未开启图片代理，则不使用代理
  const enableImageProxy = localStorage.getItem('enableImageProxy');
  if (enableImageProxy !== null) {
    // 2.8.8：localStorage 值损坏时（JSON.parse 抛错）视为未设置，而不是让所有页面崩溃
    let enabled: unknown = true;
    try {
      enabled = JSON.parse(enableImageProxy);
    } catch {
      enabled = true;
    }
    if (enabled === false) {
      return null;
    }
  }

  const localImageProxy = localStorage.getItem('imageProxyUrl');
  const sanitizedLocalImageProxy = sanitizeImageProxyUrl(localImageProxy);
  if (sanitizedLocalImageProxy) {
    return sanitizedLocalImageProxy;
  }

  // 如果未设置，则使用全局对象
  const serverImageProxy = (window as any).RUNTIME_CONFIG?.IMAGE_PROXY;
  return sanitizeImageProxyUrl(serverImageProxy);
}

/**
 * 处理图片 URL，如果设置了图片代理则使用代理
 */
export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  const proxyUrl = getImageProxyUrl();
  if (!proxyUrl) return originalUrl;

  return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
}

export function cleanHtmlTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '\n') // 将 HTML 标签替换为换行
    .replace(/\n+/g, '\n') // 将多个连续换行合并为一个
    .replace(/[ \t]+/g, ' ') // 将多个连续空格和制表符合并为一个空格，但保留换行符
    .replace(/^\n+|\n+$/g, '') // 去掉首尾换行
    .replace(/&nbsp;/g, ' ') // 将 &nbsp; 替换为空格
    .trim(); // 去掉首尾空格
}

function parseQualityFromM3u8Text(content: string): string {
  const regex = /RESOLUTION=(\d+)x(\d+)/gi;
  let maxWidth = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const w = parseInt(match[1], 10);
    const h = parseInt(match[2], 10);
    const dim = Math.max(w, h);
    if (dim > maxWidth) {
      maxWidth = dim;
    }
  }
  if (maxWidth <= 0) return '可用';
  if (maxWidth >= 3840) return '4K';
  if (maxWidth >= 2560) return '2K';
  if (maxWidth >= 1920) return '1080p';
  if (maxWidth >= 1280) return '720p';
  if (maxWidth >= 854) return '480p';
  return 'SD';
}

/**
 * 轻量级检测播放源可用性、响应延迟与清单分辨率（不创建后台 <video> 或 Hls 实例、不下载 .ts 视频分片，
 * 彻底消除后台测速对主播放器加载、换源及正常播放流畅度的干扰）
 * @param m3u8Url 播放列表的 URL
 */
export async function getVideoResolutionFromM3u8(
  m3u8Url: string
): Promise<VideoSourceTestResult> {
  if (!m3u8Url || !/^https?:\/\//i.test(m3u8Url.trim())) {
    throw new Error('Invalid video URL');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  const pingStart = performance.now();

  try {
    const type = getArtPlayerType(m3u8Url);
    if (type !== 'm3u8') {
      await fetch(m3u8Url, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      });
      const pingTime = Math.max(1, Math.round(performance.now() - pingStart));
      return {
        quality: '可用',
        loadSpeed: '可用',
        pingTime,
      };
    }

    const response = await fetch(m3u8Url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal,
    });

    const pingTime = Math.max(1, Math.round(performance.now() - pingStart));

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    if (
      !text ||
      (!text.includes('#EXTM3U') &&
        !text.includes('#EXTINF') &&
        !text.includes('#EXT-X-STREAM-INF'))
    ) {
      throw new Error('Invalid M3U8 playlist');
    }

    const quality = parseQualityFromM3u8Text(text);

    return {
      quality,
      loadSpeed: '可用',
      pingTime,
    };
  } catch (error) {
    throw new Error(
      `Source check failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 校验并返回安全的重定向 URL，防范开放重定向 (Open Redirect) 与 XSS 攻击
 * @param url 待校验的 URL（通常来自 searchParams）
 * @param fallback 默认回跳地址（必须是安全的相对路径，默认 '/'）
 * @returns 安全的同源相对路径
 */
export function getSafeRedirectUrl(
  url: string | null | undefined,
  fallback = '/'
): string {
  if (!url || typeof url !== 'string') return fallback;

  // 1. 拒绝任何控制字符（含 TAB/CR/LF）和反斜杠：
  //    浏览器的 URL 解析会剔除 TAB/CR/LF，'/\t/evil.com' 会被还原成 '//evil.com'；
  //    反斜杠在部分浏览器中会被当作 '/'。
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(url)) return fallback;

  // 2. 必须是以单个 '/' 开头的站内相对路径，禁止 '//'（协议相对 URL）
  if (!url.startsWith('/') || url.startsWith('//')) return fallback;

  // 3. 兜底：按浏览器规则解析一遍，必须仍然同源
  try {
    const base = 'http://local.invalid';
    const u = new URL(url, base);
    if (u.origin !== base) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
