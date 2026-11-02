import { NextRequest, NextResponse } from 'next/server';

import {
  filterAdsFromM3U8,
  parseAdFingerprints,
  stripDiscontinuityLegacy,
} from '@/lib/m3u8-ad-filter';
import { readTextLimited } from '@/lib/safe-fetch';
import { checkUpstreamUrlSafety } from '@/lib/ssrf-guard';

export const runtime = 'edge';

const MAX_REDIRECTS = 3;
const UPSTREAM_TIMEOUT_MS = 8000;
const ALLOWED_PORTS = new Set(['', '80', '443']);

class UpstreamBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamBlockedError';
  }
}

/**
 * 校验上游目标地址是否满足 SSRF 字面量安全及标准 Web 端口（80/443）限制
 */
function validateUpstreamTarget(rawUrl: string): URL {
  const safety = checkUpstreamUrlSafety(rawUrl);
  if (!safety.ok) {
    throw new UpstreamBlockedError(safety.reason || '不安全的上游地址');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UpstreamBlockedError('不是合法的 URL');
  }

  if (!ALLOWED_PORTS.has(parsed.port)) {
    throw new UpstreamBlockedError('仅允许访问标准 80/443 端口');
  }

  return parsed;
}

/**
 * 校验请求是否来自本站同源上下文，防止外部站点将本接口作为公开跳板调用
 */
function isSameOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (
    secFetchSite &&
    secFetchSite !== 'same-origin' &&
    secFetchSite !== 'same-site' &&
    secFetchSite !== 'none'
  ) {
    return false;
  }

  const expectedHost = (
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    new URL(request.url).host
  )
    .split(',')[0]
    .trim()
    .toLowerCase();

  const originHeader = request.headers.get('origin');
  if (originHeader && originHeader !== 'null') {
    try {
      if (new URL(originHeader).host.toLowerCase() !== expectedHost) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const refererHeader = request.headers.get('referer');
  if (refererHeader) {
    try {
      if (new URL(refererHeader).host.toLowerCase() !== expectedHost) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

async function fetchUpstreamM3U8WithFinalUrl(
  initialUrl: string,
  signal: AbortSignal
): Promise<{ response: Response; finalUrl: string }> {
  let current = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = validateUpstreamTarget(current);

    const res = await fetch(current, {
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Accept: '*/*',
        Referer: `${parsed.protocol}//${parsed.host}/`,
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        return { response: res, finalUrl: current };
      }
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new UpstreamBlockedError('上游返回了无效的重定向地址');
      }
      continue;
    }

    return { response: res, finalUrl: current };
  }

  throw new UpstreamBlockedError('上游重定向次数过多');
}

function sanitizeResolvedUri(uri: string): string {
  return uri.replace(/["\r\n<>]/g, '');
}

function resolveRelativeM3U8Links(
  m3u8Content: string,
  baseUrl: string,
  adBlockEnabled: boolean
): string {
  const base = new URL(baseUrl);
  const baseDir = base.href.substring(0, base.href.lastIndexOf('/') + 1);
  const lines = m3u8Content.split(/\r?\n/);
  const resolvedLines: string[] = [];
  let nextLineIsVariantPlaylist = false;

  const toAbsoluteUrl = (rawUri: string): string => {
    const trimmed = rawUri.trim();
    let candidate = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
      candidate = trimmed;
    } else if (trimmed.startsWith('//')) {
      candidate = `${base.protocol}${trimmed}`;
    } else if (trimmed.startsWith('/')) {
      candidate = `${base.protocol}//${base.host}${trimmed}`;
    } else {
      try {
        candidate = new URL(trimmed, baseDir).href;
      } catch {
        return '';
      }
    }

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return '';
      }
      return sanitizeResolvedUri(parsed.href);
    } catch {
      return '';
    }
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    if (
      trimmed.startsWith('#EXT-X-KEY:') ||
      trimmed.startsWith('#EXT-X-MAP:')
    ) {
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch && uriMatch[1]) {
        const absKeyUri = toAbsoluteUrl(uriMatch[1]);
        if (absKeyUri) {
          line = line.replace(/URI="[^"]+"/, `URI="${absKeyUri}"`);
        }
      }
      resolvedLines.push(line);
      continue;
    }

    if (trimmed.startsWith('#')) {
      resolvedLines.push(line);
      if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
        nextLineIsVariantPlaylist = true;
      }
      continue;
    }

    if (!trimmed) {
      resolvedLines.push(line);
      continue;
    }

    const absUrl = toAbsoluteUrl(trimmed);
    if (!absUrl) {
      continue;
    }

    const isSubM3u8 =
      nextLineIsVariantPlaylist || /\.m3u8?($|\?)/i.test(absUrl);
    nextLineIsVariantPlaylist = false;

    if (isSubM3u8) {
      const safety = checkUpstreamUrlSafety(absUrl);
      if (!safety.ok) {
        continue;
      }
      const adBlockParam = adBlockEnabled ? '' : '&adblock=false';
      resolvedLines.push(
        `/api/proxy-m3u8?url=${encodeURIComponent(absUrl)}${adBlockParam}`
      );
    } else {
      resolvedLines.push(absUrl);
    }
  }

  return resolvedLines.join('\n');
}

/**
 * GET /api/proxy-m3u8?url=<原始m3u8地址>&adblock=<true|false>
 * 面向移动端原生 HLS (<video src>) 与不支持 MSE 环境的同构服务端去广告代理路由。
 */
export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: '拒绝跨站调用代理接口' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const m3u8Url = searchParams.get('url')?.trim();
  const adBlockEnabled = searchParams.get('adblock') !== 'false';

  if (!m3u8Url) {
    return NextResponse.json(
      { error: '缺少必要参数: url' },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    validateUpstreamTarget(m3u8Url);

    const { response, finalUrl } = await fetchUpstreamM3U8WithFinalUrl(
      m3u8Url,
      controller.signal
    );
    if (!response.ok) {
      return NextResponse.json(
        { error: '获取上游 M3U8 失败' },
        { status: response.status >= 400 && response.status < 600 ? response.status : 502 }
      );
    }

    let m3u8Content = await readTextLimited(response);
    const trimmed = m3u8Content.trimStart();
    if (
      trimmed.length > 0 &&
      !trimmed.startsWith('#EXTM3U') &&
      !trimmed.startsWith('#EXT')
    ) {
      return NextResponse.json(
        { error: '上游响应不是有效的 M3U8 播放列表' },
        { status: 415 }
      );
    }

    if (adBlockEnabled) {
      try {
        const extra = (process.env.NEXT_PUBLIC_AD_BLOCK_PATTERNS || '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        const extraFingerprints = parseAdFingerprints(
          process.env.NEXT_PUBLIC_AD_FINGERPRINTS
        );
        const filtered = filterAdsFromM3U8(m3u8Content, {
          baseUrl: finalUrl,
          extraPatterns: extra,
          extraFingerprints,
        });
        m3u8Content =
          filtered.cleanContent ?? stripDiscontinuityLegacy(filtered.content);
      } catch {
        m3u8Content = stripDiscontinuityLegacy(m3u8Content);
      }
    }

    const resolvedPlaylist = resolveRelativeM3U8Links(
      m3u8Content,
      finalUrl,
      adBlockEnabled
    );

    return new NextResponse(resolvedPlaylist, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof UpstreamBlockedError) {
      return NextResponse.json(
        { error: `非法的播放列表地址: ${error.message}` },
        { status: 403 }
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: '获取上游 M3U8 超时' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: '代理 M3U8 失败' },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
