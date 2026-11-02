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

async function fetchUpstreamM3U8WithFinalUrl(
  initialUrl: string
): Promise<{ response: Response; finalUrl: string }> {
  let current = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safety = checkUpstreamUrlSafety(current);
    if (!safety.ok) {
      throw new Error(`拒绝访问不安全的上游地址: ${safety.reason}`);
    }

    const parsed = new URL(current);
    const res = await fetch(current, {
      redirect: 'manual',
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
      current = new URL(location, current).toString();
      continue;
    }

    return { response: res, finalUrl: current };
  }

  throw new Error('上游重定向次数过多');
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
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    if (trimmed.startsWith('//')) {
      return `${base.protocol}${trimmed}`;
    }
    if (trimmed.startsWith('/')) {
      return `${base.protocol}//${base.host}${trimmed}`;
    }
    try {
      return new URL(trimmed, baseDir).href;
    } catch {
      return trimmed;
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
        line = line.replace(/URI="[^"]+"/, `URI="${absKeyUri}"`);
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
    const isSubM3u8 =
      nextLineIsVariantPlaylist || /\.m3u8?($|\?)/i.test(absUrl);
    nextLineIsVariantPlaylist = false;

    if (isSubM3u8) {
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
  try {
    const { searchParams } = new URL(request.url);
    const m3u8Url = searchParams.get('url')?.trim();
    const adBlockEnabled = searchParams.get('adblock') !== 'false';

    if (!m3u8Url) {
      return NextResponse.json(
        { error: '缺少必要参数: url' },
        { status: 400 }
      );
    }

    const initialSafety = checkUpstreamUrlSafety(m3u8Url);
    if (!initialSafety.ok) {
      return NextResponse.json(
        { error: `非法的播放列表地址: ${initialSafety.reason}` },
        { status: 403 }
      );
    }

    const { response, finalUrl } = await fetchUpstreamM3U8WithFinalUrl(m3u8Url);
    if (!response.ok) {
      return NextResponse.json(
        { error: '获取上游 M3U8 失败' },
        { status: response.status }
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
    return NextResponse.json(
      {
        error: '代理 M3U8 失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
