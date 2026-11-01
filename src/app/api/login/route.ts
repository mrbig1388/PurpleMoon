/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getClientIp, UNKNOWN_IP } from '@/lib/client-ip';
import { getConfig } from '@/lib/config';
import {
  buildAuthCookieValue,
  clearAuthCookies,
  hasDeviceTrust,
  readLimitedJson,
  setAuthCookies,
  setDeviceTrustCookie,
} from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';
import { db } from '@/lib/db';
import { timingSafeEqual, verifyPasswordDummy } from '@/lib/password';
import {
  isTurnstileRequiredForScene,
  resolveTurnstileConfig,
  verifyTurnstileToken,
} from '@/lib/turnstile';

export const runtime = 'edge';

const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'd1'
    | 'upstash'
    | undefined) || 'localstorage';

// =========== 防刷机制 (Rate Limiter) ===========
const localRateLimitMap = new Map<string, { count: number; timestamp: number }>();

function checkLocalRateLimit(ip: string, maxPerMin = 10): boolean {
  const now = Date.now();
  const limitData = localRateLimitMap.get(ip);

  localRateLimitMap.forEach((value, key) => {
    if (now - value.timestamp > 60000) localRateLimitMap.delete(key);
  });

  if (limitData && now - limitData.timestamp < 60000) {
    if (limitData.count >= maxPerMin) return false;
    limitData.count++;
  } else {
    localRateLimitMap.set(ip, { count: 1, timestamp: now });
  }
  return true;
}

async function checkRateLimit(req: NextRequest): Promise<boolean> {
  const ip = getClientIp(req);
  // 若未配置可信代理导致落在 unknown_ip 共享桶，适当放宽单桶分钟阈值，由下方的按账号限流兜底
  const maxPerMin = ip === UNKNOWN_IP ? 60 : 10;

  if (STORAGE_TYPE === 'localstorage') {
    return checkLocalRateLimit(ip, maxPerMin);
  }

  try {
    const key = `rate_limit:login:${ip}`;
    return await db.checkRateLimit(key, maxPerMin, 60000);
  } catch (err) {
    console.error('分布式限流存储异常，已安全降级至本地内存限流:', err);
    return checkLocalRateLimit(ip, maxPerMin);
  }
}

const PAIR_LIMIT = 20;
const ACCOUNT_CEILING = STORAGE_TYPE === 'localstorage' ? 60 : 200;
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const localCounters = new Map<string, { count: number; resetAt: number }>();

function normalizeAccount(username: string): string {
  return username.toLowerCase().slice(0, 64);
}

function pairKey(username: string, ip: string): string {
  return `rate_limit:login_pair:${normalizeAccount(username)}:${ip}`;
}

function accountKey(username: string): string {
  return `rate_limit:login_acct:${normalizeAccount(username)}`;
}

function checkLocalCounter(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  localCounters.forEach((v, k) => {
    if (now > v.resetAt) localCounters.delete(k);
  });
  if (localCounters.size > 10000 && !localCounters.has(key)) return true;
  const cur = localCounters.get(key);
  if (!cur) {
    localCounters.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  cur.count++;
  return cur.count <= limit;
}

async function checkKeyLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (STORAGE_TYPE === 'localstorage') return checkLocalCounter(key, limit, windowMs);
  try {
    return await db.checkRateLimit(key, limit, windowMs);
  } catch (err) {
    console.error('登录限流存储异常，已降级至本地内存限流:', err);
    return checkLocalCounter(key, limit, windowMs);
  }
}

async function checkLoginAttemptLimits(
  username: string,
  ip: string,
  trustedDevice = false
): Promise<boolean> {
  // 无法识别来源 IP（unknown_ip）时不使用“账号+IP”桶：它会变成全体匿名用户共享的桶，
  // 一个人发 20 次错误密码就能把该账号锁死；此时只用账号级上限兜底
  if (
    ip !== UNKNOWN_IP &&
    !(await checkKeyLimit(pairKey(username, ip), PAIR_LIMIT, ACCOUNT_WINDOW_MS))
  ) {
    return false;
  }
  // 带有效设备信任 Cookie 且能识别真实来源 IP（已受上方“账号+IP”桶约束）的本人设备不受“账号级总上限”阻挡，
  // 防止攻击者用伪造 IP 刷满账号上限把本人锁在门外（N3）；
  // 没有该 Cookie 或处于 unknown_ip 环境下的请求仍然受账号级上限兜底保护。
  if (trustedDevice && ip !== UNKNOWN_IP) return true;
  return checkKeyLimit(accountKey(username), ACCOUNT_CEILING, ACCOUNT_WINDOW_MS);
}

