/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Settings, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type BufferStrategyType = 'low' | 'medium' | 'high' | 'ultra';

const BUFFER_STRATEGY_OPTIONS: Array<{
  value: BufferStrategyType;
  label: string;
  desc: string;
}> = [
  { value: 'low', label: '低缓冲', desc: '前向 15s / 30MB（移动端省流量）' },
  { value: 'medium', label: '中缓冲', desc: '前向 30s / 60MB（日常均衡）' },
  { value: 'high', label: '高缓冲', desc: '前向 60s / 100MB（推荐默认）' },
  { value: 'ultra', label: '超高缓冲', desc: '前向 120s / 240MB（高速宽带）' },
];

export const SettingsButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [imageProxyUrl, setImageProxyUrl] = useState('');
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [enableImageProxy, setEnableImageProxy] = useState(false);
  const [bufferStrategy, setBufferStrategy] =
    useState<BufferStrategyType>('high');
  const [nextEpisodePreCache, setNextEpisodePreCache] = useState(true);
  const [mounted, setMounted] = useState(false);

  // 确保组件已挂载
  useEffect(() => {
    setMounted(true);
  }, []);

  // 从 localStorage 读取设置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedEnableImageProxy = localStorage.getItem('enableImageProxy');
      const defaultImageProxy =
        (window as any).RUNTIME_CONFIG?.IMAGE_PROXY || '';
      if (savedEnableImageProxy !== null) {
        setEnableImageProxy(JSON.parse(savedEnableImageProxy));
      } else if (defaultImageProxy) {
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

      const savedBufferStrategy = localStorage.getItem('bufferStrategy');
      if (
        savedBufferStrategy === 'low' ||
        savedBufferStrategy === 'medium' ||
        savedBufferStrategy === 'high' ||
        savedBufferStrategy === 'ultra'
      ) {
        setBufferStrategy(savedBufferStrategy);
      }

      const savedNextPreCache = localStorage.getItem('nextEpisodePreCache');
      if (savedNextPreCache !== null) {
        setNextEpisodePreCache(savedNextPreCache !== 'false');
      }
    }
  }, []);

  const notifyPlayerSettingsUpdated = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('moontv:player-settings-updated'));
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

  const handleBufferStrategyChange = (value: BufferStrategyType) => {
    setBufferStrategy(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('bufferStrategy', value);
      notifyPlayerSettingsUpdated();
    }
  };

  const handleNextEpisodePreCacheToggle = (value: boolean) => {
    setNextEpisodePreCache(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('nextEpisodePreCache', String(value));
      notifyPlayerSettingsUpdated();
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

    setEnableOptimization(true);
    setEnableImageProxy(!!defaultImageProxy);
    setImageProxyUrl(defaultImageProxy);
    setBufferStrategy('high');
    setNextEpisodePreCache(true);

    if (typeof window !== 'undefined') {
      localStorage.setItem('enableOptimization', JSON.stringify(true));
      localStorage.setItem('doubanProxyUrl', '');
      localStorage.setItem(
        'enableImageProxy',
        JSON.stringify(!!defaultImageProxy)
      );
      localStorage.setItem('imageProxyUrl', defaultImageProxy);
      localStorage.setItem('bufferStrategy', 'high');
      localStorage.setItem('nextEpisodePreCache', 'true');
      notifyPlayerSettingsUpdated();
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

          {/* 播放器缓冲策略 */}
          <div className='space-y-2.5'>
            <div className='flex items-center justify-between'>
              <div>
                <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  播放缓冲策略
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>
                  {
                    BUFFER_STRATEGY_OPTIONS.find(
                      (o) => o.value === bufferStrategy
                    )?.desc
                  }
                </p>
              </div>
            </div>
            <div className='grid grid-cols-4 gap-2'>
              {BUFFER_STRATEGY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type='button'
                  onClick={() => handleBufferStrategyChange(opt.value)}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    bufferStrategy === opt.value
                      ? 'bg-green-500 text-white border-green-500 shadow-sm'
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 下集自动预缓冲 */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                下集自动预缓冲
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                本集播放至 90% 时静默预热下一集前 20 个正片分片
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={nextEpisodePreCache}
                  onChange={(e) =>
                    handleNextEpisodePreCacheToggle(e.target.checked)
                  }
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
