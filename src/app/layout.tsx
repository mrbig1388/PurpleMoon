import type { Metadata, Viewport } from 'next';

import './globals.css';
import 'sweetalert2/dist/sweetalert2.min.css';

import { getConfig } from '@/lib/config';
import { isInviteCodeRequired } from '@/lib/invite';
import { getPublicTurnstileConfig, PublicTurnstileState } from '@/lib/turnstile';

import { SiteProvider } from '../components/SiteProvider';
import { ThemeProvider } from '../components/ThemeProvider';
import { DownloadBubble } from '../lib/Download/DownloadBubble';
import { DownloadProvider } from '../lib/Download/DownloadContext';
import { DownloadPanel } from '../lib/Download/DownloadPanel';

// 动态生成 metadata，支持配置更新后的标题变化
export async function generateMetadata(): Promise<Metadata> {
  let siteName = process.env.SITE_NAME || 'PurpleMoon';
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    try {
      const config = await getConfig();
      if (config?.SiteConfig?.SiteName) {
        siteName = config.SiteConfig.SiteName;
      }
    } catch {
      // 构建期或存储尚未就绪时安全回退至环境变量默认值
    }
  }

  return {
    title: siteName,
    description: 'Content Aggregation',
    manifest: '/manifest.json',
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#000000',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let siteName = process.env.SITE_NAME || 'PurpleMoon';
  let announcement =
    process.env.ANNOUNCEMENT ||
    'Welcome to PurpleMoon. Please note that all content available on this site is sourced from the Internet.';
  let enableRegister = process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
  let requireInviteCode = isInviteCodeRequired();
  let imageProxy = process.env.NEXT_PUBLIC_IMAGE_PROXY || '';
  let turnstile: PublicTurnstileState = getPublicTurnstileConfig(null);

  // 🛡️ 逻辑修复 (LOG-02)：运行时在所有存储模式（含 d1 / upstash）下均读取最新配置，
  // 用 try/catch 保护静态构建阶段，确保后台修改开放注册、邀请码开关、站点名、公告或图片代理后全局生效。
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    try {
      const config = await getConfig();
      if (config) {
        siteName = config.SiteConfig.SiteName || siteName;
        announcement = config.SiteConfig.Announcement ?? announcement;
        enableRegister = Boolean(config.UserConfig.AllowRegister);
        requireInviteCode = isInviteCodeRequired(config);
        imageProxy = config.SiteConfig.ImageProxy ?? imageProxy;
        turnstile = getPublicTurnstileConfig(config);
      }
    } catch {
      // 存储暂不可用时回退至环境变量默认值
    }
  }

  const runtimeConfig = {
    STORAGE_TYPE: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
    ENABLE_REGISTER: enableRegister,
    REQUIRE_INVITE_CODE: requireInviteCode,
    IMAGE_PROXY: imageProxy,
    TURNSTILE: turnstile,
  };

  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${JSON.stringify(runtimeConfig).replace(/</g, '\\u003c')};`,
          }}
        />
      </head>
      <body
        className="font-primary min-h-screen w-full max-w-full overflow-x-clip bg-white text-gray-900 dark:bg-black dark:text-gray-200"
      >
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <SiteProvider siteName={siteName} announcement={announcement}>
            <DownloadProvider>
              {children}
              <DownloadBubble />
              <DownloadPanel />
            </DownloadProvider>
          </SiteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
