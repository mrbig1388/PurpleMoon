/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { signAuthPayload } from '@/lib/auth';
import { getClientIp } from '@/lib/client-ip';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { timingSafeEqual } from '@/lib/password';

export const runtime = 'edge';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'd1'
    | undefined) || 'localstorage';

// =========== 防刷机制 (Rate Limiter) ===========
// 本地降级回退缓存（当分布式存储异常时自动接管，确保 Fail-Closed/安全降级）
const localRateLimitMap = new Map<string, { count: number; timestamp: number }>();

function checkLocalRateLimit(ip: string): boolean {
  const now = Date.now();
  const limitData = localRateLimitMap.get(ip);

  localRateLimitMap.forEach((value, key) => {
    if (now - value.timestamp > 60000) localRateLimitMap.delete(key);
  });

  if (limitData && now - limitData.timestamp < 60000) {
    if (limitData.count >= 10) return false;
    limitData.count++;
  } else {
    localRateLimitMap.set(ip, { count: 1, timestamp: now });
  }
  return true;
}

async function checkRateLimit(req: NextRequest): Promise<boolean> {
  // 🛡️ 安全修复 (P2 · L-05)：统一、可配置的 IP 识别逻辑（详见 lib/client-ip.ts）
  const ip = getClientIp(req);

  if (STORAGE_TYPE === 'localstorage') {
    return checkLocalRateLimit(ip);
  }

  try {
    const key = `rate_limit:login:${ip}`;
    return await db.checkRateLimit(key, 10, 60000);
  } catch (err) {
    // 🛡️ 修复 Fail-Open 漏洞：分布式存储异常时，绝不直接放行，而是安全降级到本地内存限流
    console.error('分布式限流存储异常，已安全降级至本地内存限流:', err);
    return checkLocalRateLimit(ip);
  }
}
// ==============================================

// 🛡️ 安全修复 (P0)：不再在本文件内重复实现签名逻辑与密钥兜底策略。
// 统一调用 lib/auth.ts 中唯一、已加固（无硬编码默认密钥、fail-closed）
// 的 signAuthPayload，避免签发端与校验端出现密钥兜底不一致的问题。
async function generateAuthCookie(
  username = 'admin',
  role = 'user'
): Promise<string> {
  const timestamp = Date.now();
  const signature = await signAuthPayload(username, timestamp, role);
  const authData = { username, role, timestamp, signature };
  return encodeURIComponent(JSON.stringify(authData));
}

// ==========================================
// 🛡️ 辅助方法：签发与清除双 Cookie
// ==========================================
function setDualCookies(response: NextResponse, authValue: string, username: string, role: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  response.cookies.set('auth', authValue, { path: '/', expires, sameSite: 'lax', httpOnly: true, secure: isProduction });
  
  const userInfoValue = encodeURIComponent(JSON.stringify({ username, role }));
  response.cookies.set('user_info', userInfoValue, { path: '/', expires, sameSite: 'lax', httpOnly: false, secure: isProduction });
}

function clearDualCookies(response: NextResponse) {
  const isProd = process.env.NODE_ENV === 'production';
  const opts = { path: '/', expires: new Date(0), sameSite: 'lax' as const, secure: isProd };
  response.cookies.set('auth', '', { ...opts, httpOnly: true });
  response.cookies.set('user_info', '', { ...opts, httpOnly: false });
}
// ==========================================

export async function POST(req: NextRequest) {
  try {
    // 🛡️ 接入加固后的防刷限流校验
    if (!(await checkRateLimit(req))) {
      return NextResponse.json({ error: '尝试登录过于频繁，请 1 分钟后再试' }, { status: 429 });
    }

    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      if (!envPassword) {
        const response = NextResponse.json({ ok: true });
        clearDualCookies(response);
        return response;
      }

      const { password } = await req.json();
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      // 🛡️ 安全修复 (P2)：改为恒定时间比较，避免逐字符比较造成的时序侧信道
      if (!timingSafeEqual(password, envPassword)) {
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 }
        );
      }

      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie('admin', 'admin'); 
      setDualCookies(response, cookieValue, 'admin', 'admin');

      return response;
    }

    const { username, password } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 🛡️ 安全修复 (P2)：站长账号比较同样改为恒定时间比较
    const ownerUsername = process.env.USERNAME || '';
    const ownerPassword = process.env.PASSWORD || '';
    if (
      timingSafeEqual(username, ownerUsername) &&
      timingSafeEqual(password, ownerPassword)
    ) {
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(username, 'admin'); 
      setDualCookies(response, cookieValue, username, 'admin');

      return response;
    } else if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const config = await getConfig();
    const user = config.UserConfig.Users.find((u) => u.username === username);
    if (user && user.banned) {
      return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
    }

    try {
      const pass = await db.verifyUser(username, password);
      if (!pass) {
        return NextResponse.json(
          { error: '用户名或密码错误' },
          { status: 401 }
        );
      }

      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(username, 'user'); 
      setDualCookies(response, cookieValue, username, 'user');

      return response;
    } catch (err) {
      console.error('数据库验证失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
