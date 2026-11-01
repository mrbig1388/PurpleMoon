/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @next/next/no-img-element */

'use client';

import { Lock, ShieldCheck, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { PublicTurnstileState } from '@/lib/turnstile';
import { getSafeRedirectUrl } from '@/lib/utils';

import { useSite } from '@/components/SiteProvider';

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';
const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__onTurnstileLoaded&render=explicit';

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 模式切换：false = 登录, true = 注册
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [enableRegister, setEnableRegister] = useState(false);
  const [requireInviteCode, setRequireInviteCode] = useState(false);

  // Cloudflare Turnstile 状态
  const [turnstileConfig, setTurnstileConfig] = useState<PublicTurnstileState>({
    enabled: false,
    enableLogin: false,
    enableRegister: false,
    siteKey: '',
  });
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileScriptReady, setTurnstileScriptReady] = useState(false);
  const [turnstileLoadError, setTurnstileLoadError] = useState(false);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  // 调用全局变量
  const { siteName } = useSite();

  // 当前模式是否需要人机验证
  const needTurnstile = Boolean(
    turnstileConfig.enabled &&
      turnstileConfig.siteKey &&
      (isRegisterMode
        ? turnstileConfig.enableRegister
        : turnstileConfig.enableLogin)
  );

  // 重置 Turnstile 验证框
  const resetTurnstileWidget = useCallback(() => {
    setTurnstileToken('');
    if (typeof window === 'undefined') return;
    const win = window as any;
    if (win.turnstile && turnstileWidgetIdRef.current !== null) {
      try {
        win.turnstile.reset(turnstileWidgetIdRef.current);
      } catch {
        // 忽略重置异常
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const runtimeCfg = (window as any).RUNTIME_CONFIG || {};
      const storageType = runtimeCfg.STORAGE_TYPE;
      setShouldAskUsername(
        Boolean(storageType && storageType !== 'localstorage')
      );
      setEnableRegister(Boolean(runtimeCfg.ENABLE_REGISTER));
      setRequireInviteCode(Boolean(runtimeCfg.REQUIRE_INVITE_CODE));
      if (runtimeCfg.TURNSTILE) {
        setTurnstileConfig({
          enabled: Boolean(runtimeCfg.TURNSTILE.enabled),
          enableLogin: Boolean(runtimeCfg.TURNSTILE.enableLogin),
          enableRegister: Boolean(runtimeCfg.TURNSTILE.enableRegister),
          siteKey: String(runtimeCfg.TURNSTILE.siteKey || ''),
        });
      }

      // 动态同步服务端最新注册开关、邀请码开关及 Turnstile 配置（后台修改后无需重启容器即时生效）
      fetch('/api/server-config', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          if (typeof data.StorageType === 'string') {
            setShouldAskUsername(
              Boolean(data.StorageType && data.StorageType !== 'localstorage')
            );
          }
          if (typeof data.AllowRegister === 'boolean') {
            setEnableRegister(data.AllowRegister);
          }
          if (typeof data.RequireInviteCode === 'boolean') {
            setRequireInviteCode(data.RequireInviteCode);
          }
          if (data.Turnstile && typeof data.Turnstile === 'object') {
            setTurnstileConfig({
              enabled: Boolean(data.Turnstile.enabled),
              enableLogin: Boolean(data.Turnstile.enableLogin),
              enableRegister: Boolean(data.Turnstile.enableRegister),
              siteKey: String(data.Turnstile.siteKey || ''),
            });
          }
        })
        .catch(() => {
          // 忽略网络错误，沿用 window.RUNTIME_CONFIG
        });
    }
  }, []);

  // 按需加载 Cloudflare Turnstile 官方脚本
  useEffect(() => {
    if (!needTurnstile || typeof window === 'undefined') return;

    const win = window as any;
    if (win.turnstile && typeof win.turnstile.render === 'function') {
      setTurnstileLoadError(false);
      setTurnstileScriptReady(true);
      return;
    }

    setTurnstileLoadError(false);

    win.__onTurnstileLoaded = () => {
      setTurnstileLoadError(false);
      setTurnstileScriptReady(true);
    };

    const existing = document.getElementById(
      TURNSTILE_SCRIPT_ID
    ) as HTMLScriptElement | null;
    if (existing && !win.turnstile) {
      // 若之前存在加载失败或未就绪的残留脚本节点，先移除再重新挂载
      existing.remove();
    }

    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;

    const handleLoad = () => {
      if (win.turnstile && typeof win.turnstile.render === 'function') {
        setTurnstileLoadError(false);
        setTurnstileScriptReady(true);
      }
    };

    const handleError = () => {
      setTurnstileLoadError(true);
      script.remove();
    };

    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);
    document.head.appendChild(script);

    // 轮询兜底：确保无论 onload 回调还是脚本缓存命中都能第一时间感知 window.turnstile
    const pollTimer = window.setInterval(() => {
      if (win.turnstile && typeof win.turnstile.render === 'function') {
        setTurnstileLoadError(false);
        setTurnstileScriptReady(true);
        window.clearInterval(pollTimer);
      }
    }, 150);

    return () => {
      window.clearInterval(pollTimer);
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };
  }, [needTurnstile]);

  // 渲染或清理 Turnstile 小部件
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const win = window as any;

    if (
      !needTurnstile ||
      !turnstileScriptReady ||
      !win.turnstile ||
      typeof win.turnstile.render !== 'function'
    ) {
      setTurnstileToken('');
      if (win.turnstile && turnstileWidgetIdRef.current !== null) {
        try {
          win.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          // 忽略清理异常
        }
        turnstileWidgetIdRef.current = null;
      }
      return;
    }

    const container = turnstileContainerRef.current;
    if (!container) return;

    // 先移除旧实例并清空容器，防止切换登录/注册模式时重复挂载
    if (turnstileWidgetIdRef.current !== null) {
      try {
        win.turnstile.remove(turnstileWidgetIdRef.current);
      } catch {
        // 忽略清理异常
      }
      turnstileWidgetIdRef.current = null;
    }
    container.innerHTML = '';

    setTurnstileToken('');
    try {
      const widgetId = win.turnstile.render(container, {
        sitekey: turnstileConfig.siteKey,
        theme: 'auto',
        callback: (token: string) => {
          setTurnstileToken(token || '');
          setError(null);
        },
        'expired-callback': () => {
          setTurnstileToken('');
        },
        'error-callback': () => {
          setTurnstileToken('');
        },
      });
      turnstileWidgetIdRef.current = widgetId;
    } catch {
      setTurnstileLoadError(true);
    }

    return () => {
      if (win.turnstile && turnstileWidgetIdRef.current !== null) {
        try {
          win.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          // 忽略清理异常
        }
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [
    needTurnstile,
    turnstileScriptReady,
    turnstileConfig.siteKey,
    isRegisterMode,
  ]);

  const handleLogin = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    setError(null);
    if (!password || (shouldAskUsername && !username)) return;

    if (needTurnstile && !turnstileToken) {
      setError('请先完成人机验证');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
          ...(needTurnstile ? { turnstileToken } : {}),
        }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect');
        const safeRedirect = getSafeRedirectUrl(redirect, '/');
        router.replace(safeRedirect);
      } else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError(
            data.error || (shouldAskUsername ? '用户名或密码错误' : '密码错误')
          );
        } else {
          setError(data.error || '服务器错误');
        }
        if (needTurnstile) {
          resetTurnstileWidget();
        }
      }
    } catch {
      setError('网络错误，请稍后重试');
      if (needTurnstile) {
        resetTurnstileWidget();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    setError(null);
    if (!password || !username) return;

    if (requireInviteCode && !inviteCode.trim()) {
      setError('请输入邀请码（区分大小写）');
      return;
    }

    if (needTurnstile && !turnstileToken) {
      setError('请先完成人机验证');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          inviteCode,
          ...(needTurnstile ? { turnstileToken } : {}),
        }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect');
        const safeRedirect = getSafeRedirectUrl(redirect, '/');
        router.replace(safeRedirect);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '服务器错误');
        if (needTurnstile) {
          resetTurnstileWidget();
        }
      }
    } catch {
      setError('网络错误，请稍后重试');
      if (needTurnstile) {
        resetTurnstileWidget();
      }
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isRegisterMode) {
      handleRegister();
    } else {
      handleLogin();
    }
  };

  return (
    <div className='min-h-screen flex flex-col bg-white dark:bg-[#0a0a0a] selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black transition-colors'>
      {/* 顶部 Header：左侧站点名，右侧包含“Sign up”按钮 */}
      <header className='w-full flex items-center justify-between p-6 sm:p-8 shrink-0'>
        <div className='text-xl font-black tracking-tight text-gray-900 dark:text-white'>
          {siteName || 'PurpleMoon'}
        </div>

        <div className='flex items-center gap-5 sm:gap-6'>
          {shouldAskUsername && enableRegister && (
            <button
              type='button'
              onClick={() => {
                setIsRegisterMode(!isRegisterMode);
                setError(null);
              }}
              className='text-[15px] font-bold text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white transition-colors'
            >
              {isRegisterMode ? 'Sign in' : 'Sign up'}
            </button>
          )}
        </div>
      </header>

      {/* 中部核心表单区（沉浸式无边框） */}
      <main className='flex-1 flex items-center justify-center px-6 w-full'>
        <div className='w-full max-w-[340px] sm:max-w-[380px]'>
          {/* 极简标题 */}
          <div className='mb-10 text-center'>
            <h1
              className={`text-3xl sm:text-4xl font-black text-gray-900 dark:text-white tracking-tight ${
                isRegisterMode && requireInviteCode ? 'mb-2' : ''
              }`}
            >
              {isRegisterMode ? 'Sign up' : 'Sign in'}
            </h1>
            {isRegisterMode && requireInviteCode && (
              <div className='flex flex-col items-center gap-1.5 mt-3'>
                <p className='text-gray-500 dark:text-gray-400 text-sm font-medium'>
                  Invite-Only Registration
                </p>
                <p className='text-gray-400 dark:text-gray-500 text-xs'>
                  Request an Invite Code:{' '}
                  <a
                    href='mailto:admin@400821.xyz'
                    className='text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white transition-colors underline underline-offset-2'
                  >
                    admin@400821.xyz
                  </a>
                </p>
              </div>
            )}
          </div>

          <form onSubmit={onSubmit} className='space-y-4 sm:space-y-5'>
            {/* 用户名输入框 */}
            {shouldAskUsername && (
              <div>
                <div className='relative group'>
                  <div className='absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none'>
                    <User className='h-5 w-5 text-gray-400 group-focus-within:text-gray-900 dark:group-focus-within:text-white transition-colors' />
                  </div>
                  <input
                    id='username'
                    type='text'
                    aria-label='Username'
                    autoComplete='username'
                    className='block w-full pl-12 pr-6 py-4 bg-gray-100 dark:bg-zinc-900 border border-transparent rounded-full text-base font-medium focus:border-black dark:focus:border-white focus:ring-0 focus:bg-white dark:focus:bg-black outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 transition-all'
                    placeholder='Username'
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* 密码输入框 */}
            <div>
              <div className='relative group'>
                <div className='absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none'>
                  <Lock className='h-5 w-5 text-gray-400 group-focus-within:text-gray-900 dark:group-focus-within:text-white transition-colors' />
                </div>
                <input
                  id='password'
                  type='password'
                  aria-label='Password'
                  autoComplete={
                    isRegisterMode ? 'new-password' : 'current-password'
                  }
                  className='block w-full pl-12 pr-6 py-4 bg-gray-100 dark:bg-zinc-900 border border-transparent rounded-full text-base font-medium focus:border-black dark:focus:border-white focus:ring-0 focus:bg-white dark:focus:bg-black outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 transition-all'
                  placeholder='Password'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {/* 注册模式下的邀请码输入框 */}
            {isRegisterMode &&
              shouldAskUsername &&
              enableRegister &&
              requireInviteCode && (
                <div className='animate-in fade-in slide-in-from-top-2 duration-300'>
                  <div className='relative group'>
                    <div className='absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none'>
                      <ShieldCheck className='h-5 w-5 text-gray-400 group-focus-within:text-gray-900 dark:group-focus-within:text-white transition-colors' />
                    </div>
                    <input
                      id='inviteCode'
                      type='text'
                      aria-label='Enter your invitation code'
                      className='block w-full pl-12 pr-6 py-4 bg-gray-100 dark:bg-zinc-900 border border-transparent rounded-full text-base font-medium focus:border-black dark:focus:border-white focus:ring-0 focus:bg-white dark:focus:bg-black outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 transition-all'
                      placeholder='Enter your invitation code'
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                    />
                  </div>
                </div>
              )}

            {/* 错误提示 */}
            {error && (
              <div className='bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-2xl p-3.5'>
                <p className='text-[13px] font-bold text-red-600 dark:text-red-500 text-center'>
                  {error}
                </p>
              </div>
            )}

            {/* 纯黑主操作按钮：Continue */}
            <button
              type='submit'
              disabled={
                !password ||
                loading ||
                (shouldAskUsername && !username) ||
                (needTurnstile && !turnstileToken)
              }
              className='w-full flex items-center justify-center gap-2 py-4 mt-2 rounded-full bg-black hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-200 text-white dark:text-black text-[15px] font-bold transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed'
            >
              {loading ? (
                <div className='w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin'></div>
              ) : (
                'Continue'
              )}
            </button>

            {/* Cloudflare Turnstile 人机验证容器（位于 Continue 按钮下方） */}
            {needTurnstile && (
              <div className='flex flex-col items-center justify-center pt-2'>
                <div
                  ref={turnstileContainerRef}
                  className='min-h-[65px] flex items-center justify-center'
                />
                {!turnstileScriptReady && !turnstileLoadError && (
                  <p className='text-xs text-gray-400 dark:text-gray-500 mt-1'>
                    正在加载 Cloudflare Turnstile 人机验证…
                  </p>
                )}
                {turnstileLoadError && (
                  <p className='text-xs text-red-500 mt-1 text-center'>
                    人机验证组件加载失败，请检查网络连接或 Site Key 配置后刷新重试
                  </p>
                )}
              </div>
            )}
          </form>
        </div>
      </main>

      {/* 底部 Footer：Logo 与 用户协议 */}
      <footer className='w-full pb-8 pt-4 flex flex-col items-center justify-center gap-4 shrink-0'>
        <div className='w-16 h-16 flex items-center justify-center pointer-events-none select-none'>
          <img
            src='/logo.png'
            alt='Logo'
            className='w-full h-full object-contain drop-shadow-sm dark:drop-shadow-none'
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        </div>
        <div className='text-[11px] font-semibold tracking-wide text-gray-400 dark:text-gray-600 flex items-center gap-2.5 uppercase'>
          <a
            href='#'
            className='hover:text-black dark:hover:text-white transition-colors cursor-pointer'
          >
            Terms of Service
          </a>
          <span className='opacity-50'>|</span>
          <a
            href='#'
            className='hover:text-black dark:hover:text-white transition-colors cursor-pointer'
          >
            Privacy Policy
          </a>
        </div>
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className='min-h-screen flex items-center justify-center bg-white dark:bg-[#0a0a0a]'>
          <div className='w-8 h-8 border-4 border-black dark:border-white border-t-transparent rounded-full animate-spin'></div>
        </div>
      }
    >
      <LoginPageClient />
    </Suspense>
  );
}
