/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */

// =========================================================================
// 【安全策略定制】：针对影视聚合网站的专属 CSP（放行 Cloudflare Turnstile 验证脚本与 iframe）
// =========================================================================
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline';
  img-src * blob: data:;
  media-src * blob: data:;
  connect-src *;
  font-src 'self' data: https:;
  worker-src 'self' blob:;
  frame-src 'self' https://challenges.cloudflare.com https:;
  object-src 'none';
  base-uri 'self';
`.replace(/\n/g, '').replace(/\s{2,}/g, ' ').trim();
// 🛡️ CSP 修复说明：
// 1. 彻底移除了 script-src 中的 'unsafe-eval'，防范 eval() 恶意注入。
// 2. script-src 仅在 'self' 'unsafe-inline' 基础上精确白名单放行 https://challenges.cloudflare.com（用于 Cloudflare Turnstile 人机验证）。
// 3. 新增 object-src 'none' 彻底封死 Flash/Java 等老旧高危插件。
// 4. 新增 base-uri 'self' 防止被注入恶意 <base> 标签劫持相对路径。

const securityHeaders = [
  // 1. 防御点击劫持 (Clickjacking) - 仅允许同源 iframe 嵌套
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // 2. 防御 MIME 嗅探攻击 - 强制浏览器遵守 Content-Type
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // 3. 严格的 Referrer 策略 - 跨域请求时仅发送源地址，保护页面路径隐私
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // 4. 权限策略 (Permissions-Policy) - 禁用敏感 API (摄像头、麦克风、定位)
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  // 5. 强制 HTTPS (HSTS) - 保护连接不被降级 (配置为 1 年)
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  // 6. 开启 DNS 预解析 - 提升第三方源的加载速度
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  // 7. 内容安全策略 (CSP) - 拦截 XSS 的终极防线
  { key: 'Content-Security-Policy', value: ContentSecurityPolicy }
];

const nextConfig = {
  output: 'standalone',
  eslint: {
    dirs: ['src'],
  },

  reactStrictMode: false,
  
  // 【修复】：移除 swcMinify: true。Next.js 15 已将其作为默认项，
  // 移除此项可消除构建时终端的 "Invalid next.config.js options" 警告。

  // Uncoment to add domain whitelist
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  // 全局注入 HTTP 安全响应头
  async headers() {
    return [
      {
        // 将安全头应用到全站所有路由
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },

  webpack(config) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg')
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ }, // exclude if *.svg?url
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      }
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },
};

// 🛡️ 安全修复 (S-02)：next-pwa 默认会把所有同源 GET /api/* 响应缓存 24 小时（NetworkFirst），
// 包含 /api/me、/api/playrecords、/api/favorites、/api/admin/config 等带身份的数据，
// 且服务端的 Cache-Control: no-store 对 Service Worker 缓存无效，共用设备上下一位用户可能读到。
// 这里把 /api/ 放在默认规则之前并改为 NetworkOnly：永不缓存。
const runtimeCaching = [
  {
    urlPattern: ({ url }) =>
      self.origin === url.origin && url.pathname.startsWith('/api/'),
    handler: 'NetworkOnly',
  },
  ...require('next-pwa/cache'),
];

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  runtimeCaching,
});

module.exports = withPWA(nextConfig);
