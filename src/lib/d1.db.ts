/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import { ConfigConflictError } from './config-errors';
import { hashPassword, verifyPassword } from './password'; // 修补密码明文时序攻击 (Timing Attack)
import { Favorite, IStorage, Memo,PlayRecord, SkipConfig } from './types'; // 引入 Memo 类型

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 【新增安全机制】：全站共享便利贴最大条数限制，防止恶意刷库占用空间
const MEMO_LIMIT = 30;

// D1 数据库接口
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<D1ExecResult>;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = any>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = any>(): Promise<D1Result<T>>;
}

interface D1Result<T = any> {
  results: T[];
  success: boolean;
  error?: string;
  meta: {
    changed_db: boolean;
    changes: number;
    last_row_id: number;
    duration: number;
  };
}

interface D1ExecResult {
  count: number;
  duration: number;
}

// 获取全局D1数据库实例
function getD1Database(): D1Database {
  return (process.env as any).DB as D1Database;
}

export class D1Storage implements IStorage {
  private db: D1Database | null = null;

  private async getDatabase(): Promise<D1Database> {
    if (!this.db) {
      this.db = getD1Database();
    }
    return this.db;
  }

  // 播放记录相关
  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        title: result.title,
        source_name: result.source_name,
        cover: result.cover,
        year: result.year,
        index: result.index_episode,
        total_episodes: result.total_episodes,
        play_time: result.play_time,
        total_time: result.total_time,
        save_time: result.save_time,
        search_title: result.search_title || undefined,
      };
    } catch (err) {
      console.error('Failed to get play record:', err);
      throw err;
    }
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO play_records 
          (username, key, title, source_name, cover, year, index_episode, total_episodes, play_time, total_time, save_time, search_title)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          record.title,
          record.source_name,
          record.cover,
          record.year,
          record.index,
          record.total_episodes,
          record.play_time,
          record.total_time,
          record.save_time,
          record.search_title || null
        )
        .run();
    } catch (err) {
      console.error('Failed to set play record:', err);
      throw err;
    }
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM play_records WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const records: Record<string, PlayRecord> = {};

      result.results.forEach((row: any) => {
        records[row.key] = {
          title: row.title,
          source_name: row.source_name,
          cover: row.cover,
          year: row.year,
          index: row.index_episode,
          total_episodes: row.total_episodes,
          play_time: row.play_time,
          total_time: row.total_time,
          save_time: row.save_time,
          search_title: row.search_title || undefined,
        };
      });

      return records;
    } catch (err) {
      console.error('Failed to get all play records:', err);
      throw err;
    }
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete play record:', err);
      throw err;
    }
  }

  // 收藏相关
  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        title: result.title,
        source_name: result.source_name,
        cover: result.cover,
        year: result.year,
        total_episodes: result.total_episodes,
        save_time: result.save_time,
        search_title: result.search_title,
      };
    } catch (err) {
      console.error('Failed to get favorite:', err);
      throw err;
    }
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO favorites 
          (username, key, title, source_name, cover, year, total_episodes, save_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          favorite.title,
          favorite.source_name,
          favorite.cover,
          favorite.year,
          favorite.total_episodes,
          favorite.save_time
        )
        .run();
    } catch (err) {
      console.error('Failed to set favorite:', err);
      throw err;
    }
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM favorites WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const favorites: Record<string, Favorite> = {};

      result.results.forEach((row: any) => {
        favorites[row.key] = {
          title: row.title,
          source_name: row.source_name,
          cover: row.cover,
          year: row.year,
          total_episodes: row.total_episodes,
          save_time: row.save_time,
          search_title: row.search_title,
        };
      });

      return favorites;
    } catch (err) {
      console.error('Failed to get all favorites:', err);
      throw err;
    }
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete favorite:', err);
      throw err;
    }
  }

  // =========================================================================
  // 【安全升级】：用户密码哈希化存储与防时序攻击验证
  // =========================================================================

  async registerUser(userName: string, password: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const hashedPassword = await hashPassword(password); // 加盐哈希处理
      await db
        .prepare('INSERT INTO users (username, password) VALUES (?, ?)')
        .bind(userName, hashedPassword)
        .run();
    } catch (err) {
      console.error('Failed to register user:', err);
      throw err;
    }
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT password FROM users WHERE username = ?')
        .bind(userName)
        .first<{ password: string }>();

      if (!result) return false;
      // 启用防时序攻击比对（自动向下兼容旧版明文密码）
      return await verifyPassword(password, result.password);
    } catch (err) {
      console.error('Failed to verify user:', err);
      throw err;
    }
  }

  async checkUserExist(userName: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT 1 FROM users WHERE username = ?')
        .bind(userName)
        .first();

      return result !== null;
    } catch (err) {
      console.error('Failed to check user existence:', err);
      throw err;
    }
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const hashedPassword = await hashPassword(newPassword); // 加盐哈希处理
      await db
        .prepare('UPDATE users SET password = ? WHERE username = ?')
        .bind(hashedPassword, userName)
        .run();
    } catch (err) {
      console.error('Failed to change password:', err);
      throw err;
    }
  }

  async deleteUser(userName: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const statements = [
        db.prepare('DELETE FROM users WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM play_records WHERE username = ?')
          .bind(userName),
        db.prepare('DELETE FROM favorites WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName),
        // 同步级联删除跳过配置
        db
          .prepare('DELETE FROM skip_configs WHERE username = ?')
          .bind(userName),
        // 同步级联删除用户的便利贴记录
        db
          .prepare('DELETE FROM user_memos WHERE username = ?')
          .bind(userName),
      ];

      await db.batch(statements);
    } catch (err: any) {
      console.error('Failed to delete user:', err);
      // 如果 skip_configs 或 user_memos 尚不存在，忽略该异常避免删号失败
      if (err.message && err.message.includes('no such table')) {
        console.warn('忽略缺少附加表引起的删号警告。');
        return;
      }
      throw err;
    }
  }

  // 搜索历史相关
  async getSearchHistory(userName: string): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT keyword FROM search_history WHERE username = ? ORDER BY created_at DESC LIMIT ?'
        )
        .bind(userName, SEARCH_HISTORY_LIMIT)
        .all<{ keyword: string }>();

      return result.results.map((row) => row.keyword);
    } catch (err) {
      console.error('Failed to get search history:', err);
      throw err;
    }
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      // 先删除可能存在的重复记录
      await db
        .prepare(
          'DELETE FROM search_history WHERE username = ? AND keyword = ?'
        )
        .bind(userName, keyword)
        .run();

      // 添加新记录
      await db
        .prepare('INSERT INTO search_history (username, keyword) VALUES (?, ?)')
        .bind(userName, keyword)
        .run();

      // 保持历史记录条数限制
      await db
        .prepare(
          `
          DELETE FROM search_history 
          WHERE username = ? AND id NOT IN (
            SELECT id FROM search_history 
            WHERE username = ? 
            ORDER BY created_at DESC 
            LIMIT ?
          )
        `
        )
        .bind(userName, userName, SEARCH_HISTORY_LIMIT)
        .run();
    } catch (err) {
      console.error('Failed to add search history:', err);
      throw err;
    }
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      if (keyword) {
        await db
          .prepare(
            'DELETE FROM search_history WHERE username = ? AND keyword = ?'
          )
          .bind(userName, keyword)
          .run();
      } else {
        await db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName)
          .run();
      }
    } catch (err) {
      console.error('Failed to delete search history:', err);
      throw err;
    }
  }

  // 用户列表
  async getAllUsers(): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT username FROM users ORDER BY created_at ASC')
        .all<{ username: string }>();

      return result.results.map((row) => row.username);
    } catch (err) {
      console.error('Failed to get all users:', err);
      throw err;
    }
  }

  // 管理员配置相关
  async getAdminConfig(): Promise<AdminConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT config FROM admin_config WHERE id = 1')
        .first<{ config: string }>();

      if (!result) return null;

      return JSON.parse(result.config) as AdminConfig;
    } catch (err) {
      console.error('Failed to get admin config:', err);
      throw err;
    }
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    try {
      const db = await this.getDatabase();
      // 🛡️ 逻辑修复 (P2 · L-02)：乐观并发控制。
      // expectedVersion 是调用方读取配置时看到的版本号；仅当数据库中
      // 当前版本与之一致时才允许写入，并将版本号原子自增。
      // 用 SQLite 的 json_extract 在 WHERE 子句里做版本比对，
      // 整个"比对 + 写入"是单条 UPDATE 语句，天然具备原子性，
      // 不需要额外加锁或事务。
      const expectedVersion = config.configVersion ?? 0;
      const newVersion = expectedVersion + 1;
      const newConfig = { ...config, configVersion: newVersion };
      const serialized = JSON.stringify(newConfig);

      const updateResult = await db
        .prepare(
          `UPDATE admin_config
           SET config = ?
           WHERE id = 1
             AND COALESCE(json_extract(config, '$.configVersion'), 0) = ?`
        )
        .bind(serialized, expectedVersion)
        .run();

      if ((updateResult?.meta?.changes ?? 0) > 0) {
        config.configVersion = newVersion;
        return;
      }

      // UPDATE 影响 0 行：要么记录尚不存在（首次写入），要么版本不匹配（并发冲突）
      const existing = await db
        .prepare('SELECT 1 FROM admin_config WHERE id = 1')
        .first();

      if (!existing) {
        await db
          .prepare('INSERT INTO admin_config (id, config) VALUES (1, ?)')
          .bind(serialized)
          .run();
        config.configVersion = newVersion;
        return;
      }

      throw new ConfigConflictError();
    } catch (err) {
      if (err instanceof ConfigConflictError) {
        throw err;
      }
      console.error('Failed to set admin config:', err);
      throw err;
    }
  }

  // =========================================================================
  // 【核心补全】：跳过片头片尾配置持久化支持
  // =========================================================================

  async getSkipConfig(
    userName: string,
    key: string
  ): Promise<SkipConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM skip_configs WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        enable: Boolean(result.enable),
        intro_time: Number(result.intro_time) || 0,
        outro_time: Number(result.outro_time) || 0,
      };
    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        console.warn('D1 数据库缺少 skip_configs 表，请先在云端执行建表 SQL。当前已自动降级。');
        return null;
      }
      console.error('Failed to get skip config:', err);
      throw err;
    }
  }

  async setSkipConfig(
    userName: string,
    key: string,
    config: SkipConfig
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO skip_configs 
          (username, key, enable, intro_time, outro_time)
          VALUES (?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          config.enable ? 1 : 0,
          config.intro_time,
          config.outro_time
        )
        .run();
    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        console.warn('D1 数据库缺少 skip_configs 表，保存失败。');
        return;
      }
      console.error('Failed to set skip config:', err);
      throw err;
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<Record<string, SkipConfig>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM skip_configs WHERE username = ?')
        .bind(userName)
        .all<any>();

      const configs: Record<string, SkipConfig> = {};

      result.results.forEach((row: any) => {
        configs[row.key] = {
          enable: Boolean(row.enable),
          intro_time: Number(row.intro_time) || 0,
          outro_time: Number(row.outro_time) || 0,
        };
      });

      return configs;
    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        return {};
      }
      console.error('Failed to get all skip configs:', err);
      throw err;
    }
  }

  async deleteSkipConfig(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM skip_configs WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        return;
      }
      console.error('Failed to delete skip config:', err);
      throw err;
    }
  }

  // =========================================================================
  // 便利贴 (Memos) 数据层实现（调整为全员共享模式）
  // =========================================================================

  async getMemos(currentUserName?: string): Promise<Memo[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT id, username, content, created_at FROM user_memos ORDER BY created_at DESC LIMIT ?')
        .bind(MEMO_LIMIT)
        .all<any>();

      return (result.results || []).map((row: any) => ({
        id: row.id,
        user_id: row.username,
        username: row.username,
        content: row.content,
        created_at: row.created_at,
        is_owner: Boolean(currentUserName && row.username === currentUserName),
      }));
    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        console.warn('D1 数据库缺少 user_memos 表，自动降级返回空列表。');
        return [];
      }
      console.error('Failed to get memos:', err);
      throw err;
    }
  }

  async addMemo(userName: string, content: string): Promise<void> {
    // 1. 【防刷限流校验】：单用户 60 秒 (60000 毫秒) 内最多发布 3 条便利贴
    const isAllowed = await this.checkRateLimit(`memo:${userName}`, 2, 600000);
    if (!isAllowed) {
      throw new Error('发布过于频繁，10 分钟内最多只能发布 2 条留言。');
    }

    try {
      const db = await this.getDatabase();

      // 2. 插入新的便利贴，保存发布者 username
      await db
        .prepare('INSERT INTO user_memos (username, content, created_at) VALUES (?, ?, ?)')
        .bind(userName, content, Date.now())
        .run();

      // 3. 【全站容量限制】：超出 30 条时清理最老的数据
      await db
        .prepare(
          `
          DELETE FROM user_memos 
          WHERE id NOT IN (
            SELECT id FROM user_memos 
            ORDER BY created_at DESC 
            LIMIT ?
          )
        `
        )
        .bind(MEMO_LIMIT)
        .run();

    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        console.warn('D1 数据库缺少 user_memos 表，添加失败。');
        return;
      }
      console.error('Failed to add memo:', err);
      throw err;
    }
  }

  async deleteMemo(userName: string, memoId: number): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      // 鉴权校验：仅允许作者删除自己的便利贴
      const result = await db
        .prepare('DELETE FROM user_memos WHERE id = ? AND username = ?')
        .bind(memoId, userName)
        .run();
      // 🛡️ 逻辑修复 (P3 · L-03)：D1 的 run() 结果包含 meta.changes，
      // 即实际被删除的行数；据此判断本次调用是否真的命中了一条记录。
      return (result?.meta?.changes ?? 0) > 0;
    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        return false;
      }
      console.error('Failed to delete memo:', err);
      throw err;
    }
  }

  // =========================================================================
  // 【全局分布式限流 (Rate Limiter)】
  // =========================================================================
  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const now = Date.now();

      let result: any;
      try {
        result = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first();
      } catch (e: any) {
        // 如果表不存在，则懒加载建表
        if (e.message && e.message.includes('no such table')) {
          await db.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER, reset_at INTEGER)').run();
          result = null;
        } else {
          throw e;
        }
      }

      if (!result || now > result.reset_at) {
        // 记录已过期或不存在，重置计数为 1 并更新重置时间
        await db.prepare('INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)').bind(key, now + windowMs).run();
        return 1 <= limit;
      } else {
        // 仍在时间窗口内，累加计数
        const newCount = result.count + 1;
        await db.prepare('UPDATE rate_limits SET count = ? WHERE key = ?').bind(newCount, key).run();
        return newCount <= limit;
      }
    } catch (err: any) {
      console.error('Failed to check rate limit in D1:', err);
      return true; // 发生数据库异常时兜底放行，防止阻塞正常的合法请求
    }
  }
}
