/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Settings, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const SettingsButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [defaultAggregateSearch, setDefaultAggregateSearch] = useState(true);
  const [exactSearch, setExactSearch] = useState(true);
  const [cardDisplayMode, setCardDisplayMode] = useState(true);
  const [enableStreamSearch, setEnableStreamSearch] = useState(true);
  const [imageProxyUrl, setImageProxyUrl] = useState('');
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [enableImageProxy, setEnableImageProxy] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 确保组件已挂载
  useEffect(() => {
    setMounted(true);
  }, []);

  // 从 localStorage 读取设置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAggregateSearch = localStorage.getItem(
        'defaultAggregateSearch'
      );
      if (savedAggregateSearch !== null) {
        try {
          setDefaultAggregateSearch(JSON.parse(savedAggregateSearch));
        } catch {
          setDefaultAggregateSearch(savedAggregateSearch === 'true');
        }
      }

      const savedExactSearch = localStorage.getItem('exactSearch');
      if (savedExactSearch !== null) {
        try {
          const parsed = JSON.parse(savedExactSearch);
          if (typeof parsed === 'boolean') {
            setExactSearch(parsed);
          } else {
            setExactSearch(savedExactSearch === 'true');
          }
        } catch {
          setExactSearch(savedExactSearch === 'true');
        }
      }

      const savedDisplayMode = localStorage.getItem('searchResultDisplayMode');
      if (savedDisplayMode === 'list') {
        setCardDisplayMode(false);
      } else if (savedDisplayMode === 'card') {
        setCardDisplayMode(true);
      }

      const savedStreamSearch = localStorage.getItem('enableStreamSearch');
      if (savedStreamSearch !== null) {
        try {
          const parsed = JSON.parse(savedStreamSearch);
          if (typeof parsed === 'boolean') setEnableStreamSearch(parsed);
        } catch {
          // 值损坏时保持默认（开启）
        }
      }

      const savedEnableImageProxy = localStorage.getItem('enableImageProxy');
      const defaultImageProxy =
        (window as any).RUNTIME_CONFIG?.IMAGE_PROXY || '';
      if (savedEnableImageProxy !== null) {
        setEnableImageProxy(JSON.parse(savedEnableImageProxy));
      } else if (defaultImageProxy) {
        // 如果有默认图片代理配置，则默认开启
        setEnableImageProxy(true);
      }

      const savedImageProxyUrl = localStorage.getItem('imageProxyUrl');
      if (savedImageProxyUrl !== null) {
        setImageProxyUrl(savedImageProxyUrl);
      } else if (defaultImageProxy) {
        setImageProxyUrl(defaultImageProxy);
      }

      const savedEnableOptimization =
        localStorage.getItem('enableOptimization');
      if (savedEnableOptimization !== null) {
        setEnableOptimization(JSON.parse(savedEnableOptimization));
      }
    }
  }, []);

  // 保存设置到 localStorage
  const handleAggregateToggle = (value: boolean) => {
    setDefaultAggregateSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(value));
      window.dispatchEvent(
        new CustomEvent('localSettingsChanged', {
          detail: { defaultAggregateSearch: value },
        })
      );
    }
  };

  const handleExactSearchToggle = (value: boolean) => {
    setExactSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('exactSearch', JSON.stringify(value));
      window.dispatchEvent(
        new CustomEvent('localSettingsChanged', {
          detail: { exactSearch: value },
        })
      );
    }
  };

  const handleCardDisplayModeToggle = (value: boolean) => {
    setCardDisplayMode(value);
    const mode = value ? 'card' : 'list';
    if (typeof window !== 'undefined') {
      localStorage.setItem('searchResultDisplayMode', mode);
      window.dispatchEvent(
        new CustomEvent('localSettingsChanged', {
          detail: { searchResultDisplayMode: mode },
        })
      );
    }
  };

  const handleStreamSearchToggle = (value: boolean) => {
    setEnableStreamSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableStreamSearch', JSON.stringify(value));
      window.dispatchEvent(
        new CustomEvent('localSettingsChanged', {
          detail: { enableStreamSearch: value },
        })
      );
    }
  };

  const handleImageProxyUrlChange = (value: string) => {
    setImageProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('imageProxyUrl', value);
    }
  };

  const handleOptimizationToggle = (value: boolean) => {
    setEnableOptimization(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableOptimization', JSON.stringify(value));
    }
  };

  const handleImageProxyToggle = (value: boolean) => {
    setEnableImageProxy(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableImageProxy', JSON.stringify(value));
    }
  };

  const handleSettingsClick = () => {
    setIsOpen(!isOpen);
  };

  const handleClosePanel = () => {
    setIsOpen(false);
  };

  // 重置所有设置为默认值
  const handleResetSettings = () => {
    const defaultImageProxy = (window as any).RUNTIME_CONFIG?.IMAGE_PROXY || '';

    // 重置所有状态
    setDefaultAggregateSearch(true);
    setExactSearch(true);
    setCardDisplayMode(true);
    setEnableStreamSearch(true);
    setEnableOptimization(true);
    setEnableImageProxy(!!defaultImageProxy);
    setImageProxyUrl(defaultImageProxy);

    // 保存到 localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
      localStorage.setItem('exactSearch', JSON.stringify(true));
      localStorage.setItem('searchResultDisplayMode', 'card');
      localStorage.setItem('enableStreamSearch', JSON.stringify(true));
      localStorage.setItem('enableOptimization', JSON.stringify(true));
      localStorage.setItem('doubanProxyUrl', '');
      localStorage.setItem(
        'enableImageProxy',
        JSON.stringify(!!defaultImageProxy)
      );
      localStorage.setItem('imageProxyUrl', defaultImageProxy);
      window.dispatchEvent(
        new CustomEvent('localSettingsChanged', {
          detail: {
            defaultAggregateSearch: true,
            exactSearch: true,
            searchResultDisplayMode: 'card',
            enableStreamSearch: true,
          },
        })
      );
    }
  };

  // 设置面板内容
  const settingsPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleClosePanel}
      />

      {/* 设置面板 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] p-6'>
        {/* 标题栏 */}
        <div className='flex items-center justify-between mb-6'>
          <div className='flex items-center gap-3'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              本地设置
            </h3>
            <button
              onClick={handleResetSettings}
              className='px-2 py-1 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 hover:border-red-300 dark:border-red-800 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors'
              title='重置为默认设置'
            >
              重置
            </button>
          </div>
          <button
            onClick={handleClosePanel}
            className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
            aria-label='Close'
          >
            <X className='w-full h-full' />
          </button>
        </div>

        {/* 设置项 */}
        <div className='space-y-6'>
          {/* 默认聚合搜索结果 */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                默认聚合搜索结果
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                搜索时默认按标题和年份聚合显示结果
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={defaultAggregateSearch}
                  onChange={(e) => handleAggregateToggle(e.target.checked)}
                />
                <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 精确搜索 */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                精确搜索
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                开启后，搜索结果将过滤掉不包含搜索词的内容
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={exactSearch}
                  onChange={(e) => handleExactSearchToggle(e.target.checked)}
                />
                <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 搜索结果显示方式（卡片 / 列表） */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                搜索结果卡片显示
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                默认开启为卡片显示，关闭为列表显示
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={cardDisplayMode}
                  onChange={(e) =>
                    handleCardDisplayModeToggle(e.target.checked)
                  }
                />
                <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 流式搜索 */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                流式搜索
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                开启：边搜边显示，流式不可用时自动改用普通搜索；关闭：直接使用普通搜索，等全部搜完再显示
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={enableStreamSearch}
                  onChange={(e) => handleStreamSearchToggle(e.target.checked)}
                />
                <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 优选和测速 */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                启用优选和测速
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                如出现播放器劫持问题可关闭
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={enableOptimization}
                  onChange={(e) => handleOptimizationToggle(e.target.checked)}
                />
                <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 图片代理开关 */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                启用图片代理
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                启用后，所有图片加载将通过代理服务器
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={enableImageProxy}
                  onChange={(e) => handleImageProxyToggle(e.target.checked)}
                />
                <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 图片代理地址设置 */}
          <div className='space-y-3'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                图片代理地址
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                仅在启用图片代理时生效
              </p>
            </div>
            <input
              type='text'
              className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
                enableImageProxy
                  ? 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-400 dark:text-gray-500 placeholder-gray-400 dark:placeholder-gray-600 cursor-not-allowed'
              }`}
              placeholder='例如: https://imageproxy.example.com/?url='
              value={imageProxyUrl}
              onChange={(e) => handleImageProxyUrlChange(e.target.value)}
              disabled={!enableImageProxy}
            />
          </div>
        </div>

        {/* 底部说明 */}
        <div className='mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
          <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
            这些设置保存在本地浏览器中
          </p>
        </div>
      </div>
    </>
  );

  return (
    <>
      <button
        onClick={handleSettingsClick}
        className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
        aria-label='Settings'
      >
        <Settings className='w-full h-full' />
      </button>

      {/* 使用 Portal 将设置面板渲染到 document.body */}
      {isOpen && mounted && createPortal(settingsPanel, document.body)}
    </>
  );
};
