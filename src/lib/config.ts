/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

import { getStorage } from '@/lib/db';

import { AdminConfig } from './admin.types';
import { ConfigConflictError } from './config-errors';
import runtimeConfig from './runtime';

// 重新导出，让调用方可以继续从 '@/lib/config' 引入 ConfigConflictError，
// 无需关心它实际定义在独立的 config-errors.ts 里（避免循环依赖，见该文件注释）。
export { ConfigConflictError };

/**
 * 对"读取配置 → 修改 → 写回"这类操作做并发冲突重试。
 * 传入的 fn 应当是一个完整的、幂等可重复执行的流程：每次重试都会
 * 重新调用 fn（fn 内部应重新 getConfig() 读最新数据，而不是复用外部闭包里
 * 的旧配置对象），直到写入成功或达到重试上限。
 *
 * 这样管理端各接口无需重写自身业务逻辑结构，只需把原有的
 * "读配置 → 校验 → 修改 → setAdminConfig" 整体包一层即可获得并发安全性。
 */
export async function withConfigConflictRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ConfigConflictError) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new ConfigConflictError();
}

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

interface ConfigFileStruct {
  cache_time?: number;
  api_site: {
    [key: string]: ApiSite;
  };
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

// 在模块加载时根据环境决定配置来源
let fileConfig: ConfigFileStruct;
let cachedConfig: AdminConfig;

// ================== 核心同步逻辑抽离 ==================
// 用于将真实的底层用户列表与 JSON 配置中的权限/封禁状态进行动态合并
function syncUsers(jsonUsers: any[] = [], dbUserNames: string[] = []): any[] {
  const userMap = new Map();
  jsonUsers.forEach((u) => userMap.set(u.username, u));

  const syncedUsers: any[] = [];
  const ownerUser = process.env.USERNAME;

  // 1. 确保站长绝对在第一位
  if (ownerUser) {
    syncedUsers.push({ username: ownerUser, role: 'owner' });
    userMap.delete(ownerUser);
  }

  // 2. 遍历底层数据库中的所有真实用户
  dbUserNames.forEach((uname) => {
    if (uname === ownerUser) return;
    if (userMap.has(uname)) {
      // 如果 JSON 中已有该用户，保留其原有状态（如被封禁、特殊权限等）
      syncedUsers.push(userMap.get(uname));
      userMap.delete(uname);
    } else {
      // 发现新注册的用户，动态赋予默认的 user 角色
      syncedUsers.push({ username: uname, role: 'user' });
    }
  });

  // 3. 将残留的（可能在 JSON 中但底层表已被删的异常数据）追加回去
  userMap.forEach((u) => syncedUsers.push(u));

  return syncedUsers;
}
// ====================================================

async function initConfig() {
  if (cachedConfig) {
    return;
  }

  if (process.env.DOCKER_ENV === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const _require = eval('require') as NodeRequire;
    const fs = _require('fs') as typeof import('fs');
    const path = _require('path') as typeof import('path');

    const configPath = path.join(process.cwd(), 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw) as ConfigFileStruct;
    console.log('load dynamic config success');
  } else {
    // 默认使用编译时生成的配置
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
  }
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType !== 'localstorage') {
    // 数据库存储，读取并补全管理员配置
    const storage = getStorage();

    try {
      // 尝试从数据库获取管理员配置
      let adminConfig: AdminConfig | null = null;
      if (storage && typeof (storage as any).getAdminConfig === 'function') {
        adminConfig = await (storage as any).getAdminConfig();
      }

      // 获取所有真实的用户名
      let userNames: string[] = [];
      if (storage && typeof (storage as any).getAllUsers === 'function') {
        try {
          userNames = await (storage as any).getAllUsers();
        } catch (e) {
          console.error('获取用户列表失败:', e);
        }
      }

      const apiSiteEntries = Object.entries(fileConfig.api_site);

      if (adminConfig) {
        // 补全 SourceConfig
        const existed = new Set(
          (adminConfig.SourceConfig || []).map((s) => s.key)
        );
        apiSiteEntries.forEach(([key, site]) => {
          if (!existed.has(key)) {
            adminConfig!.SourceConfig.push({
              key,
              name: site.name,
              api: site.api,
              detail: site.detail,
              from: 'config',
              disabled: false,
            });
          }
        });

        // 检查现有源是否在 fileConfig.api_site 中，如果不在则标记为 custom
        const apiSiteKeys = new Set(apiSiteEntries.map(([key]) => key));
        adminConfig.SourceConfig.forEach((source) => {
          if (!apiSiteKeys.has(source.key)) {
            source.from = 'custom';
          }
        });

        // 动态合并补全 Users (自我修复)
        adminConfig.UserConfig.Users = syncUsers(adminConfig.UserConfig.Users, userNames);

      } else {
        // 数据库中没有配置，创建新的管理员配置
        adminConfig = {
          configVersion: 0,
          SiteConfig: {
            SiteName: process.env.SITE_NAME || 'PurpleMoon',
            Announcement:
              process.env.ANNOUNCEMENT ||
              'Welcome to PurpleMoon. Please note that all content available on this site is sourced from the Internet.',
            SearchDownstreamMaxPage:
              Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
            SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
            ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',
          },
          UserConfig: {
            AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
            Users: syncUsers([], userNames) as any,
          },
          SourceConfig: apiSiteEntries.map(([key, site]) => ({
            key,
            name: site.name,
            api: site.api,
            detail: site.detail,
            from: 'config',
            disabled: false,
          })),
        };
      }

      // 写回数据库（更新/创建）
      // 🛡️ 逻辑修复 (P2 · L-02)：这里只是把 config.json 里的资源站信息
      // 合并进已有配置的"自愈式"写入，不是管理员发起的主动编辑，
      // 遇到并发冲突时无需报错中断——本次内存中的 adminConfig 仍然是
      // 正确可用的数据，直接跳过持久化、留给下一次访问再重试即可。
      if (storage && typeof (storage as any).setAdminConfig === 'function') {
        try {
          await (storage as any).setAdminConfig(adminConfig);
        } catch (writeErr) {
          if (writeErr instanceof ConfigConflictError) {
            console.warn('自愈式配置合并写入遇到并发冲突，已跳过本次持久化:', writeErr.message);
          } else {
            throw writeErr;
          }
        }
      }

      // 更新缓存
      cachedConfig = adminConfig;
    } catch (err) {
      console.error('加载管理员配置失败:', err);
    }
  } else {
    // 本地存储直接使用文件配置
    cachedConfig = {
      SiteConfig: {
        SiteName: process.env.SITE_NAME || 'PurpleMoon',
        Announcement:
          process.env.ANNOUNCEMENT ||
          'Welcome to PurpleMoon. Please note that all content available on this site is sourced from the Internet.',
        SearchDownstreamMaxPage:
          Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
        SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
        ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',
      },
      UserConfig: {
        AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
        Users: [],
      },
      SourceConfig: Object.entries(fileConfig.api_site).map(([key, site]) => ({
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
      })),
    } as AdminConfig;
  }
}

