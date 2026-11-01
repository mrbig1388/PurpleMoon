/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getClientIp, UNKNOWN_IP } from '@/lib/client-ip';
import {
  getConfig,
  invalidateConfigCache,
  persistNewUserGroup,
  withConfigConflictRetry,
} from '@/lib/config';
import { UserExistsError } from '@/lib/config-errors';
import {
  buildAuthCookieValue,
  readLimitedJson,
  setAuthCookies,
} from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';
import { db, getStorage } from '@/lib/db';
import {
  verifyAndConsumeInviteCode,
  verifyInviteCodeReadOnly,
} from '@/lib/invite';
import {
  isTurnstileRequiredForScene,
  resolveTurnstileConfig,
  verifyTurnstileToken,
} from '@/lib/turnstile';
import { isUsernameTaken } from '@/lib/username';

export const runtime = 'edge';

const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'd1'
    | 'upstash'
    | undefined) || 'localstorage';

// 🛡️ 结构防线 (SEC-07)：严格校验注册入参格式
const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, '用户名长度不能少于3个字符')
    .max(32, '用户名长度不能超过32个字符')
    .regex(/^[a-zA-Z0-9_-]+$/, '用户名仅允许包含字母、数字、下划线及连字符'),
  password: z
    .string()
    .min(6, '密码长度不能少于6位')
    .max(100, '密码长度不能超过100位'),
  inviteCode: z.string().trim().optional(),
  turnstileToken: z.string().trim().optional(),
});

// =========== 防刷机制 (Rate Limiter) ===========
const localRateLimitMap = new Map<string, { count: number; timestamp: number }>();

function checkLocalRateLimit(key: string, maxPerMin = 5): boolean {
  const now = Date.now();
  const limitData = localRateLimitMap.get(key);

  localRateLimitMap.forEach((value, k) => {
    if (now - value.timestamp > 60000) localRateLimitMap.delete(k);
  });

  if (limitData && now - limitData.timestamp < 60000) {
    if (limitData.count >= maxPerMin) return false;
    limitData.count++;
  } else {
    localRateLimitMap.set(key, { count: 1, timestamp: now });
  }
  return true;
}

async function checkRateLimit(ip: string): Promise<boolean> {
  const maxPerMin = ip === UNKNOWN_IP ? 20 : 5;
  if (STORAGE_TYPE === 'localstorage') {
    return checkLocalRateLimit(ip, maxPerMin);
  }

  try {
    const key = `rate_limit:register:${ip}`;
    return await db.checkRateLimit(key, maxPerMin, 60000);
  } catch (err) {
    console.error('全局限流检查异常，安全降级至内存限流:', err);
    return checkLocalRateLimit(ip, maxPerMin);
  }
}

