/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { Redis } from '@upstash/redis';

import { AdminConfig } from './admin.types';
import { ConfigConflictError } from './config-errors';
import { hashPassword, verifyPassword } from './password'; // 【安全升级】：引入加盐哈希与防时序攻击验证
import { Favorite, IStorage, Memo,PlayRecord, SkipConfig } from './types'; // 引入 SkipConfig 和 Memo

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 【新增安全机制】：便利贴全站最大条数限制
const MEMO_LIMIT = 30;

// 添加Upstash Redis操作重试包装器
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err: any) {
      const isLastAttempt = i === maxRetries - 1;
      const isConnectionError =
        err.message?.includes('Connection') ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('ENOTFOUND') ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        err.name === 'UpstashError';

      if (isConnectionError && !isLastAttempt) {
        console.log(
          `Upstash Redis operation failed, retrying... (${i + 1}/${maxRetries})`
        );
        console.error('Error:', err.message);

        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}

export class UpstashRedisStorage implements IStorage {
  private client: Redis;

  constructor() {
    this.client = getUpstashRedisClient();
  }

  // ---------- 播放记录 ----------
  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`; // u:username:pr:source+id
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await withRetry(() =>
      this.client.get(this.prKey(userName, key))
    );
    return val ? (val as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await withRetry(() => this.client.set(this.prKey(userName, key), record));
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const pattern = `u:${userName}:pr:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};

    const result: Record<string, PlayRecord> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value) {
        // 截取 source+id 部分
        const keyPart = fullKey.replace(`u:${userName}:pr:`, '');
        result[keyPart] = value as PlayRecord;
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.prKey(userName, key)));
  }

  // ---------- 收藏 ----------
  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await withRetry(() =>
      this.client.get(this.favKey(userName, key))
    );
    return val ? (val as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.favKey(userName, key), favorite)
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const pattern = `u:${userName}:fav:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};

    const result: Record<string, Favorite> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value) {
        const keyPart = fullKey.replace(`u:${userName}:fav:`, '');
        result[keyPart] = value as Favorite;
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.favKey(userName, key)));
  }

  // ---------- 用户注册 / 登录 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  // 【安全升级】：密码哈希化存储
  async registerUser(userName: string, password: string): Promise<void> {
    const hashedPassword = await hashPassword(password);
    await withRetry(() => this.client.set(this.userPwdKey(userName), hashedPassword));
  }

  // 【安全升级】：防时序攻击验证（兼容旧版明文密码）
  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    return await verifyPassword(password, stored as string);
  }

  // 检查用户是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判断 key 是否存在
    const exists = await withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 【安全升级】：新密码哈希化存储
  async changePassword(userName: string, newPassword: string): Promise<void> {
    const hashedPassword = await hashPassword(newPassword);
    await withRetry(() =>
      this.client.set(this.userPwdKey(userName), hashedPassword)
    );
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    // 删除用户密码
    await withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 删除搜索历史
    await withRetry(() => this.client.del(this.shKey(userName)));

    // 删除便利贴限流 Key
    await withRetry(() => this.client.del(`memo:rate:${userName}`));

    // 删除播放记录
    const playRecordPattern = `u:${userName}:pr:*`;
    const playRecordKeys = await withRetry(() =>
      this.client.keys(playRecordPattern)
    );
    if (playRecordKeys.length > 0) {
      await withRetry(() => this.client.del(...playRecordKeys));
    }

    // 删除收藏夹
    const favoritePattern = `u:${userName}:fav:*`;
    const favoriteKeys = await withRetry(() =>
      this.client.keys(favoritePattern)
    );
    if (favoriteKeys.length > 0) {
      await withRetry(() => this.client.del(...favoriteKeys));
    }

    // 删除跳过配置
    const skipPattern = `u:${userName}:skip:*`;
    const skipKeys = await withRetry(() => this.client.keys(skipPattern));
    if (skipKeys.length > 0) {
      await withRetry(() => this.client.del(...skipKeys));
    }

    // 【修复版】：通过 LREM 原理清理全员共享便利贴中该用户发布的所有记录
    const list = await withRetry(() =>
      this.client.lrange<string | object>(this.memosKey(), 0, -1)
    );
    if (Array.isArray(list)) {
      for (const item of list) {
        const memo = typeof item === 'string' ? JSON.parse(item) : item;
        if (memo.username === userName) {
          const targetStr = typeof item === 'string' ? item : JSON.stringify(item);
          await withRetry(() => this.client.lrem(this.memosKey(), 0, targetStr));
        }
      }
    }
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await withRetry(() =>
      this.client.lrange(this.shKey(userName), 0, -1)
    );
    return result as string[];
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await withRetry(() => this.client.lrem(key, 0, keyword));
    // 插入到最前
    await withRetry(() => this.client.lpush(key, keyword));
    // 限制最大长度
    await withRetry(() => this.client.ltrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await withRetry(() => this.client.lrem(key, 0, keyword));
    } else {
      await withRetry(() => this.client.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    const keys = await withRetry(() => this.client.keys('u:*:pwd'));
    return keys
      .map((k) => {
        const match = k.match(/^u:(.+?):pwd$/);
        return match ? match[1] : undefined;
      })
      .filter((u): u is string => typeof u === 'string');
  }

  // ---------- 管理员配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await withRetry(() => this.client.get(this.adminConfigKey()));
    return val ? (val as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    // 🛡️ 逻辑修复 (P2 · L-02)：乐观并发控制。
    // Upstash 是无状态的 HTTP REST 客户端，不支持 node-redis 那种
    // WATCH/MULTI/EXEC 事务，改用 Lua 脚本（EVAL 在 Redis 中保证原子执行）
    // 实现"读版本号 → 比对 → 写入"的单步原子操作，与本文件里限流逻辑
    // 已经在用的 Lua 脚本模式保持一致。
    const expectedVersion = config.configVersion ?? 0;
    const newVersion = expectedVersion + 1;
    const newConfig = { ...config, configVersion: newVersion };

    const casLua = `
      local key = KEYS[1]
      local expectedVersion = tonumber(ARGV[1])
      local newValue = ARGV[2]

      local raw = redis.call('GET', key)
      local currentVersion = 0
      if raw then
        local ok, decoded = pcall(cjson.decode, raw)
        if ok and decoded and decoded.configVersion then
          currentVersion = decoded.configVersion
        end
      end

      if currentVersion == expectedVersion then
        redis.call('SET', key, newValue)
        return 1
      else
        return 0
      end
    `;

    const result = await withRetry(() =>
      this.client.eval(
        casLua,
        [this.adminConfigKey()],
        [String(expectedVersion), JSON.stringify(newConfig)]
      )
    );

    if (Number(result) !== 1) {
      throw new ConfigConflictError();
    }
    config.configVersion = newVersion;
  }

  // =========================================================================
  // 跳过片头片尾配置 (SkipConfig)
  // =========================================================================

  private skipKey(user: string, key: string) {
    return `u:${user}:skip:${key}`;
  }

  async getSkipConfig(userName: string, key: string): Promise<SkipConfig | null> {
    const val = await withRetry(() =>
      this.client.get(this.skipKey(userName, key))
    );
    return val ? (val as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    key: string,
    config: SkipConfig
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.skipKey(userName, key), config)
    );
  }

  async getAllSkipConfigs(userName: string): Promise<Record<string, SkipConfig>> {
    const pattern = `u:${userName}:skip:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};

    const result: Record<string, SkipConfig> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value) {
        const keyPart = fullKey.replace(`u:${userName}:skip:`, '');
        result[keyPart] = value as SkipConfig;
      }
    }
    return result;
  }

  async deleteSkipConfig(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.skipKey(userName, key)));
  }

  // =========================================================================
  // 【修复版】：全员共享便利贴 (Memos) - Redis 原生 List + 防刷/限流
  // =========================================================================

  private memosKey() {
    return 'global:memos'; // 统一存储于全站共享 Key
  }

  async getMemos(userName?: string): Promise<Memo[]> {
    const list = await withRetry(() =>
      this.client.lrange<string | object>(this.memosKey(), 0, -1)
    );
    const rawMemos = list || [];

    // 映射全站便利贴，并根据当前用户名计算 is_owner 状态
    return rawMemos.map((item) => {
      const memo = typeof item === 'string' ? JSON.parse(item) : item;
      return {
        ...memo,
        is_owner: Boolean(userName && memo.username === userName),
      };
    });
  }

  async addMemo(userName: string, content: string): Promise<void> {
    // 1. 内容校验
    const trimmed = content?.trim();
    if (!trimmed || trimmed.length === 0) {
      throw new Error('便利贴内容不能为空');
    }
    if (trimmed.length > 500) {
      throw new Error('便利贴内容不能超过 500 个字符');
    }

    // 2. 限流校验：基于 ZSET 滑动窗口检查单用户 60 秒内最多 3 条
    const isAllowed = await this.checkRateLimit(`memo:rate:${userName}`, 2, 600000);
    if (!isAllowed) {
      throw new Error('发布过于频繁，10分钟内最多只能发布 2 条便利贴。');
    }

    // 3. 构造唯一 ID 的便签对象
    const memoData = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      username: userName,
      content: trimmed,
      created_at: Date.now(),
    };
    const jsonStr = JSON.stringify(memoData);

    // 4. 原子入栈并截断
    await withRetry(() => this.client.lpush(this.memosKey(), jsonStr));
    await withRetry(() => this.client.ltrim(this.memosKey(), 0, MEMO_LIMIT - 1));
  }

  async deleteMemo(userName: string, memoId: number): Promise<boolean> {
    const list = await withRetry(() =>
      this.client.lrange<string | object>(this.memosKey(), 0, -1)
    );
    if (!list || list.length === 0) return false;

    for (const item of list) {
      const memo = typeof item === 'string' ? JSON.parse(item) : item;
      if (memo.id === memoId && memo.username === userName) {
        const targetStr = typeof item === 'string' ? item : JSON.stringify(item);
        // 原子删除指定元素
        await withRetry(() => this.client.lrem(this.memosKey(), 1, targetStr));
        return true;
      }
    }
    return false;
  }

  // =========================================================================
  // 全局分布式限流 (Rate Limiter) - 基于 ZSET 滑动窗口 (Sliding Window)
  // =========================================================================
  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    // 结合时间戳与随机字符串生成唯一成员，防止并发写入导致 Score 覆盖
    const memberId = `${now}:${Math.random().toString(36).substring(2, 7)}`;

    // ZSET 滑动窗口 Lua 脚本（确保原子化清除旧记录、计算当前窗口数量及写入）
    const slidingWindowLua = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local memberId = ARGV[4]
      
      local clearBefore = now - window

      -- 1. 移除时间窗口（windowMs）之前的过期记录
      redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)

      -- 2. 获取当前时间窗口内的有效记录条数
      local currentCount = redis.call('ZCARD', key)

      -- 3. 判断是否满足频次限制
      if currentCount < limit then
          -- 未超过限制：写入本次记录
          redis.call('ZADD', key, now, memberId)
          -- 刷新 Key 过期时间，防止冷数据长期占用 Key 资源
          redis.call('PEXPIRE', key, window)
          return 1
      else
          -- 已超过限制：返回 0 拒绝
          return 0
      end
    `;

    const result = await withRetry(() =>
      this.client.eval(
        slidingWindowLua,
        [key],
        [now.toString(), windowMs.toString(), limit.toString(), memberId]
      )
    );

    return Number(result) === 1;
  }
}

// 单例 Upstash Redis 客户端
function getUpstashRedisClient(): Redis {
  const globalKey = Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__');
  let client: Redis | undefined = (global as any)[globalKey];

  if (!client) {
    const upstashUrl = process.env.UPSTASH_URL;
    const upstashToken = process.env.UPSTASH_TOKEN;

    if (!upstashUrl || !upstashToken) {
      throw new Error(
        'UPSTASH_URL and UPSTASH_TOKEN env variables must be set'
      );
    }

    // 创建 Upstash Redis 客户端
    client = new Redis({
      url: upstashUrl,
      token: upstashToken,
      // 可选配置
      retry: {
        retries: 3,
        backoff: (retryCount: number) =>
          Math.min(1000 * Math.pow(2, retryCount), 30000),
      },
    });

    console.log('Upstash Redis client created successfully');

    (global as any)[globalKey] = client;
  }

  return client;
}
