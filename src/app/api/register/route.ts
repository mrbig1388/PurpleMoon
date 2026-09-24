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
const localRateLimitMap = new Map<string, { count: number; timestamp: number }>();

async function checkRateLimit(ip: string): Promise<boolean> {
  if (STORAGE_TYPE === 'localstorage') {
    const now = Date.now();
    const limitData = localRateLimitMap.get(ip);

    localRateLimitMap.forEach((value, key) => {
      if (now - value.timestamp > 60000) localRateLimitMap.delete(key);
    });

    if (limitData && now - limitData.timestamp < 60000) {
      if (limitData.count >= 5) return false;
      limitData.count++;
    } else {
      localRateLimitMap.set(ip, { count: 1, timestamp: now });
    }
    return true;
  }

  try {
    const key = `rate_limit:register:${ip}`;
    return await db.checkRateLimit(key, 5, 60000);
  } catch (err) {
    console.error('全局限流检查异常，默认放行:', err);
    return true; 
  }
}
// ==============================================

// 🛡️ 安全修复 (P0)：与 login.ts 相同，移除本文件内重复的签名实现，
// 该实现此前在密钥缺失时会静默退化为空字符串密钥（比硬编码默认值更弱），
// 现统一改为调用 lib/auth.ts 中已加固（fail-closed、无兜底默认值）的
// signAuthPayload，密钥缺失时会向上抛出错误，由 POST 处理函数统一捕获。
async function generateAuthCookie(username: string, role = 'user'): Promise<string> {
  const timestamp = Date.now();
  const signature = await signAuthPayload(username, timestamp, role);
  return encodeURIComponent(JSON.stringify({ username, role, timestamp, signature }));
}

// ==========================================
// 🛡️ 签发双 Cookie
// ==========================================
function setDualCookies(response: NextResponse, authValue: string, username: string, role: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  response.cookies.set('auth', authValue, { path: '/', expires, sameSite: 'lax', httpOnly: true, secure: isProduction });
  const userInfoValue = encodeURIComponent(JSON.stringify({ username, role }));
  response.cookies.set('user_info', userInfoValue, { path: '/', expires, sameSite: 'lax', httpOnly: false, secure: isProduction });
}

export async function POST(req: NextRequest) {
  try {
    // 🛡️ 安全修复 (P2 · L-05)：统一、可配置的 IP 识别逻辑（详见 lib/client-ip.ts）
    const ip = getClientIp(req);
    if (!(await checkRateLimit(ip))) {
      return NextResponse.json({ error: '请求过于频繁，请 1 分钟后再试' }, { status: 429 });
    }

    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: '当前模式不支持注册' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    if (!config.UserConfig.AllowRegister) {
      return NextResponse.json({ error: '当前未开放注册' }, { status: 400 });
    }

    const { username, password, inviteCode } = await req.json();

    // ================= 强制邀请码校验 (Fail Closed) =================
    // 🛡️ 安全修复 (P1 · L-01)：
    // 1) 原实现复用 NEXT_PUBLIC_ENABLE_REGISTER 同时表达"是否开放注册"和
    //    "是否需要邀请码"两层语义，容易让运维在只想打开注册功能时，
    //    无意中一并开启了邀请码强制校验。这里拆分为独立的 REQUIRE_INVITE_CODE
    //    开关，同时向后兼容旧的 NEXT_PUBLIC_ENABLE_REGISTER 行为（未显式配置
    //    REQUIRE_INVITE_CODE 时退回旧逻辑，避免已部署环境行为突变）。
    // 2) 邀请码比较由 `!==` 改为恒定时间比较，避免逐字符比较带来的时序侧信道。
    const requireInviteCode =
      process.env.REQUIRE_INVITE_CODE !== undefined
        ? process.env.REQUIRE_INVITE_CODE === 'true'
        : process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
    const validInviteCode = process.env.VALID_INVITE_CODE;

    if (requireInviteCode) {
      if (!validInviteCode) {
        console.error('严重的配置错误: 系统开启了邀请注册机制，但未在环境变量中配置 VALID_INVITE_CODE');
        return NextResponse.json({ error: '系统配置异常：注册通道暂时关闭，请联系管理员' }, { status: 500 });
      }

      if (!inviteCode || typeof inviteCode !== 'string') {
        return NextResponse.json({ error: '系统已开启邀请制，必须填写邀请码才可注册' }, { status: 400 });
      }

      if (!timingSafeEqual(inviteCode, validInviteCode)) {
        return NextResponse.json({ error: '邀请码错误或已失效' }, { status: 403 });
      }
    }
    // ================================================================

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户已存在' }, { status: 400 });
    }

    try {
      const exist = await db.checkUserExist(username);
      if (exist) {
        return NextResponse.json({ error: '用户已存在' }, { status: 400 });
      }

      await db.registerUser(username, password);

      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(username, 'user');
      
      // 使用双 Cookie 下发
      setDualCookies(response, cookieValue, username, 'user');

      return response;
    } catch (err) {
      console.error('数据库注册失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('注册接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
