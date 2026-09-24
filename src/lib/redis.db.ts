/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { createClient, RedisClientType } from 'redis';

import { AdminConfig } from './admin.types';
import { ConfigConflictError } from './config-errors';
import { hashPassword, verifyPassword } from './password';
import { Favorite, IStorage, Memo,PlayRecord, SkipConfig } from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 便利贴全站最大条数限制
const MEMO_LIMIT = 30;

/**
 * 防御性 JSON 解析，防止脏数据导致进程崩溃
 */
function safeJsonParse<T>(val: string | null): T | null {
  if (!val) return null;
  try {
    return JSON.parse(val) as T;
  } catch (err) {
    console.error('Failed to parse JSON from Redis:', err);
    return null;
  }
}

export class RedisStorage implements IStorage {
  private client: RedisClientType;

  constructor() {
    this.client = getRedisClient();
  }

  // ---------- 播放记录 ----------
  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`; // u:username:pr:source+id
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await this.client.get(this.prKey(userName, key));
    return safeJsonParse<PlayRecord>(val);
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await this.client.set(this.prKey(userName, key), JSON.stringify(record));
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const pattern = `u:${userName}:pr:*`;
    const keys: string[] = await this.client.keys(pattern);
    if (keys.length === 0) return {};

    const result: Record<string, PlayRecord> = {};
    for (const fullKey of keys) {
      const value = await this.client.get(fullKey);
      const parsed = safeJsonParse<PlayRecord>(value);
      if (parsed) {
        const keyPart = fullKey.replace(`u:${userName}:pr:`, '');
        result[keyPart] = parsed;
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.client.del(this.prKey(userName, key));
  }

  // ---------- 收藏 ----------
  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await this.client.get(this.favKey(userName, key));
    return safeJsonParse<Favorite>(val);
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await this.client.set(this.favKey(userName, key), JSON.stringify(favorite));
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const pattern = `u:${userName}:fav:*`;
    const keys: string[] = await this.client.keys(pattern);
    if (keys.length === 0) return {};

    const result: Record<string, Favorite> = {};
    for (const fullKey of keys) {
      const value = await this.client.get(fullKey);
      const parsed = safeJsonParse<Favorite>(value);
      if (parsed) {
        const keyPart = fullKey.replace(`u:${userName}:fav:`, '');
        result[keyPart] = parsed;
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.client.del(this.favKey(userName, key));
  }

  // ---------- 用户注册 / 登录 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const hashedPassword = await hashPassword(password);
    await this.client.set(this.userPwdKey(userName), hashedPassword);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await this.client.get(this.userPwdKey(userName));
    if (stored === null) return false;
    return await verifyPassword(password, stored);
  }

  async checkUserExist(userName: string): Promise<boolean> {
    const exists = await this.client.exists(this.userPwdKey(userName));
    return exists === 1;
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    const hashedPassword = await hashPassword(newPassword);
    await this.client.set(this.userPwdKey(userName), hashedPassword);
  }

  async deleteUser(userName: string): Promise<void> {
    await this.client.del(this.userPwdKey(userName));
    await this.client.del(this.shKey(userName));
    await this.client.del(`memo:rate:${userName}`);

    const playRecordKeys = await this.client.keys(`u:${userName}:pr:*`);
    if (playRecordKeys.length > 0) {
      await this.client.del(playRecordKeys);
    }

    const favoriteKeys = await this.client.keys(`u:${userName}:fav:*`);
    if (favoriteKeys.length > 0) {
      await this.client.del(favoriteKeys);
    }

    const skipKeys = await this.client.keys(`u:${userName}:skip:*`);
    if (skipKeys.length > 0) {
      await this.client.del(skipKeys);
    }

    // 清理全员共享便利贴中该用户发布的所有记录
    const rawList = await this.client.lRange(this.memosKey(), 0, -1);
    if (rawList && rawList.length > 0) {
      for (const itemStr of rawList) {
        const memo = safeJsonParse<Memo>(itemStr);
        if (memo && memo.username === userName) {
          await this.client.lRem(this.memosKey(), 0, itemStr);
        }
      }
    }
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`;
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    return await this.client.lRange(this.shKey(userName), 0, -1);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    await this.client.lRem(key, 0, keyword);
    await this.client.lPush(key, keyword);
    await this.client.lTrim(key, 0, SEARCH_HISTORY_LIMIT - 1);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await this.client.lRem(key, 0, keyword);
    } else {
      await this.client.del(key);
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    const keys = await this.client.keys('u:*:pwd');
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
    const val = await this.client.get(this.adminConfigKey());
    return safeJsonParse<AdminConfig>(val);
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    // 🛡️ 逻辑修复 (P2 · L-02)：乐观并发控制。
    // 用 WATCH/MULTI/EXEC 实现"比对版本号 + 写入"的原子事务：
    // WATCH 期间若该 key 被其他连接修改过，EXEC 会返回 null，
    // 借此判断是否发生了并发写冲突。
    const key = this.adminConfigKey();
    const expectedVersion = config.configVersion ?? 0;
    const newVersion = expectedVersion + 1;
    const newConfig = { ...config, configVersion: newVersion };

    await this.client.watch(key);
    try {
      const raw = await this.client.get(key);
      const current = safeJsonParse<AdminConfig>(raw);
      const currentVersion = current?.configVersion ?? 0;

      if (currentVersion !== expectedVersion) {
        await this.client.unwatch();
        throw new ConfigConflictError();
      }

      const execResult = await this.client
        .multi()
        .set(key, JSON.stringify(newConfig))
        .exec();

      if (execResult === null) {
        // WATCH 探测到 key 在此期间被其他请求修改，事务被打断
        throw new ConfigConflictError();
      }

      config.configVersion = newVersion;
    } catch (err) {
      // 确保异常路径下也不遗留 WATCH 状态
      try {
        await this.client.unwatch();
      } catch {
        // 忽略 unwatch 本身的错误，不掩盖原始异常
      }
      throw err;
    }
  }

  // =========================================================================
  // 跳过片头片尾配置 (SkipConfig)
  // =========================================================================

  private skipKey(user: string, key: string) {
    return `u:${user}:skip:${key}`;
  }

  async getSkipConfig(userName: string, key: string): Promise<SkipConfig | null> {
    const val = await this.client.get(this.skipKey(userName, key));
    return safeJsonParse<SkipConfig>(val);
  }

  async setSkipConfig(
    userName: string,
    key: string,
    config: SkipConfig
  ): Promise<void> {
    await this.client.set(this.skipKey(userName, key), JSON.stringify(config));
  }

  async getAllSkipConfigs(userName: string): Promise<Record<string, SkipConfig>> {
    const pattern = `u:${userName}:skip:*`;
    const keys: string[] = await this.client.keys(pattern);
    if (keys.length === 0) return {};

    const result: Record<string, SkipConfig> = {};
    for (const fullKey of keys) {
      const value = await this.client.get(fullKey);
      const parsed = safeJsonParse<SkipConfig>(value);
      if (parsed) {
        const keyPart = fullKey.replace(`u:${userName}:skip:`, '');
        result[keyPart] = parsed;
      }
    }
    return result;
  }

  async deleteSkipConfig(userName: string, key: string): Promise<void> {
    await this.client.del(this.skipKey(userName, key));
  }

  // =========================================================================
  // 全员共享便利贴 (Memos)
  // =========================================================================

  private memosKey() {
    return 'global:memos';
  }

  async getMemos(userName?: string): Promise<Memo[]> {
    const rawList = await this.client.lRange(this.memosKey(), 0, -1);
    if (!rawList || rawList.length === 0) return [];

    // 使用 flatMap 替代 map+filter，彻底避免 TypeScript 推导出的 (Memo | null)[] 类型报错
    return rawList.flatMap((itemStr) => {
      const memo = safeJsonParse<Memo>(itemStr);
      if (!memo) return [];
      return [
        {
          ...memo,
          is_owner: Boolean(userName && memo.username === userName),
        },
      ];
    });
  }

  async addMemo(userName: string, content: string): Promise<void> {
    const trimmed = content?.trim();
    if (!trimmed || trimmed.length === 0) {
      throw new Error('便利贴内容不能为空');
    }
    if (trimmed.length > 500) {
      throw new Error('便利贴内容不能超过 500 个字符');
    }

    // 限流校验：基于 ZSET 滑动窗口（60 秒内最多 3 条）
    const isAllowed = await this.checkRateLimit(`memo:rate:${userName}`, 2, 600000);
    if (!isAllowed) {
      throw new Error('发布过于频繁，10分钟内最多只能发布 2 条便利贴。');
    }

    const memoData = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      username: userName,
      content: trimmed,
      created_at: Date.now(),
    };
    const jsonStr = JSON.stringify(memoData);

    await this.client.lPush(this.memosKey(), jsonStr);
    await this.client.lTrim(this.memosKey(), 0, MEMO_LIMIT - 1);
  }

  async deleteMemo(userName: string, memoId: number): Promise<boolean> {
    const rawList = await this.client.lRange(this.memosKey(), 0, -1);
    if (!rawList || rawList.length === 0) return false;

    for (const itemStr of rawList) {
      const memo = safeJsonParse<Memo>(itemStr);
      if (memo && memo.id === memoId && memo.username === userName) {
        await this.client.lRem(this.memosKey(), 1, itemStr);
        return true;
      }
    }
    return false;
  }

  // =========================================================================
  // 全局分布式限流 (Rate Limiter) - 基于 Redis ZSET 滑动窗口 (Lua 原子脚本)
  // =========================================================================
  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const clearBefore = now - windowMs;
    const memberId = `${now}:${Math.random().toString(36).substring(2, 7)}`;

    // 使用 Lua 脚本确保清理过期元素、计算当前数量、新增记录及刷新 PEXPIRE 的原子性
    const luaScript = `
      local key = KEYS[1]
      local clearBefore = tonumber(ARGV[1])
      local limit = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      local memberId = ARGV[4]
      local windowMs = tonumber(ARGV[5])

      -- 1. 移除时间窗口外的过期记录
      redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)

      -- 2. 统计当前窗口内的请求数
      local currentCount = redis.call('ZCARD', key)

      -- 3. 判断是否超出限制
      if currentCount < limit then
          redis.call('ZADD', key, now, memberId)
          redis.call('PEXPIRE', key, windowMs)
          return 1
      else
          return 0
      end
    `;

    const result = await this.client.eval(luaScript, {
      keys: [key],
      arguments: [
        clearBefore.toString(),
        limit.toString(),
        now.toString(),
        memberId,
        windowMs.toString(),
      ],
    });

    return Number(result) === 1;
  }
}

// 单例标准 Redis 客户端
function getRedisClient(): RedisClientType {
  const globalKey = Symbol.for('__MOONTV_REDIS_CLIENT__');
  let client: RedisClientType | undefined = (global as any)[globalKey];

  if (!client) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    client = createClient({
      url: redisUrl,
    });

    client.on('error', (err) => console.error('Redis Client Error', err));

    // 尝试异步建立连接，并在失败时进行错误捕捉
    client.connect().then(() => {
      console.log('Local Redis client connected successfully');
    }).catch(err => {
      console.error('Failed to connect to local Redis:', err);
    });

    (global as any)[globalKey] = client;
  }

  return client;
}
