/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthUser } from '@/lib/auth-server';
import {
  getConfig,
  invalidateConfigCache,
  withConfigConflictRetry,
} from '@/lib/config';
import { readLimitedJson } from '@/lib/cookies';
import { checkCsrf } from '@/lib/csrf-guard';
import { getStorage } from '@/lib/db';
import { resolveTurnstileConfig } from '@/lib/turnstile';
import { IStorage } from '@/lib/types';

export const runtime = 'edge';

const bad = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response;

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return bad('不支持本地存储进行管理员配置');
  }

  try {
    // 仅允许站长（owner）管理 Cloudflare Turnstile 人机验证配置
    const authUser = await getVerifiedAuthUser(request, {
      requiredRole: 'owner',
    });
    if (!authUser || authUser.username !== process.env.USERNAME) {
      return bad('仅站长可管理人机验证配置', 401);
    }

    const parsedBody = await readLimitedJson(request, 16 * 1024);
    if (!parsedBody.ok) return bad(parsedBody.error, parsedBody.status);
    const body = parsedBody.data || {};

    if (
      typeof body.Enabled !== 'boolean' ||
      typeof body.EnableLogin !== 'boolean' ||
      typeof body.EnableRegister !== 'boolean' ||
      typeof body.SiteKey !== 'string' ||
      typeof body.SecretKey !== 'string'
    ) {
      return bad('参数格式错误');
    }

    const siteKey = body.SiteKey.trim();
    const secretKey = body.SecretKey.trim();

    if (siteKey.length > 256 || secretKey.length > 256) {
      return bad('密钥长度超出限制');
    }

    if (body.Enabled && (!siteKey || !secretKey)) {
      return bad('启用人机验证前请先填写完整的 Site Key 和 Secret Key');
    }

    return await withConfigConflictRetry(async () => {
      const adminConfig = await getConfig();
      const storage: IStorage | null = getStorage();

      const prev = resolveTurnstileConfig(adminConfig);
      adminConfig.TurnstileConfig = {
        Enabled: body.Enabled,
        EnableLogin: body.EnableLogin,
        EnableRegister: body.EnableRegister,
        SiteKey: siteKey,
        SecretKey: secretKey || prev.SecretKey,
      };
      // 若用户明确清空 SecretKey（且未启用验证），允许保存空字符串
      if (body.SecretKey.trim() === '') {
        adminConfig.TurnstileConfig.SecretKey = '';
      }

      if (storage && typeof (storage as any).setAdminConfig === 'function') {
        await (storage as any).setAdminConfig(adminConfig);
      }
      invalidateConfigCache();

      return NextResponse.json(
        { ok: true },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    });
  } catch (error) {
    console.error('更新 Turnstile 人机验证配置失败:', error);
    return NextResponse.json(
      { error: '更新人机验证配置失败' },
      { status: 500 }
    );
  }
}