async function resetLoginAttemptLimits(username: string, ip: string): Promise<void> {
  for (const key of [pairKey(username, ip), accountKey(username)]) {
    localCounters.delete(key);
    if (STORAGE_TYPE === 'localstorage') continue;
    try {
      await db.resetRateLimit(key);
    } catch (err) {
      console.error('清除登录限流计数失败（计数将自然过期）:', err);
    }
  }
}

export async function POST(req: NextRequest) {
  // 🛡️ 安全修复 (SEC-NEW-04)：拦截跨站登录请求（Login CSRF）
  const csrf = checkCsrf(req);
  if (!csrf.ok) return csrf.response;

  try {
    if (!(await checkRateLimit(req))) {
      return NextResponse.json({ error: '尝试登录过于频繁，请 1 分钟后再试' }, { status: 429 });
    }

    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      if (!envPassword) {
        const response = NextResponse.json({ ok: true });
        clearAuthCookies(response, req);
        return response;
      }

      const parsedBody = await readLimitedJson(req, 16 * 1024);
      if (!parsedBody.ok) {
        return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
      }
      const { password } = parsedBody.data || {};
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      if (
        !(await checkLoginAttemptLimits(
          'admin',
          getClientIp(req),
          await hasDeviceTrust(req, 'admin')
        ))
      ) {
        return NextResponse.json(
          { error: '尝试登录过于频繁，请 15 分钟后再试' },
          { status: 429 }
        );
      }

      if (!timingSafeEqual(password, envPassword)) {
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 }
        );
      }

      const response = NextResponse.json({ ok: true });
      const cookieValue = await buildAuthCookieValue('admin', 'admin');
      setAuthCookies(response, req, cookieValue, 'admin', 'admin');
      await setDeviceTrustCookie(response, req, 'admin');
      await resetLoginAttemptLimits('admin', getClientIp(req));

      return response;
    }

    const parsedBody = await readLimitedJson(req, 16 * 1024);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }
    const { username, password, turnstileToken } = parsedBody.data || {};

    if (!username || typeof username !== 'string' || username.length > 64) {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length > 200) {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    const clientIp = getClientIp(req);
    const config = await getConfig();

    // Cloudflare Turnstile 登录环境人机验证
    if (isTurnstileRequiredForScene(config, 'login')) {
      const tc = resolveTurnstileConfig(config);
      const turnstileRes = await verifyTurnstileToken({
        token: turnstileToken,
        secretKey: tc.SecretKey,
        remoteIp: clientIp,
      });
      if (!turnstileRes.ok) {
        return NextResponse.json(
          { error: turnstileRes.error },
          { status: 400 }
        );
      }
    }

    if (
      !(await checkLoginAttemptLimits(
        username,
        clientIp,
        await hasDeviceTrust(req, username)
      ))
    ) {
      return NextResponse.json(
        { error: '该账号尝试登录过于频繁，请 15 分钟后再试' },
        { status: 429 }
      );
    }

    const ownerUsername = process.env.USERNAME || '';
    const ownerPassword = process.env.PASSWORD || '';
    const isOwnerUser = Boolean(ownerUsername && timingSafeEqual(username, ownerUsername));
    const isOwnerPass = Boolean(ownerPassword && timingSafeEqual(password, ownerPassword));

    if (isOwnerUser && isOwnerPass) {
      const response = NextResponse.json({ ok: true });
      const cookieValue = await buildAuthCookieValue(username, 'admin');
      setAuthCookies(response, req, cookieValue, username, 'admin');
      await setDeviceTrustCookie(response, req, username);
      await resetLoginAttemptLimits(username, clientIp);

      return response;
    } else if (isOwnerUser) {
      // 🛡️ 安全修复 (SEC-NEW-05)：站长用户名密码错误时同样执行一次 PBKDF2 虚拟哈希计算，
      // 消除“站长账号立即返回、普通账号执行 10 万次 PBKDF2”导致的时序侧信道泄露。
      await verifyPasswordDummy(password);
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    try {
      const pass = await db.verifyUser(username, password);
      if (!pass) {
        return NextResponse.json(
          { error: '用户名或密码错误' },
          { status: 401 }
        );
      }

      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (user && user.banned) {
        return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
      }

      const sessionRole = user && user.role === 'admin' ? 'admin' : 'user';

      const response = NextResponse.json({ ok: true });
      const cookieValue = await buildAuthCookieValue(username, sessionRole);
      setAuthCookies(response, req, cookieValue, username, sessionRole);
      await setDeviceTrustCookie(response, req, username);
      await resetLoginAttemptLimits(username, clientIp);

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
