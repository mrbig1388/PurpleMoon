/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any, no-console, @next/next/no-img-element */
'use client';

import { ChevronUp, Grid2x2, List, RefreshCw, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import PageLayout from '@/components/PageLayout';
import SearchResultFilter, {
  SearchFilterCategory,
} from '@/components/SearchResultFilter';
import VideoCard from '@/components/VideoCard';

function SearchPageClient() {
  // 搜索历史
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState('');
  const currentQueryRef = useRef('');
  const [isLoading, setIsLoading] = useState(false);
  // 已有部分结果、其余资源站仍在搜索中
  const [isStreaming, setIsStreaming] = useState(false);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  // 用于取消上一次尚未结束的搜索，避免旧结果覆盖新结果
  const abortRef = useRef<AbortController | null>(null);
  // 记录最近一次已触发的搜索词，防止 handleSearch 与 useEffect([searchParams]) 双重触发
  const lastTriggeredQueryRef = useRef<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // 精确搜索设置（默认开启，持久化到 localStorage）
  const getInitialExactSearch = (): boolean => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('exactSearch');
        if (saved !== null) {
          const parsed = JSON.parse(saved);
          if (typeof parsed === 'boolean') return parsed;
          return saved === 'true';
        }
      } catch {
        return localStorage.getItem('exactSearch') === 'true';
      }
    }
    return true;
  };

  const [exactSearch, setExactSearch] = useState<boolean>(getInitialExactSearch);

  // 获取默认聚合设置：只读取用户本地设置，默认为 true
  const getDefaultAggregate = (): boolean => {
    if (typeof window !== 'undefined') {
      try {
        const userSetting = localStorage.getItem('defaultAggregateSearch');
        if (userSetting !== null) {
          return Boolean(JSON.parse(userSetting));
        }
      } catch {
        // 忽略，走默认值
      }
    }
    return true;
  };

  // 是否启用流式搜索：读取用户本地设置，默认开启；值缺失或损坏时按开启处理
  const getEnableStreamSearch = (): boolean => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('enableStreamSearch');
        if (saved !== null) {
          const parsed = JSON.parse(saved);
          if (typeof parsed === 'boolean') return parsed;
        }
      } catch {
        // 忽略，走默认值
      }
    }
    return true;
  };

  const [enableStreamSearch, setEnableStreamSearch] = useState<boolean>(
    getEnableStreamSearch
  );

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

  // 卡片 / 列表视图模式（持久化到 localStorage）
  const getInitialDisplayMode = (): 'card' | 'list' => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('searchResultDisplayMode');
      if (saved === 'card' || saved === 'list') {
        return saved;
      }
    }
    return 'card';
  };

  const [resultDisplayMode, setResultDisplayMode] = useState<'card' | 'list'>(
    getInitialDisplayMode
  );

  // 高级下拉菜单开关与外部点击关闭引用
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const advancedDropdownRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [expandedSourceTags, setExpandedSourceTags] = useState<
    Record<string, boolean>
  >({});

  // 过滤器状态：非聚合与聚合
  const [filterAll, setFilterAll] = useState<{
    source: string;
    title: string;
    year: string;
    yearOrder: 'none' | 'asc' | 'desc';
  }>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });

  const [filterAgg, setFilterAgg] = useState<{
    source: string;
    title: string;
    year: string;
    yearOrder: 'none' | 'asc' | 'desc';
  }>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('searchResultDisplayMode', resultDisplayMode);
    }
  }, [resultDisplayMode]);

  useEffect(() => {
    if (!advancedOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedButton = advancedButtonRefs.current.some((ref) =>
        ref?.contains(target)
      );
      const clickedDropdown = advancedDropdownRefs.current.some((ref) =>
        ref?.contains(target)
      );

      if (!clickedButton && !clickedDropdown) {
        setAdvancedOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [advancedOpen]);

  // 切换聚合模式并持久化
  const handleViewModeToggle = () => {
    const nextMode = viewMode === 'agg' ? 'all' : 'agg';
    setViewMode(nextMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'defaultAggregateSearch',
        JSON.stringify(nextMode === 'agg')
      );
    }
  };

  // 切换精确搜索并持久化
  const handleExactSearchToggle = (value: boolean) => {
    setExactSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('exactSearch', JSON.stringify(value));
    }
  };

  // 切换流式搜索并持久化
  const handleStreamSearchToggle = (value: boolean) => {
    setEnableStreamSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableStreamSearch', JSON.stringify(value));
    }
  };

  // 规范化标题用于聚合（去除特殊符号、括号、空格和全角空格）
  const normalizeTitle = (title: string) => {
    return (title || '')
      .replace(/[\s\u3000]/g, '') // 去除空格和全角空格
      .replace(/[()（）[\]【】{}「」『』<>《》]/g, '') // 去除各种括号
      .replace(/[^\w\u4e00-\u9fa5]/g, '') // 去除特殊符号，保留字母、数字、下划线和中文
      .toLowerCase();
  };

  // 辅助函数：多信号识别视频类型（参照 MoonTVPlus）
  const getType = (item: SearchResult): 'movie' | 'tv' => {
    // 1. Emby 和 OpenList 源：使用 type_name
    if (
      item.source === 'emby' ||
      item.source?.startsWith('emby_') ||
      item.source === 'openlist'
    ) {
      return item.type_name === '电影' ? 'movie' : 'tv';
    }

    // 2. API 采集源：综合判断
    const typeName = item.type_name?.toLowerCase() || '';

    // 2.1 明确包含"电影"或"movie"或"片"的，判断为电影
    if (
      typeName.includes('电影') ||
      typeName.includes('movie') ||
      (typeName.endsWith('片') && !typeName.includes('动漫'))
    ) {
      return 'movie';
    }

    // 2.2 包含"剧"、"动漫"、"综艺"等关键词的，判断为剧集
    if (
      typeName.includes('剧') ||
      typeName.includes('动漫') ||
      typeName.includes('综艺') ||
      typeName.includes('anime')
    ) {
      return 'tv';
    }

    // 2.3 检查 episodes_titles：如果包含"第X集"，判断为剧集
    if (item.episodes_titles && item.episodes_titles.length > 0) {
      const firstTitle = item.episodes_titles[0] || '';
      if (/第\d+集|第\d+话|EP?\d+/i.test(firstTitle)) {
        return 'tv';
      }
    }

    // 2.4 兜底：使用 episodes.length
    return item.episodes.length === 1 ? 'movie' : 'tv';
  };

  // 辅助函数：检查标题是否包含搜索词（用于精确搜索）
  const titleContainsQuery = (title: string, query: string): boolean => {
    if (!exactSearch) return true;
    const q = (query || '').trim();
    if (!q || !title) return true;
    return title.toLowerCase().includes(q.toLowerCase());
  };

  // 精确搜索过滤后的结果集
  const allExactSearchResults = useMemo(() => {
    const activeQuery = submittedSearchQuery || searchQuery;
    if (!exactSearch) return searchResults;
    return searchResults.filter((item) =>
      titleContainsQuery(item.title, activeQuery)
    );
  }, [searchResults, submittedSearchQuery, searchQuery, exactSearch]);

  // 计算聚合组统计数据（高频集数、去重源名列表、高频豆瓣 ID）
  const computeGroupStats = (group: SearchResult[]) => {
    const episodes = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        const len = g.episodes?.length || 0;
        if (len > 0) countMap.set(len, (countMap.get(len) || 0) + 1);
      });
      let max = 0;
      let res = 0;
      countMap.forEach((v, k) => {
        if (v > max) {
          max = v;
          res = k;
        }
      });
      return res;
    })();

    const source_names = Array.from(
      new Set(group.map((g) => g.source_name).filter(Boolean))
    ) as string[];

    const douban_id = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        if (g.douban_id && g.douban_id > 0) {
          countMap.set(g.douban_id, (countMap.get(g.douban_id) || 0) + 1);
        }
      });
      let max = 0;
      let res: number | undefined;
      countMap.forEach((v, k) => {
        if (v > max) {
          max = v;
          res = k;
        }
      });
      return res;
    })();

    return { episodes, source_names, douban_id };
  };

  // 两阶段搜索聚合升级（参照 MoonTVPlus）
  const aggregatedResults = useMemo(() => {
    // ===== 阶段1：按 normalizedTitle-type 初步分组 =====
    const preliminaryMap = new Map<string, SearchResult[]>();

    allExactSearchResults.forEach((item) => {
      const normalized = normalizeTitle(item.title) || item.title.trim();
      const type = getType(item);
      const preliminaryKey = `${normalized}-${type}`;

      const arr = preliminaryMap.get(preliminaryKey) || [];
      arr.push(item);
      preliminaryMap.set(preliminaryKey, arr);
    });

    // ===== 阶段2：智能年份推断和最终分组 =====
    const finalMap = new Map<string, SearchResult[]>();
    const keyOrder: string[] = [];

    preliminaryMap.forEach((group, preliminaryKey) => {
      const withYear = new Map<string, SearchResult[]>();
      const withoutYear: SearchResult[] = [];

      group.forEach((item) => {
        const year = item.year;
        if (
          year &&
          year.trim() !== '' &&
          year !== 'unknown' &&
          /^\d{4}$/.test(year.trim())
        ) {
          const cleanYear = year.trim();
          const arr = withYear.get(cleanYear) || [];
          arr.push(item);
          withYear.set(cleanYear, arr);
        } else {
          withoutYear.push(item);
        }
      });

      if (withYear.size > 0) {
        // 将无年份的结果合并到每个有年份的同名同类型组中
        withYear.forEach((yearGroup, year) => {
          const finalKey = `${preliminaryKey}-${year}`;
          const mergedGroup = [...yearGroup, ...withoutYear];
          finalMap.set(finalKey, mergedGroup);
          keyOrder.push(finalKey);
        });
      } else if (withoutYear.length > 0) {
        const finalKey = `${preliminaryKey}-unknown`;
        finalMap.set(finalKey, withoutYear);
        keyOrder.push(finalKey);
      }
    });

    const resultEntries = keyOrder.map(
      (key) => [key, finalMap.get(key) || []] as [string, SearchResult[]]
    );

    if (searchResults.length > 0) {
      console.log('aggregatedResults:', resultEntries, searchResults);
    }

    return resultEntries;
  }, [allExactSearchResults, searchResults]);

  // 年份排序比较器：unknown/空值始终排在最后
  const compareYear = (
    aYear: string,
    bYear: string,
    order: 'none' | 'asc' | 'desc'
  ) => {
    if (order === 'none') return 0;

    const aIsEmpty = !aYear || aYear === 'unknown';
    const bIsEmpty = !bYear || bYear === 'unknown';

    if (aIsEmpty && bIsEmpty) return 0;
    if (aIsEmpty) return 1;
    if (bIsEmpty) return -1;

    const aNum = parseInt(aYear, 10);
    const bNum = parseInt(bYear, 10);

    return order === 'asc' ? aNum - bNum : bNum - aNum;
  };

  // 构建多维筛选选项（来源、标题、年份）
  const filterOptions = useMemo(() => {
    const buildSourceOptions = (
      sourceEntries: Array<{ source: string; source_name: string }>
    ) => [
      { label: '全部来源', value: 'all' },
      ...Array.from(
        new Map(
          sourceEntries
            .filter(
              (item) =>
                item.source &&
                item.source_name &&
                item.source.trim() !== '' &&
                item.source_name.trim() !== ''
            )
            .map((item) => [item.source, item.source_name] as [string, string])
        ).entries()
      )
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ label, value })),
    ];

    const buildTitleOptions = (titles: string[]) => [
      { label: '全部标题', value: 'all' },
      ...Array.from(new Set(titles))
        .filter((title) => title && title.trim() !== '')
        .sort((a, b) => a.localeCompare(b))
        .map((title) => ({ label: title, value: title })),
    ];

    const buildYearOptions = (years: string[]) => {
      const yearSet = Array.from(
        new Set(years.filter((year) => year && year.trim() !== ''))
      );
      const knownYears = yearSet
        .filter((year) => year !== 'unknown')
        .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
      const hasUnknown = yearSet.includes('unknown');

      return [
        { label: '全部年份', value: 'all' },
        ...knownYears.map((year) => ({ label: year, value: year })),
        ...(hasUnknown ? [{ label: '未知', value: 'unknown' }] : []),
      ];
    };

    const allForSourceOptions = allExactSearchResults.filter((item) => {
      if (filterAll.title !== 'all' && item.title !== filterAll.title)
        return false;
      if (filterAll.year !== 'all' && item.year !== filterAll.year)
        return false;
      return true;
    });

    const allForTitleOptions = allExactSearchResults.filter((item) => {
      if (filterAll.source !== 'all' && item.source !== filterAll.source)
        return false;
      if (filterAll.year !== 'all' && item.year !== filterAll.year)
        return false;
      return true;
    });

    const allForYearOptions = allExactSearchResults.filter((item) => {
      if (filterAll.source !== 'all' && item.source !== filterAll.source)
        return false;
      if (filterAll.title !== 'all' && item.title !== filterAll.title)
        return false;
      return true;
    });

    const aggForSourceOptions = aggregatedResults.filter(([_, group]) => {
      const gTitle = group[0]?.title ?? '';
      const gYear = group[0]?.year ?? 'unknown';
      if (filterAgg.title !== 'all' && gTitle !== filterAgg.title) return false;
      if (filterAgg.year !== 'all' && gYear !== filterAgg.year) return false;
      return true;
    });

    const aggForTitleOptions = aggregatedResults.filter(([_, group]) => {
      const gYear = group[0]?.year ?? 'unknown';
      const hasSource =
        filterAgg.source === 'all'
          ? true
          : group.some((item) => item.source === filterAgg.source);
      if (!hasSource) return false;
      if (filterAgg.year !== 'all' && gYear !== filterAgg.year) return false;
      return true;
    });

    const aggForYearOptions = aggregatedResults.filter(([_, group]) => {
      const gTitle = group[0]?.title ?? '';
      const hasSource =
        filterAgg.source === 'all'
          ? true
          : group.some((item) => item.source === filterAgg.source);
      if (!hasSource) return false;
      if (filterAgg.title !== 'all' && gTitle !== filterAgg.title) return false;
      return true;
    });

    const categoriesAll: SearchFilterCategory[] = [
      {
        key: 'source',
        label: '来源',
        options: buildSourceOptions(
          allForSourceOptions.map((item) => ({
            source: item.source,
            source_name: item.source_name,
          }))
        ),
      },
      {
        key: 'title',
        label: '标题',
        options: buildTitleOptions(
          allForTitleOptions.map((item) => item.title)
        ),
      },
      {
        key: 'year',
        label: '年份',
        options: buildYearOptions(allForYearOptions.map((item) => item.year)),
      },
    ];

    const categoriesAgg: SearchFilterCategory[] = [
      {
        key: 'source',
        label: '来源',
        options: buildSourceOptions(
          aggForSourceOptions.flatMap(([_, group]) =>
            group.map((item) => ({
              source: item.source,
              source_name: item.source_name,
            }))
          )
        ),
      },
      {
        key: 'title',
        label: '标题',
        options: buildTitleOptions(
          aggForTitleOptions.map(([_, group]) => group[0]?.title ?? '')
        ),
      },
      {
        key: 'year',
        label: '年份',
        options: buildYearOptions(
          aggForYearOptions.map(([_, group]) => group[0]?.year ?? 'unknown')
        ),
      },
    ];

    return { categoriesAll, categoriesAgg };
  }, [allExactSearchResults, aggregatedResults, filterAll, filterAgg]);

  // 非聚合：应用筛选与排序
  const filteredAllResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAll;

    const filtered = allExactSearchResults.filter((item) => {
      if (source !== 'all' && item.source !== source) return false;
      if (title !== 'all' && item.title !== title) return false;
      if (year !== 'all' && item.year !== year) return false;
      return true;
    });

    if (yearOrder === 'none') {
      return filtered;
    }

    return filtered.slice().sort((a, b) => {
      const yearComp = compareYear(a.year, b.year, yearOrder);
      if (yearComp !== 0) return yearComp;

      const aExactMatch = a.title === searchQuery.trim();
      const bExactMatch = b.title === searchQuery.trim();
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      return yearOrder === 'asc'
        ? a.title.localeCompare(b.title)
        : b.title.localeCompare(a.title);
    });
  }, [allExactSearchResults, filterAll, searchQuery]);

  // 聚合：应用筛选与排序
  const filteredAggResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAgg;
    const filtered = aggregatedResults.filter(([_, group]) => {
      const gTitle = group[0]?.title ?? '';
      const gYear = group[0]?.year ?? 'unknown';
      const hasSource =
        source === 'all' ? true : group.some((item) => item.source === source);
      if (!hasSource) return false;
      if (title !== 'all' && gTitle !== title) return false;
      if (year !== 'all' && gYear !== year) return false;
      return true;
    });

    if (yearOrder === 'none') {
      return filtered;
    }

    return filtered.slice().sort((a, b) => {
      const aYear = a[1][0]?.year || 'unknown';
      const bYear = b[1][0]?.year || 'unknown';
      const yearComp = compareYear(aYear, bYear, yearOrder);
      if (yearComp !== 0) return yearComp;

      const aExactMatch = a[1][0]?.title === searchQuery.trim();
      const bExactMatch = b[1][0]?.title === searchQuery.trim();
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      const aTitle = a[1][0]?.title || '';
      const bTitle = b[1][0]?.title || '';
      return yearOrder === 'asc'
        ? aTitle.localeCompare(bTitle)
        : bTitle.localeCompare(aTitle);
    });
  }, [aggregatedResults, filterAgg, searchQuery]);

  // 搜索结果统计与聚合/源数据比对信息
  const resultCountMeta = useMemo(() => {
    const isAggregateView = viewMode === 'agg';
    const visibleCount = isAggregateView
      ? filteredAggResults.length
      : filteredAllResults.length;
    const totalCount = isAggregateView
      ? aggregatedResults.length
      : allExactSearchResults.length;

    return {
      visibleCount,
      totalCount,
      isFiltered:
        visibleCount !== totalCount ||
        allExactSearchResults.length !== searchResults.length,
      modeLabel: isAggregateView ? '聚合结果' : '搜索结果',
      unit: isAggregateView ? '组' : '条',
      aggCount: filteredAggResults.length,
      rawCount: searchResults.length,
      exactRawCount: allExactSearchResults.length,
    };
  }, [
    viewMode,
    filteredAggResults.length,
    filteredAllResults.length,
    aggregatedResults.length,
    allExactSearchResults.length,
    searchResults.length,
  ]);

  useEffect(() => {
    if (
      !searchParams.get('q') &&
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 768px)').matches
    ) {
      document.getElementById('searchInput')?.focus();
    }

    getSearchHistory().then(setSearchHistory);

    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const query = searchParams.get('q');
    if (query) {
      const trimmed = query.trim().replace(/\s+/g, ' ');
      setSearchQuery(trimmed);
      setSubmittedSearchQuery(trimmed);
      currentQueryRef.current = trimmed;
      if (lastTriggeredQueryRef.current !== trimmed) {
        lastTriggeredQueryRef.current = trimmed;
        fetchSearchResults(trimmed);
        addSearchHistory(trimmed);
      }
    } else {
      lastTriggeredQueryRef.current = null;
      setShowResults(false);
    }
  }, [searchParams]);

  // 排序：标题与搜索词完全一致的优先，其次按年份从新到旧，未知年份最后
  const sortResults = (list: SearchResult[], query: string) => {
    const q = query.trim();
    return list.slice().sort((a, b) => {
      const aExactMatch = (a.title || '').trim() === q;
      const bExactMatch = (b.title || '').trim() === q;
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      const aNum = Number.parseInt(a.year as any, 10);
      const bNum = Number.parseInt(b.year as any, 10);
      const aValid = !Number.isNaN(aNum);
      const bValid = !Number.isNaN(bNum);
      if (aValid && !bValid) return -1;
      if (!aValid && bValid) return 1;
      if (aValid && bValid && aNum !== bNum) return bNum - aNum;
      return (a.title || '').localeCompare(b.title || '');
    });
  };

  const fetchSearchResults = async (query: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const isStale = () => abortRef.current !== controller;

    const trimmed = query.trim();
    currentQueryRef.current = trimmed;
    setSubmittedSearchQuery(trimmed);

    // 重置筛选条件与展开标签
    setFilterAll((prev) => ({
      source: 'all',
      title: 'all',
      year: 'all',
      yearOrder: prev.yearOrder,
    }));
    setFilterAgg((prev) => ({
      source: 'all',
      title: 'all',
      year: 'all',
      yearOrder: prev.yearOrder,
    }));
    setExpandedSourceTags({});

    const useStream = getEnableStreamSearch();
    setIsLoading(true);
    setIsStreaming(false);
    setTotalSources(0);
    setCompletedSources(0);
    setSearchResults([]);
    setShowResults(true);

    const bySource = new Map<string, SearchResult[]>();
    const completedSourceSet = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (isStale()) return;
      const merged = Array.from(bySource.values()).flat();
      setSearchResults(sortResults(merged, trimmed));
      setShowResults(true);
      setIsLoading(false);
      setIsStreaming(true);
    };
    const scheduleFlush = () => {
      if (flushTimer === null) flushTimer = setTimeout(flush, 100);
    };

    const fallbackToPlainSearch = async () => {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal }
      );
      const data = await response.json();
      if (isStale()) return;
      const list: SearchResult[] = data.results || [];
      const uniqueSources = new Set(list.map((r) => r.source).filter(Boolean));
      const sourceCount = Math.max(uniqueSources.size, list.length > 0 ? 1 : 0);
      setTotalSources(sourceCount);
      setCompletedSources(sourceCount);
      setSearchResults(sortResults(list, trimmed));
    };

    try {
      if (!useStream) {
        await fallbackToPlainSearch();
        if (!isStale()) setShowResults(true);
        return;
      }

      const response = await fetch(
        `/api/search/stream?q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal }
      );

      if (response.status === 429) {
        if (!isStale()) setSearchResults([]);
      } else if (!response.ok || !response.body) {
        await fallbackToPlainSearch();
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const handleLine = (line: string) => {
          if (!line.trim()) return;
          try {
            const msg = JSON.parse(line);
            if (isStale()) return;
            if (msg.type === 'start') {
              if (typeof msg.totalSources === 'number') {
                setTotalSources(msg.totalSources);
              }
            } else if (msg.type === 'results' && Array.isArray(msg.results)) {
              const prev = bySource.get(msg.source) || [];
              bySource.set(msg.source, prev.concat(msg.results));
              scheduleFlush();
            } else if (msg.type === 'source_complete') {
              if (msg.source) completedSourceSet.add(msg.source);
              if (typeof msg.totalSources === 'number') {
                setTotalSources(msg.totalSources);
              }
              if (typeof msg.completedSources === 'number') {
                setCompletedSources(msg.completedSources);
              } else {
                setCompletedSources(completedSourceSet.size);
              }
            } else if (msg.type === 'done') {
              if (typeof msg.totalSources === 'number') {
                setTotalSources(msg.totalSources);
              }
              if (typeof msg.completedSources === 'number') {
                setCompletedSources(msg.completedSources);
              }
            }
          } catch {
            // 忽略损坏的行
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            handleLine(buffer.slice(0, nl));
            buffer = buffer.slice(nl + 1);
          }
        }
        handleLine(buffer);

        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (!isStale()) {
          setSearchResults(
            sortResults(Array.from(bySource.values()).flat(), trimmed)
          );
        }
      }
      if (!isStale()) setShowResults(true);
    } catch (error: any) {
      if (error?.name === 'AbortError' || isStale()) return;
      if (!useStream) {
        setSearchResults([]);
        return;
      }
      try {
        await fallbackToPlainSearch();
        if (!isStale()) setShowResults(true);
      } catch {
        if (!isStale()) setSearchResults([]);
      }
    } finally {
      if (flushTimer !== null) clearTimeout(flushTimer);
      if (!isStale()) {
        setIsLoading(false);
        setIsStreaming(false);
      }
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    setSearchQuery(trimmed);
    setSubmittedSearchQuery(trimmed);
    currentQueryRef.current = trimmed;
    setIsLoading(true);
    setShowResults(true);

    // 标记本次搜索已由表单提交触发，避免 router.push 引发的 useEffect 再次重复发起请求
    lastTriggeredQueryRef.current = trimmed;
    fetchSearchResults(trimmed);
    addSearchHistory(trimmed);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const getSearchResultUrl = (params: {
    title: string;
    year?: string;
    type?: string;
    source?: string;
    id?: string;
    query?: string;
    isAggregate?: boolean;
  }) => {
    const yearParam =
      params.year && params.year !== 'unknown' ? `&year=${params.year}` : '';
    const queryParam = params.query
      ? `&stitle=${encodeURIComponent(params.query.trim())}`
      : '';
    const typeParam = params.type ? `&stype=${params.type}` : '';
    const preferParam = params.isAggregate ? '&prefer=true' : '';

    if (!params.source || !params.id) {
      return `/play?title=${encodeURIComponent(
        params.title.trim()
      )}${yearParam}${typeParam}${preferParam}${queryParam}`;
    }

    return `/play?source=${params.source}&id=${
      params.id
    }&title=${encodeURIComponent(
      params.title.trim()
    )}${yearParam}${preferParam}${queryParam}${typeParam}`;
  };

  const renderTag = (label: string, className: string) => (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ${className}`}
    >
      {label}
    </span>
  );

  // 列表模式单条渲染（参照 MoonTVPlus）
  const renderListItem = (item: {
    key: string;
    title: string;
    poster: string;
    year?: string;
    type: 'movie' | 'tv';
    episodes?: number;
    sourceName?: string;
    sourceNames?: string[];
    doubanId?: number;
    desc?: string;
    vodRemarks?: string;
    isAggregate?: boolean;
    source?: string;
    id?: string;
    query?: string;
  }) => {
    const yearText = item.year && item.year !== 'unknown' ? item.year : '';
    const sourceTags = item.isAggregate
      ? Array.from(new Set(item.sourceNames || []))
      : item.sourceName
      ? [item.sourceName]
      : [];
    const isExpanded = !!expandedSourceTags[item.key];
    const maxVisibleSourceTags = 3;
    const visibleSourceTags = isExpanded
      ? sourceTags
      : sourceTags.slice(0, maxVisibleSourceTags);
    const hiddenSourceCount = Math.max(
      0,
      sourceTags.length - visibleSourceTags.length
    );
    const description = (item.desc || '').trim();
    const itemUrl = getSearchResultUrl({
      title: item.title,
      year: item.year,
      type: item.type,
      source: item.source,
      id: item.id,
      query: item.query,
      isAggregate: item.isAggregate,
    });

    return (
      <div
        key={item.key}
        role='button'
        tabIndex={0}
        onClick={() => router.push(itemUrl)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            router.push(itemUrl);
          }
        }}
        className='group w-full cursor-pointer rounded-2xl border border-gray-200/80 bg-white/90 p-3 text-left shadow-sm transition-all hover:border-green-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900/70 dark:hover:border-green-700'
      >
        <div className='flex items-start gap-4'>
          <div className='relative h-32 w-24 shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800'>
            {item.poster ? (
              <img
                src={processImageUrl(item.poster)}
                alt={item.title}
                referrerPolicy='no-referrer'
                loading='lazy'
                className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]'
              />
            ) : (
              <div className='flex h-full w-full items-center justify-center text-xs text-gray-400'>
                暂无海报
              </div>
            )}
          </div>

          <div className='min-w-0 flex-1'>
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <h3 className='line-clamp-2 text-base font-semibold text-gray-900 transition-colors group-hover:text-green-600 dark:text-gray-100 dark:group-hover:text-green-400'>
                  {item.title}
                </h3>
                <div className='mt-2 flex flex-wrap gap-2'>
                  {renderTag(
                    item.type === 'movie' ? '电影' : '剧集',
                    'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  )}
                  {yearText &&
                    renderTag(
                      yearText,
                      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    )}
                  {item.episodes &&
                    item.episodes > 0 &&
                    renderTag(
                      `${item.episodes}集`,
                      'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                    )}
                  {item.vodRemarks &&
                    renderTag(
                      item.vodRemarks,
                      'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    )}
                  {item.doubanId &&
                    item.doubanId > 0 &&
                    renderTag(
                      '豆瓣',
                      'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    )}
                </div>
              </div>
            </div>

            {description && (
              <p className='mt-3 line-clamp-3 text-sm leading-6 text-gray-600 dark:text-gray-400'>
                {description}
              </p>
            )}
          </div>
        </div>

        {sourceTags.length > 0 && (
          <div
            className={`mt-3 flex gap-2 ${
              isExpanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden'
            }`}
          >
            {visibleSourceTags.map((sourceName) => (
              <span
                key={`${item.key}-${sourceName}`}
                className='inline-flex max-w-full shrink-0 items-center truncate rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                title={sourceName}
              >
                {sourceName}
              </span>
            ))}
            {hiddenSourceCount > 0 && (
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedSourceTags((prev) => ({
                    ...prev,
                    [item.key]: true,
                  }));
                }}
                className='inline-flex shrink-0 items-center rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50'
                aria-label={`展开剩余${hiddenSourceCount}个来源`}
              >
                +{hiddenSourceCount}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // 渲染「高级」下拉菜单内容（包含聚合、精确搜索、流式搜索、卡片/列表显示切换）
  const renderAdvancedDropdown = (refIndex: number) => (
    <div
      ref={(el) => {
        if (el) advancedDropdownRefs.current[refIndex] = el;
      }}
      className='absolute right-0 top-full z-[70] mt-2 w-56 rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900'
    >
      <label className='flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-1 py-2'>
        <span className='text-sm text-gray-700 dark:text-gray-300'>聚合</span>
        <div className='relative'>
          <input
            type='checkbox'
            className='peer sr-only'
            checked={viewMode === 'agg'}
            onChange={handleViewModeToggle}
          />
          <div className='h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
          <div className='absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4'></div>
        </div>
      </label>

      <label className='flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-1 py-2'>
        <span className='text-sm text-gray-700 dark:text-gray-300'>
          精确搜索
        </span>
        <div className='relative'>
          <input
            type='checkbox'
            className='peer sr-only'
            checked={exactSearch}
            onChange={(e) => handleExactSearchToggle(e.target.checked)}
          />
          <div className='h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
          <div className='absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4'></div>
        </div>
      </label>

      <label className='flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-1 py-2'>
        <span className='text-sm text-gray-700 dark:text-gray-300'>
          流式搜索
        </span>
        <div className='relative'>
          <input
            type='checkbox'
            className='peer sr-only'
            checked={enableStreamSearch}
            onChange={(e) => handleStreamSearchToggle(e.target.checked)}
          />
          <div className='h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
          <div className='absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4'></div>
        </div>
      </label>

      <div className='mt-2 border-t border-gray-200 pt-2 dark:border-gray-700'>
        <span className='px-1 text-sm text-gray-700 dark:text-gray-300'>
          显示方式
        </span>
        <div className='mt-2 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800'>
          <button
            type='button'
            onClick={() => setResultDisplayMode('card')}
            className={`inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors ${
              resultDisplayMode === 'card'
                ? 'bg-green-500 text-white'
                : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
            aria-label='切换为卡片视图'
          >
            <Grid2x2 className='h-4 w-4' />
            <span>卡片</span>
          </button>
          <button
            type='button'
            onClick={() => setResultDisplayMode('list')}
            className={`inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors ${
              resultDisplayMode === 'list'
                ? 'bg-green-500 text-white'
                : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
            aria-label='切换为列表视图'
          >
            <List className='h-4 w-4' />
            <span>列表</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <PageLayout activePath='/search'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        {/* 搜索框 */}
        <div className='mb-0'>
          <form onSubmit={handleSearch} className='max-w-2xl mx-auto'>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='搜索电影、电视剧...'
                autoComplete='off'
                className='w-full h-12 rounded-lg bg-gray-50/80 py-3 pl-10 pr-12 text-base sm:text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:bg-white border border-gray-200/50 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 dark:border-gray-700'
              />
              {searchQuery && (
                <button
                  type='button'
                  onClick={() => {
                    setSearchQuery('');
                    document.getElementById('searchInput')?.focus();
                  }}
                  className='absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors dark:text-gray-500 dark:hover:text-gray-300'
                  aria-label='清除搜索内容'
                >
                  <X className='h-5 w-5' />
                </button>
              )}
            </div>
          </form>

          {!showResults && (
            <div className='mx-auto mt-4 flex max-w-2xl justify-end'>
              <div className='relative'>
                <button
                  ref={(el) => {
                    if (el) advancedButtonRefs.current[0] = el;
                  }}
                  type='button'
                  onClick={() => setAdvancedOpen((prev) => !prev)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    advancedOpen
                      ? 'bg-green-50 text-green-600 dark:bg-gray-700/70 dark:text-green-400'
                      : 'text-gray-600 hover:bg-green-50 hover:text-green-600 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-green-400'
                  }`}
                  aria-expanded={advancedOpen}
                >
                  <span>高级</span>
                  <ChevronUp
                    className={`h-4 w-4 transition-transform ${
                      advancedOpen ? '' : 'rotate-180'
                    }`}
                  />
                </button>
                {advancedOpen && renderAdvancedDropdown(0)}
              </div>
            </div>
          )}
        </div>

        {/* 搜索结果或搜索历史 */}
        <div
          className={`max-w-[95%] mx-auto overflow-visible ${
            !showResults ? 'mt-4' : 'mt-10'
          }`}
        >
          {showResults ? (
            <section className='mb-12'>
              {/* 标题 + 聚合结果与搜索源比对统计 + 刷新按钮 */}
              <div className='mb-4 flex items-start justify-between gap-4'>
                <div className='min-w-0'>
                  <h2 className='flex flex-wrap items-start gap-x-3 gap-y-1 text-xl font-bold text-gray-800 dark:text-gray-200'>
                    <span className='inline-flex items-center gap-2'>
                      搜索结果
                    </span>
                    <span className='flex flex-col text-xs font-medium leading-5 text-gray-500 dark:text-gray-400'>
                      <span>
                        {resultCountMeta.modeLabel}{' '}
                        {resultCountMeta.visibleCount.toLocaleString()}{' '}
                        {resultCountMeta.unit}
                        {resultCountMeta.isFiltered && (
                          <span className='ml-1 text-gray-400 dark:text-gray-500'>
                            / 筛选前{' '}
                            {resultCountMeta.totalCount.toLocaleString()}{' '}
                            {resultCountMeta.unit}
                          </span>
                        )}
                        <span className='ml-2 text-gray-400 dark:text-gray-500'>
                          {viewMode === 'agg'
                            ? `（源结果 ${resultCountMeta.exactRawCount.toLocaleString()}${
                                resultCountMeta.exactRawCount !==
                                resultCountMeta.rawCount
                                  ? ` / ${resultCountMeta.rawCount.toLocaleString()}`
                                  : ''
                              } 条）`
                            : `（聚合 ${resultCountMeta.aggCount.toLocaleString()} 组）`}
                        </span>
                      </span>
                      {totalSources > 0 && (
                        <span className='inline-flex items-center gap-1'>
                          源 {completedSources}/{totalSources}
                          {(isLoading || isStreaming) && (
                            <span className='inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-green-500'></span>
                          )}
                        </span>
                      )}
                    </span>
                  </h2>
                </div>
                <div className='flex shrink-0 items-center gap-2'>
                  {searchQuery && (
                    <button
                      type='button'
                      onClick={() => {
                        const trimmed = (
                          submittedSearchQuery || searchQuery
                        ).trim();
                        if (trimmed) {
                          fetchSearchResults(trimmed);
                        }
                      }}
                      disabled={isLoading || isStreaming}
                      className='flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-green-50 hover:text-green-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-green-400'
                      aria-label='强制刷新搜索结果'
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${
                          isLoading || isStreaming ? 'animate-spin' : ''
                        }`}
                      />
                      <span>刷新</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 来源 / 标题 / 年份 筛选栏 + 高级（聚合/精确搜索/流式搜索/卡片与列表显示切换） */}
              <div className='mb-4 flex items-center gap-3'>
                <div className='min-w-0 flex-1'>
                  {viewMode === 'agg' ? (
                    <SearchResultFilter
                      categories={filterOptions.categoriesAgg}
                      values={filterAgg}
                      onChange={(v) => setFilterAgg(v)}
                    />
                  ) : (
                    <SearchResultFilter
                      categories={filterOptions.categoriesAll}
                      values={filterAll}
                      onChange={(v) => setFilterAll(v)}
                    />
                  )}
                </div>
                <div className='relative flex shrink-0 items-center justify-end self-center'>
                  <button
                    ref={(el) => {
                      if (el) advancedButtonRefs.current[1] = el;
                    }}
                    type='button'
                    onClick={() => setAdvancedOpen((prev) => !prev)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      advancedOpen
                        ? 'bg-green-50 text-green-600 dark:bg-gray-700/70 dark:text-green-400'
                        : 'text-gray-600 hover:bg-green-50 hover:text-green-600 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-green-400'
                    }`}
                    aria-expanded={advancedOpen}
                  >
                    <span>高级</span>
                    <ChevronUp
                      className={`h-4 w-4 transition-transform ${
                        advancedOpen ? '' : 'rotate-180'
                      }`}
                    />
                  </button>
                  {advancedOpen && renderAdvancedDropdown(1)}
                </div>
              </div>

              {/* 结果列表 / 卡片网格 */}
              {(viewMode === 'agg'
                ? filteredAggResults.length === 0
                : filteredAllResults.length === 0) ? (
                isLoading || isStreaming ? (
                  <div className='flex justify-center items-center h-40'>
                    <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
                  </div>
                ) : (
                  <div className='text-center text-gray-500 py-8 dark:text-gray-400'>
                    未找到相关结果
                  </div>
                )
              ) : (
                <div
                  key={`search-results-${viewMode}-${resultDisplayMode}`}
                  className={
                    resultDisplayMode === 'list'
                      ? 'space-y-4'
                      : 'justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'
                  }
                >
                  {viewMode === 'agg'
                    ? filteredAggResults.map(([mapKey, group]) => {
                        const first = group[0];
                        const title = first?.title || '';
                        const poster = first?.poster || '';
                        const year = first?.year || 'unknown';
                        const desc =
                          group.find((entry) => entry.desc?.trim())?.desc || '';
                        const vodRemarks =
                          group.find((entry) => entry.vod_remarks?.trim())
                            ?.vod_remarks || '';
                        const { episodes, source_names, douban_id } =
                          computeGroupStats(group);

                        const lastDashIndex = mapKey.lastIndexOf('-');
                        const secondLastDashIndex = mapKey.lastIndexOf(
                          '-',
                          lastDashIndex - 1
                        );
                        const type =
                          secondLastDashIndex > 0
                            ? (mapKey.substring(
                                secondLastDashIndex + 1,
                                lastDashIndex
                              ) as 'movie' | 'tv')
                            : episodes === 1
                            ? 'movie'
                            : 'tv';

                        if (resultDisplayMode === 'list') {
                          return renderListItem({
                            key: `agg-${mapKey}`,
                            source: first?.source,
                            id: first?.id,
                            title,
                            poster,
                            year,
                            type,
                            episodes,
                            sourceNames: source_names,
                            doubanId: douban_id,
                            desc,
                            vodRemarks,
                            isAggregate: true,
                            query:
                              searchQuery.trim() !== title
                                ? searchQuery.trim()
                                : '',
                          });
                        }

                        return (
                          <div key={`agg-${mapKey}`} className='w-full'>
                            <VideoCard
                              from='search'
                              isAggregate={true}
                              items={group}
                              title={title}
                              poster={poster}
                              year={year}
                              episodes={episodes}
                              source_names={source_names}
                              douban_id={douban_id}
                              type={type}
                              query={
                                searchQuery.trim() !== title
                                  ? searchQuery.trim()
                                  : ''
                              }
                            />
                          </div>
                        );
                      })
                    : filteredAllResults.map((item) => {
                        const type = getType(item);

                        if (resultDisplayMode === 'list') {
                          return renderListItem({
                            key: `all-${item.source}-${item.id}`,
                            id: item.id,
                            title: item.title,
                            poster: item.poster,
                            episodes: item.episodes.length,
                            source: item.source,
                            sourceName: item.source_name,
                            doubanId: item.douban_id,
                            query:
                              searchQuery.trim() !== item.title
                                ? searchQuery.trim()
                                : '',
                            year: item.year,
                            type,
                            desc: item.desc,
                            vodRemarks: item.vod_remarks,
                          });
                        }

                        return (
                          <div
                            key={`all-${item.source}-${item.id}`}
                            className='w-full'
                          >
                            <VideoCard
                              id={item.id}
                              title={item.title}
                              poster={item.poster}
                              episodes={item.episodes.length}
                              source={item.source}
                              source_name={item.source_name}
                              douban_id={item.douban_id}
                              query={
                                searchQuery.trim() !== item.title
                                  ? searchQuery.trim()
                                  : ''
                              }
                              year={item.year}
                              from='search'
                              type={type}
                            />
                          </div>
                        );
                      })}
                </div>
              )}
            </section>
          ) : searchHistory.length > 0 ? (
            // 搜索历史
            <section className='mb-12'>
              <h2 className='mb-4 text-xl font-bold text-gray-800 text-left dark:text-gray-200'>
                搜索历史
                {searchHistory.length > 0 && (
                  <button
                    onClick={() => {
                      clearSearchHistory();
                    }}
                    className='ml-3 text-sm text-gray-500 hover:text-red-500 transition-colors dark:text-gray-400 dark:hover:text-red-500'
                  >
                    清空
                  </button>
                )}
              </h2>
              <div className='flex flex-wrap gap-2'>
                {searchHistory.map((item) => (
                  <div key={item} className='relative group'>
                    <button
                      onClick={() => {
                        const trimmed = item.trim();
                        setSearchQuery(trimmed);
                        setSubmittedSearchQuery(trimmed);
                        currentQueryRef.current = trimmed;
                        lastTriggeredQueryRef.current = trimmed;
                        fetchSearchResults(trimmed);
                        addSearchHistory(trimmed);
                        router.push(
                          `/search?q=${encodeURIComponent(trimmed)}`
                        );
                      }}
                      className='px-4 py-2 bg-gray-500/10 hover:bg-gray-300 rounded-full text-sm text-gray-700 transition-colors duration-200 dark:bg-gray-700/50 dark:hover:bg-gray-600 dark:text-gray-300'
                    >
                      {item}
                    </button>
                    {/* 删除按钮 */}
                    <button
                      aria-label='删除搜索历史'
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        deleteSearchHistory(item);
                      }}
                      className='absolute -top-1 -right-1 w-4 h-4 opacity-0 group-hover:opacity-100 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-colors'
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