export async function getConfig(): Promise<AdminConfig> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (process.env.DOCKER_ENV === 'true' || storageType === 'localstorage') {
    await initConfig();
    return cachedConfig;
  }
  
  // 非 docker 环境且 DB 存储，直接读 db 配置
  const storage = getStorage();
  let adminConfig: AdminConfig | null = null;
  if (storage && typeof (storage as any).getAdminConfig === 'function') {
    adminConfig = await (storage as any).getAdminConfig();
  }

  if (adminConfig) {
    // 合并一些环境变量配置
    adminConfig.SiteConfig.SiteName = process.env.SITE_NAME || 'PurpleMoon';
    adminConfig.SiteConfig.Announcement =
      process.env.ANNOUNCEMENT ||
      'Welcome to PurpleMoon. Please note that all content available on this site is sourced from the Internet.';
    adminConfig.UserConfig.AllowRegister =
      process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
    adminConfig.SiteConfig.ImageProxy =
      process.env.NEXT_PUBLIC_IMAGE_PROXY || '';

    // ================= 修复后台用户列表缺失问题 =================
    if (typeof (storage as any).getAllUsers === 'function') {
      try {
        const userNames: string[] = await (storage as any).getAllUsers();
        // 自动合并底层真实数据与 JSON 状态
        adminConfig.UserConfig.Users = syncUsers(adminConfig.UserConfig.Users, userNames);
      } catch (e) {
        console.error('动态同步用户列表失败:', e);
      }
    }
    // ============================================================

    // 合并文件中的源信息
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
    const apiSiteEntries = Object.entries(fileConfig.api_site);
    const existed = new Set((adminConfig.SourceConfig || []).map((s) => s.key));
    apiSiteEntries.forEach(([key, site]) => {
      if (!existed.has(key)) {
        adminConfig!.SourceConfig.push({
          key,
          name: site.name,
          api: site.api,
          detail: site.detail,
          from: 'config',
          disabled: false,
        });
      }
    });

    const apiSiteKeys = new Set(apiSiteEntries.map(([key]) => key));
    adminConfig.SourceConfig.forEach((source) => {
      if (!apiSiteKeys.has(source.key)) {
        source.from = 'custom';
      }
    });
    cachedConfig = adminConfig;
  } else {
    // DB 无配置，执行一次初始化
    await initConfig();
  }
  return cachedConfig;
}

export async function resetConfig() {
  const storage = getStorage();
  let userNames: string[] = [];
  if (storage && typeof (storage as any).getAllUsers === 'function') {
    try {
      userNames = await (storage as any).getAllUsers();
    } catch (e) {
      console.error('获取用户列表失败:', e);
    }
  }

  if (process.env.DOCKER_ENV === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const _require = eval('require') as NodeRequire;
    const fs = _require('fs') as typeof import('fs');
    const path = _require('path') as typeof import('path');

    const configPath = path.join(process.cwd(), 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw) as ConfigFileStruct;
    console.log('load dynamic config success');
  } else {
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
  }

  const apiSiteEntries = Object.entries(fileConfig.api_site);
  
  const adminConfig = {
    SiteConfig: {
      SiteName: process.env.SITE_NAME || 'PurpleMoon',
      Announcement:
        process.env.ANNOUNCEMENT ||
        'Welcome to PurpleMoon. Please note that all content available on this site is sourced from the Internet.',
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
      ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',
    },
    UserConfig: {
      AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
      Users: syncUsers([], userNames) as any, // 确保重置时也提取底层数据
    },
    SourceConfig: apiSiteEntries.map(([key, site]) => ({
      key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    })),
  } as AdminConfig;

  if (storage && typeof (storage as any).setAdminConfig === 'function') {
    await (storage as any).setAdminConfig(adminConfig);
  }
  if (cachedConfig == null) {
    cachedConfig = adminConfig;
  }
  cachedConfig.SiteConfig = adminConfig.SiteConfig;
  cachedConfig.UserConfig = adminConfig.UserConfig;
  cachedConfig.SourceConfig = adminConfig.SourceConfig;
}

export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

export async function getAvailableApiSites(): Promise<ApiSite[]> {
  const config = await getConfig();
  return config.SourceConfig.filter((s) => !s.disabled).map((s) => ({
    key: s.key,
    name: s.name,
    api: s.api,
    detail: s.detail,
  }));
}
