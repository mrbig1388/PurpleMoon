/* eslint-disable @typescript-eslint/no-explicit-any,no-console,@typescript-eslint/no-non-null-assertion */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, withConfigConflictRetry } from '@/lib/config';
import { checkCsrf } from '@/lib/csrf-guard';
import { getStorage } from '@/lib/db';
import { IStorage } from '@/lib/types';

export const runtime = 'edge';

// 支持的操作类型
const ACTIONS = [
  'add',
  'ban',
  'unban',
  'setAdmin',
  'cancelAdmin',
  'setAllowRegister',
  'changePassword',
  'deleteUser',
] as const;

export async function POST(request: NextRequest) {
  // 🛡️ CSRF 纵深防御（统一使用 lib/csrf-guard.ts，与其他接口保持一致）
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response!;

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      targetUsername, // 目标用户名
      targetPassword, // 目标用户密码（仅在添加用户时需要）
      allowRegister,
      action,
    } = body as {
      targetUsername?: string;
      targetPassword?: string;
      allowRegister?: boolean;
      action?: (typeof ACTIONS)[number];
    };

    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    if (action !== 'setAllowRegister' && !targetUsername) {
      return NextResponse.json({ error: '缺少目标用户名' }, { status: 400 });
    }

    if (
      action !== 'setAllowRegister' &&
      action !== 'changePassword' &&
      action !== 'deleteUser' &&
      username === targetUsername
    ) {
      return NextResponse.json(
        { error: '无法对自己进行此操作' },
        { status: 400 }
      );
    }

    // 🛡️ 逻辑修复 (P2 · L-02)：把"读配置→校验→修改→写回"整体包进并发冲突重试。
    // 每次重试都会重新 getConfig() 读最新数据，而不是复用旧的配置对象，
    // 避免两个管理员并发操作时其中一方的修改被静默覆盖。
    return await withConfigConflictRetry(async () => {
    // 获取配置与存储
    const adminConfig = await getConfig();
    const storage: IStorage | null = getStorage();

    // 判定操作者角色
    let operatorRole: 'owner' | 'admin';
    if (username === process.env.USERNAME) {
      operatorRole = 'owner';
    } else {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin') {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
      operatorRole = 'admin';
    }

    // 查找目标用户条目
    let targetEntry = adminConfig.UserConfig.Users.find(
      (u) => u.username === targetUsername
    );

    if (
      targetEntry &&
      targetEntry.role === 'owner' &&
      action !== 'changePassword'
    ) {
      return NextResponse.json({ error: '无法操作站长' }, { status: 400 });
    }

    // 权限校验逻辑
    const isTargetAdmin = targetEntry?.role === 'admin';

    if (action === 'setAllowRegister') {
      if (typeof allowRegister !== 'boolean') {
        return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
      }
      adminConfig.UserConfig.AllowRegister = allowRegister;
      // 保存后直接返回成功（走后面的统一保存逻辑）
    } else {
      switch (action) {
        case 'add': {
          // 🛡️ 已知的并发重试边界情况（P2 · L-02）：
          // storage.registerUser() 是一次性的真实副作用（写入密码哈希），
          // 不具备幂等性，因此不适合被整体重试。如果它成功后紧接着的
          // setAdminConfig 恰好遇到并发冲突，重试时 getConfig() 会因为
          // 下面的"自我修复"逻辑（syncUsers）已经自动把这个新注册的真实账号
          // 补回 Users 列表，导致这里误判为"用户已存在"并返回 400——
          // 但此时账号事实上已经创建成功，只是这次响应文案具有误导性。
          // 这是极端并发窗口下的已知取舍：相比修复前"配置写入被静默吞掉、
          // 完全不重试"的行为，仍是明显的改进，只是没有做到完全语义精确。
          if (targetEntry) {
            return NextResponse.json({ error: '用户已存在' }, { status: 400 });
          }
          if (!targetPassword) {
            return NextResponse.json(
              { error: '缺少目标用户密码' },
              { status: 400 }
            );
          }
          if (!storage || typeof storage.registerUser !== 'function') {
            return NextResponse.json(
              { error: '存储未配置用户注册' },
              { status: 500 }
            );
          }
          await storage.registerUser(targetUsername!, targetPassword);
          // 更新配置
          adminConfig.UserConfig.Users.push({
            username: targetUsername!,
            role: 'user',
          });
          targetEntry =
            adminConfig.UserConfig.Users[
              adminConfig.UserConfig.Users.length - 1
            ];
          break;
        }
        case 'ban': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (isTargetAdmin) {
            // 目标是管理员
            if (operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '仅站长可封禁管理员' },
                { status: 401 }
              );
            }
          }
          targetEntry.banned = true;
          break;
        }
        case 'unban': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (isTargetAdmin) {
            if (operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '仅站长可操作管理员' },
                { status: 401 }
              );
            }
          }
          targetEntry.banned = false;
          break;
        }
        case 'setAdmin': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (targetEntry.role === 'admin') {
            return NextResponse.json(
              { error: '该用户已是管理员' },
              { status: 400 }
            );
          }
          if (operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '仅站长可设置管理员' },
              { status: 401 }
            );
          }
          targetEntry.role = 'admin';
          break;
        }
        case 'cancelAdmin': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (targetEntry.role !== 'admin') {
            return NextResponse.json(
              { error: '目标用户不是管理员' },
              { status: 400 }
            );
          }
          if (operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '仅站长可取消管理员' },
              { status: 401 }
            );
          }
          targetEntry.role = 'user';
          break;
        }
        case 'changePassword': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (!targetPassword) {
            return NextResponse.json({ error: '缺少新密码' }, { status: 400 });
          }

          // 权限检查：不允许修改站长密码
          if (targetEntry.role === 'owner') {
            return NextResponse.json(
              { error: '无法修改站长密码' },
              { status: 401 }
            );
          }

          if (
            isTargetAdmin &&
            operatorRole !== 'owner' &&
            username !== targetUsername
          ) {
            return NextResponse.json(
              { error: '仅站长可修改其他管理员密码' },
              { status: 401 }
            );
          }

          if (!storage || typeof storage.changePassword !== 'function') {
            return NextResponse.json(
              { error: '存储未配置密码修改功能' },
              { status: 500 }
            );
          }

          await storage.changePassword(targetUsername!, targetPassword);
          break;
        }
        case 'deleteUser': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }

          // 权限检查：站长可删除所有用户（除了自己），管理员可删除普通用户
          if (username === targetUsername) {
            return NextResponse.json(
              { error: '不能删除自己' },
              { status: 400 }
            );
          }

          if (isTargetAdmin && operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '仅站长可删除管理员' },
              { status: 401 }
            );
          }

          if (!storage || typeof storage.deleteUser !== 'function') {
            return NextResponse.json(
              { error: '存储未配置用户删除功能' },
              { status: 500 }
            );
          }

          await storage.deleteUser(targetUsername!);

          // 从配置中移除用户
          const userIndex = adminConfig.UserConfig.Users.findIndex(
            (u) => u.username === targetUsername
          );
          if (userIndex > -1) {
            adminConfig.UserConfig.Users.splice(userIndex, 1);
          }

          break;
        }
        default:
          return NextResponse.json({ error: '未知操作' }, { status: 400 });
      }
    }

    // 将更新后的配置写入数据库
    if (storage && typeof (storage as any).setAdminConfig === 'function') {
      await (storage as any).setAdminConfig(adminConfig);
    }

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 管理员配置不缓存
        },
      }
    );
    }); // 结束 withConfigConflictRetry 包裹的闭包
  } catch (error) {
    console.error('用户管理操作失败:', error);
    return NextResponse.json(
      {
        error: '用户管理操作失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
