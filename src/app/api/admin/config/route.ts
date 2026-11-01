/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfigResult } from '@/lib/admin.types';
import { getVerifiedAuthUser } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { getUserGroupDef } from '@/lib/user-groups';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  // 🛡️ 安全修复 (SEC-02, SEC-04, SEC-NEW-07)：强制服务端签名与实时角色重验
  const authUser = await getVerifiedAuthUser(request, { requiredRole: 'admin' });
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authUser.username;

  try {
    const config = authUser.config ?? (await getConfig());
    let role: 'owner' | 'admin' = 'owner';

    if (username === process.env.USERNAME) {
      role = 'owner';
    } else {
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (user && user.role === 'admin') {
        role = 'admin';
      } else {
        return NextResponse.json(
          { error: '权限不足，仅管理员或站长可访问' },
          { status: 401 }
        );
      }
    }

    // 🛡️ 安全加固 (SEC-NEW-01)：若当前管理员属于受限分组（非 allSources），
    // 仅返回其有权访问的资源站配置，防止通过后台配置接口泄露未授权资源站的上游 API 地址。
    let visibleSourceConfig = config.SourceConfig;
    if (role === 'admin') {
      const groupDef = getUserGroupDef(config, username);
      if (groupDef && !groupDef.allSources) {
        const allowedKeys = new Set(groupDef.sourceKeys);
        visibleSourceConfig = config.SourceConfig.filter((s) =>
          allowedKeys.has(s.key)
        );
      }
    }

    // 🛡️ 越权防护：邀请码与 Turnstile 密钥仅站长（owner）可读取
    const sanitizedConfig = {
      ...config,
      SourceConfig: visibleSourceConfig,
      ...(role === 'owner'
        ? {
            InviteConfig: config.InviteConfig,
            TurnstileConfig: config.TurnstileConfig,
          }
        : {
            InviteConfig: undefined,
            TurnstileConfig: undefined,
          }),
    };

    const result: AdminConfigResult = {
      Role: role,
      Config: sanitizedConfig,
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('获取管理员配置失败:', error);
    return NextResponse.json(
      {
        error: '获取管理员配置失败',
      },
      { status: 500 }
    );
  }
}
