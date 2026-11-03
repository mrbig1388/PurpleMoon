import { NextResponse } from 'next/server';

export const runtime = 'edge';

const ALLOWED_IMAGE_HOSTS = new Set<string>([
  'image.tmdb.org',
]);

// OrionTV 兼容接口
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  // 2.8.8：URL 解析器会把 /../ 与 /%2e%2e/ 提前规范化掉，之后再检查 pathname 永远查不到 '..'，
  // 所以必须在解析前对原始字符串做路径穿越检查（含 %2e / %2E / 反斜杠写法），直接返回 400。
  if (/(^|[/\\])(\.|%2e){2}([/\\?#]|$)/i.test(imageUrl)) {
    return NextResponse.json({ error: 'Invalid image path' }, { status: 400 });
  }

  let parsedImageUrl: URL;
  try {
    parsedImageUrl = new URL(imageUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }

  if (parsedImageUrl.protocol !== 'https:') {
    return NextResponse.json(
      { error: 'Only HTTPS image URLs are allowed' },
      { status: 400 }
    );
  }

  if (parsedImageUrl.username || parsedImageUrl.password) {
    return NextResponse.json(
      { error: 'Credentials in image URL are not allowed' },
      { status: 400 }
    );
  }

  if (!ALLOWED_IMAGE_HOSTS.has(parsedImageUrl.hostname)) {
    return NextResponse.json(
      { error: 'Image host is not allowed' },
      { status: 400 }
    );
  }

  const normalizedPath = parsedImageUrl.pathname.startsWith('/')
    ? parsedImageUrl.pathname
    : `/${parsedImageUrl.pathname}`;

  if (normalizedPath.includes('..')) {
    return NextResponse.json(
      { error: 'Invalid image path' },
      { status: 400 }
    );
  }

  const sanitizedUrl = new URL(`https://${parsedImageUrl.hostname}`);
  sanitizedUrl.pathname = normalizedPath;
  sanitizedUrl.search = parsedImageUrl.search;

  try {
    const imageResponse = await fetch(sanitizedUrl.toString(), {
      redirect: 'manual',
      headers: {
        Referer: 'https://www.themoviedb.org/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
    });

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: imageResponse.statusText || 'Upstream error' },
        { status: imageResponse.status }
      );
    }

    // 🛡️ 安全修复 (SEC-NEW-08)：严格校验上游响应的 Content-Type 必须为光栅图片类型，
    // 拒绝透传 text/html 或含脚本的 SVG，并附加 sandbox CSP 与 nosniff 响应头防范同源 XSS。
    const rawContentType = (imageResponse.headers.get('content-type') || '').toLowerCase();
    const mimeType = rawContentType.split(';')[0].trim();
    if (!mimeType.startsWith('image/') || mimeType === 'image/svg+xml') {
      return NextResponse.json(
        { error: 'Unsupported image content type' },
        { status: 415 }
      );
    }

    if (!imageResponse.body) {
      return NextResponse.json(
        { error: 'Image response has no body' },
        { status: 500 }
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', mimeType);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    headers.set('Cache-Control', 'public, max-age=15720000, s-maxage=15720000');
    headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');

    return new Response(imageResponse.body, {
      status: 200,
      headers,
    });
  } catch {
    // 上游不可达属于网关错误，不是本服务内部错误
    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: 502 }
    );
  }
}
