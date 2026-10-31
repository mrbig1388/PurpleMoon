/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

interface DownloadEpisodeSelectorProps {
  /** 是否显示弹窗 */
  isOpen: boolean;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 总集数 */
  totalEpisodes: number;
  /** 剧集标题 */
  episodesTitles?: string[];
  /** 视频标题 */
  videoTitle: string;
  /** 当前集数索引（0开始） */
  currentEpisodeIndex: number;
  /** 下载回调 - 支持批量下载 */
  onDownload: (episodeIndexes: number[]) => void;
  /** 打开下载任务管理面板 */
  onOpenDownloadPanel?: () => void;
}

/**
 * 视频分片下载选集面板组件
 */
const DownloadEpisodeSelector: React.FC<DownloadEpisodeSelectorProps> = ({
  isOpen,
  onClose,
  totalEpisodes,
  episodesTitles = [],
  videoTitle,
  currentEpisodeIndex,
  onDownload,
  onOpenDownloadPanel,
}) => {
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(
    new Set([currentEpisodeIndex])
  );

  const episodesPerPage = 50;
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  const initialPage = Math.floor(currentEpisodeIndex / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [descending, setDescending] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const displayPage = useMemo(() => {
    if (descending) {
      return pageCount - 1 - currentPage;
    }
    return currentPage;
  }, [currentPage, descending, pageCount]);

  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  const categories = useMemo(() => {
    if (descending) {
      return [...categoriesAsc]
        .reverse()
        .map(({ start, end }) => `${end}-${start}`);
    }
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc, descending]);

  const handleCategoryClick = (index: number) => {
    if (descending) {
      setCurrentPage(pageCount - 1 - index);
    } else {
      setCurrentPage(index);
    }
  };

  const handleEpisodeClick = (episodeIndex: number) => {
    setSelectedEpisodes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(episodeIndex)) {
        newSet.delete(episodeIndex);
      } else {
        newSet.add(episodeIndex);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const allEpisodes = Array.from({ length: totalEpisodes }, (_, i) => i);
    setSelectedEpisodes(new Set(allEpisodes));
  };

  const handleClearAll = () => {
    setSelectedEpisodes(new Set());
  };

  const handleDownload = () => {
    const episodeIndexes = Array.from(selectedEpisodes).sort((a, b) => a - b);
    onDownload(episodeIndexes);
    onClose();
  };

  const currentStart = currentPage * episodesPerPage;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes - 1
  );

  if (!isOpen || !mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6'
      style={{ zIndex: 9999 }}
    >
      <div className='bg-white dark:bg-[#1C1E24] rounded-2xl shadow-2xl w-[92vw] max-w-4xl max-h-[82vh] flex flex-col overflow-hidden border border-gray-200 dark:border-white/10'>
        {/* 标题栏 */}
        <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/[0.08]'>
          <div className='flex-1 min-w-0'>
            <h2 className='text-lg sm:text-xl font-bold text-gray-900 dark:text-zinc-100'>
              选择要下载的集数
            </h2>
            <p className='text-xs sm:text-sm text-gray-500 dark:text-zinc-400 mt-0.5 truncate'>
              {videoTitle} · 自动并发拉取 M3U8 分片、解密并剔除广告切片
            </p>
          </div>
          <div className='flex items-center gap-2 ml-3'>
            {onOpenDownloadPanel && (
              <button
                type='button'
                onClick={() => {
                  onClose();
                  onOpenDownloadPanel();
                }}
                className='px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10 rounded-lg transition-colors'
              >
                任务列表
              </button>
            )}
            <button
              type='button'
              onClick={handleSelectAll}
              className='px-3 py-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10 rounded-lg transition-colors'
            >
              全选
            </button>
            <button
              type='button'
              onClick={handleClearAll}
              className='px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors'
            >
              清空
            </button>
            <button
              type='button'
              onClick={onClose}
              className='flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors'
            >
              <svg
                className='w-5 h-5'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            </button>
          </div>
        </div>

        {/* 分页标签 */}
        {pageCount > 1 && (
          <div className='flex items-center gap-4 px-6 py-3 border-b border-gray-200 dark:border-white/[0.08]'>
            <div className='flex-1 overflow-x-auto'>
              <div className='flex gap-2 min-w-max'>
                {categories.map((label, idx) => {
                  const isActive = idx === displayPage;
                  return (
                    <button
                      key={label}
                      type='button'
                      onClick={() => handleCategoryClick(idx)}
                      className={`px-4 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                        isActive
                          ? 'bg-emerald-500 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type='button'
              className='flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-700 hover:text-emerald-600 hover:bg-gray-100 dark:text-zinc-300 dark:hover:text-emerald-400 dark:hover:bg-zinc-800 transition-colors'
              onClick={() => setDescending((prev) => !prev)}
              title='切换正序/倒序'
            >
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                />
              </svg>
            </button>
          </div>
        )}

        {/* 集数网格 */}
        <div className='flex-1 overflow-y-auto px-6 py-4'>
          <div className='flex flex-wrap gap-3'>
            {(() => {
              const len = currentEnd - currentStart + 1;
              return Array.from({ length: len }, (_, i) =>
                descending ? currentEnd - i : currentStart + i
              );
            })().map((episodeIndex) => {
              const isSelected = selectedEpisodes.has(episodeIndex);
              const isCurrent = episodeIndex === currentEpisodeIndex;
              const episodeNumber = episodeIndex + 1;
              return (
                <button
                  key={episodeIndex}
                  type='button'
                  onClick={() => handleEpisodeClick(episodeIndex)}
                  className={`h-10 min-w-10 px-3 py-2 flex items-center justify-center text-sm font-medium rounded-lg transition-all duration-200 whitespace-nowrap font-mono relative ${
                    isSelected
                      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:scale-105 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  {(() => {
                    const title = episodesTitles?.[episodeIndex];
                    if (!title) {
                      return episodeNumber;
                    }
                    if (title.match(/^OVA\s+\d+/i)) {
                      return title;
                    }
                    const match = title.match(/(?:第)?(\d+)(?:集|话)/);
                    if (match) {
                      return match[1];
                    }
                    return title;
                  })()}
                  {isCurrent && (
                    <span
                      className='absolute -top-1 -right-1 w-2.5 h-2.5 bg-sky-500 rounded-full border border-white dark:border-zinc-900'
                      title='当前播放集'
                    ></span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className='flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-[#121316]'>
          <div className='text-xs sm:text-sm text-gray-600 dark:text-zinc-400'>
            已选择：
            {selectedEpisodes.size === 0 ? (
              <span className='text-rose-500 dark:text-rose-400'>
                未选择任何集数
              </span>
            ) : selectedEpisodes.size === 1 ? (
              <>
                第 {Array.from(selectedEpisodes)[0] + 1} 集
                {Array.from(selectedEpisodes)[0] === currentEpisodeIndex && (
                  <span className='ml-2 text-emerald-600 dark:text-emerald-400'>
                    (当前播放)
                  </span>
                )}
              </>
            ) : (
              <span className='font-semibold text-emerald-600 dark:text-emerald-400'>
                {selectedEpisodes.size} 集
              </span>
            )}
          </div>
          <div className='flex gap-3'>
            <button
              type='button'
              onClick={onClose}
              className='px-4 py-2 text-xs sm:text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 rounded-xl transition-colors'
            >
              取消
            </button>
            <button
              type='button'
              onClick={handleDownload}
              disabled={selectedEpisodes.size === 0}
              className='px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-colors shadow-md shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed'
            >
              开始下载{' '}
              {selectedEpisodes.size > 0 && `(${selectedEpisodes.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default DownloadEpisodeSelector;