export async function POST(req: NextRequest) {
  // 🛡️ 安全修复 (SEC-NEW-04)：拦截跨站注册请求（Register CSRF）
  const csrf = checkCsrf(req);
  if (!csrf.ok) return csrf.response;

  try {
    const ip = getClientIp(req);
    if (!(await checkRateLimit(ip))) {
      return NextResponse.json(
        { error: '请求过于频繁，请 1 分钟后再试' },
        { status: 429 }
      );
    }

    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: '当前模式不支持注册' },
        { status: 400 }
      );
    }

    const parsedBody = await readLimitedJson(req, 16 * 1024);
    if (!parsedBody.ok) {
      return NextResponse.json(
        { error: parsedBody.error },
        { status: parsedBody.status }
      );
    }
    const parseResult = registerSchema.safeParse(parsedBody.data);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0].message },
        { status: 400 }
      );
    }

    const { username, password, inviteCode, turnstileToken } = parseResult.data;

    const config = await getConfig();
    if (!config.UserConfig.AllowRegister) {
      return NextResponse.json({ error: '当前未开放注册' }, { status: 400 });
    }

    // Cloudflare Turnstile 注册环境人机验证
    if (isTurnstileRequiredForScene(config, 'register')) {
      const tc = resolveTurnstileConfig(config);
      const turnstileRes = await verifyTurnstileToken({
        token: turnstileToken,
        secretKey: tc.SecretKey,
        remoteIp: ip,
      });
      if (!turnstileRes.ok) {
        return NextResponse.json(
          { error: turnstileRes.error },
          { status: 400 }
        );
      }
    }

    // 1. 快速只读预检邀请码（拦截空码、错误码、已耗尽码，不触发写锁）
    const preCheck = verifyInviteCodeReadOnly(config, inviteCode);
    if (!preCheck.ok) {
      return NextResponse.json(
        { error: preCheck.error },
        { status: preCheck.status }
      );
    }

    if (
      isUsernameTaken(
        username,
        config.UserConfig.Users.map((u) => u.username),
        process.env.USERNAME
      )
    ) {
      return NextResponse.json({ error: '用户已存在' }, { status: 400 });
    }

    try {
      const exist = await db.checkUserExist(username);
      if (exist) {
        return NextResponse.json({ error: '用户已存在' }, { status: 400 });
      }

      let assignedGroup = preCheck.groupId;
      let consumedCode: string | undefined;
      const storage = getStorage() as any;

      // 2. 若启用了后台邀请码，在乐观并发锁（withConfigConflictRetry）中原子扣减次数并预写入用户分组，
      // 严防并发抢注突破 maxUses（如默认 10 次）限制，同时消除注册落库与写入分组之间的竞态窗口。
      if (
        preCheck.mode === 'config_code' &&
        storage &&
        typeof storage.setAdminConfig === 'function'
      ) {
        const atomicRes = await withConfigConflictRetry(async () => {
          invalidateConfigCache();
          const freshConfig = await getConfig();
          if (!freshConfig.UserConfig.AllowRegister) {
            return { ok: false as const, status: 400, error: '当前未开放注册' };
          }
          if (
            isUsernameTaken(
              username,
              freshConfig.UserConfig.Users.map((u) => u.username),
              process.env.USERNAME
            )
          ) {
            return { ok: false as const, status: 400, error: '用户已存在' };
          }

          const consumeRes = verifyAndConsumeInviteCode(
            freshConfig,
            inviteCode
          );
          if (!consumeRes.ok) return consumeRes;

          const existingEntry = freshConfig.UserConfig.Users.find(
            (u) => u.username === username
          );
          if (existingEntry) {
            if (existingEntry.role !== 'owner') {
              existingEntry.role = 'user';
              existingEntry.group = consumeRes.groupId;
              existingEntry.banned = false;
              delete existingEntry.sessionsValidAfter;
            }
          } else {
            freshConfig.UserConfig.Users.push({
              username,
              role: 'user',
              group: consumeRes.groupId,
            });
          }

          await storage.setAdminConfig(freshConfig);
          invalidateConfigCache();
          return consumeRes;
        });

        if (!atomicRes.ok) {
          return NextResponse.json(
            { error: atomicRes.error },
            { status: atomicRes.status }
          );
        }
        assignedGroup = atomicRes.groupId;
        consumedCode = atomicRes.consumedCode;
      }

      // 3. 写入底层用户表；若底层写入异常且已扣减邀请码次数，执行补偿回滚
      try {
        await db.registerUser(username, password);
      } catch (regErr) {
        if (
          consumedCode &&
          storage &&
          typeof storage.setAdminConfig === 'function'
        ) {
          try {
            await withConfigConflictRetry(async () => {
              invalidateConfigCache();
              const rollbackConfig = await getConfig();
              const item = rollbackConfig.InviteConfig?.Codes?.find(
                (c) => c.code === consumedCode
              );
              if (item && item.usedCount > 0) {
                item.usedCount -= 1;
              }
              // 同名用户已被别人抢先注册时，不能删掉对方在配置里的条目，只回退邀请码次数
              if (!(regErr instanceof UserExistsError)) {
                rollbackConfig.UserConfig.Users =
                  rollbackConfig.UserConfig.Users.filter(
                    (u) => u.username !== username
                  );
              }
              await storage.setAdminConfig(rollbackConfig);
              invalidateConfigCache();
            });
          } catch (rollbackErr) {
            console.error('注册失败后回滚邀请码次数异常:', rollbackErr);
          }
        }
        // 原子判重：同名并发注册里输掉的那个请求，明确返回“用户已存在”而不是 500
        if (regErr instanceof UserExistsError) {
          return NextResponse.json({ error: '用户已存在' }, { status: 400 });
        }
        throw regErr;
      }

      // 若未走后台邀请码原子预写入分支（例如关闭了邀请码或使用环境变量邀请码），固化分配分组
      if (!consumedCode) {
        await persistNewUserGroup(username, assignedGroup);
      }

      const response = NextResponse.json({ ok: true, group: assignedGroup });
      const cookieValue = await buildAuthCookieValue(username, 'user');
      setAuthCookies(response, req, cookieValue, username, 'user');

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
