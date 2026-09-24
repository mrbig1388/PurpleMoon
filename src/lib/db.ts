/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import { D1Storage } from './d1.db';
import { RedisStorage } from './redis.db';
import { Favorite, IStorage, Memo,PlayRecord } from './types'; // 【修复】：增加了 Memo 的导入
import { UpstashRedisStorage } from './upstash.db';

// 【新增】：跳过片头片尾的类型定义
export interface SkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

// storage type 常量: 'localstorage' | 'redis' | 'd1' | 'upstash'，默认 'localstorage'
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'd1'
    | 'upstash'
    | undefined) || 'localstorage';

// 创建存储实例
function createStorage(): IStorage {
  switch (STORAGE_TYPE) {
    case 'redis':
      return new RedisStorage();
    case 'upstash':
      return new UpstashRedisStorage();
    case 'd1':
      return new D1Storage();
    case 'localstorage':
    default:
      // 默认返回内存实现，保证本地开发可用
      return null as unknown as IStorage;
  }
}

// 单例存储实例
let storageInstance: IStorage | null = null;

export function getStorage(): IStorage {
  if (!storageInstance) {
    storageInstance = createStorage();
  }
  return storageInstance;
}

// 工具函数：生成存储key
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// 导出便捷方法
export class DbManager {
  private storage: IStorage;

  constructor() {
    this.storage = getStorage();
  }

  // 播放记录相关方法
  async getPlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<PlayRecord | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setPlayRecord(userName, key, record);
  }

  async getAllPlayRecords(userName: string): Promise<{
    [key: string]: PlayRecord;
  }> {
    return this.storage.getAllPlayRecords(userName);
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deletePlayRecord(userName, key);
  }

  // 收藏相关方法
  async getFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<Favorite | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFavorite(userName, key);
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFavorite(userName, key, favorite);
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    return this.storage.getAllFavorites(userName);
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFavorite(userName, key);
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string
  ): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  // ---------- 用户相关 ----------
  async registerUser(userName: string, password: string): Promise<void> {
    await this.storage.registerUser(userName, password);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    return this.storage.verifyUser(userName, password);
  }

  // 检查用户是否已存在
  async checkUserExist(userName: string): Promise<boolean> {
    return this.storage.checkUserExist(userName);
  }

  // 修改密码与删除用户
  async changePassword(userName: string, newPassword: string): Promise<void> {
    if (this.storage && typeof this.storage.changePassword === 'function') {
      await this.storage.changePassword(userName, newPassword);
    }
  }

  async deleteUser(userName: string): Promise<void> {
    if (this.storage && typeof this.storage.deleteUser === 'function') {
      await this.storage.deleteUser(userName);
    }
  }

  // ---------- 搜索历史 ----------
  async getSearchHistory(userName: string): Promise<string[]> {
    return this.storage.getSearchHistory(userName);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.storage.addSearchHistory(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.storage.deleteSearchHistory(userName, keyword);
  }

  // 获取全部用户名
  async getAllUsers(): Promise<string[]> {
    if (typeof (this.storage as any).getAllUsers === 'function') {
      return (this.storage as any).getAllUsers();
    }
    return [];
  }

  // ---------- 管理员配置 ----------
  async getAdminConfig(): Promise<AdminConfig | null> {
    if (typeof (this.storage as any).getAdminConfig === 'function') {
      return (this.storage as any).getAdminConfig();
    }
    return null;
  }

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    if (typeof (this.storage as any).setAdminConfig === 'function') {
      await (this.storage as any).setAdminConfig(config);
    }
  }

  // =========================================================================
  // 【新增核心】：跳过片头片尾配置 (单剧集记忆)
  // 使用安全降级策略：底层如果还没写对应方法，也不会引发服务崩溃
  // =========================================================================
  
  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const key = generateStorageKey(source, id);
    if (this.storage && typeof (this.storage as any).getSkipConfig === 'function') {
      return (this.storage as any).getSkipConfig(userName, key);
    }
    return null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    if (this.storage && typeof (this.storage as any).setSkipConfig === 'function') {
      await (this.storage as any).setSkipConfig(userName, key, config);
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    if (this.storage && typeof (this.storage as any).getAllSkipConfigs === 'function') {
      return (this.storage as any).getAllSkipConfigs(userName);
    }
    return {};
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    if (this.storage && typeof (this.storage as any).deleteSkipConfig === 'function') {
      await (this.storage as any).deleteSkipConfig(userName, key);
    }
  }

  // =========================================================================
  // 【新增核心】：便利贴功能 (Memos)
  // =========================================================================
  
  async getMemos(userName: string): Promise<Memo[]> {
    if (this.storage && typeof (this.storage as any).getMemos === 'function') {
      return (this.storage as any).getMemos(userName);
    }
    return [];
  }

  async addMemo(userName: string, content: string): Promise<void> {
    if (this.storage && typeof (this.storage as any).addMemo === 'function') {
      await (this.storage as any).addMemo(userName, content);
    }
  }

  async deleteMemo(userName: string, memoId: number): Promise<boolean> {
    if (this.storage && typeof (this.storage as any).deleteMemo === 'function') {
      return await (this.storage as any).deleteMemo(userName, memoId);
    }
    return false;
  }

  // =========================================================================
  // 【新增核心】：向下透传全局分布式限流功能
  // =========================================================================
  
  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    if (this.storage && typeof (this.storage as any).checkRateLimit === 'function') {
      return await (this.storage as any).checkRateLimit(key, limit, windowMs);
    }
    // 如果没有配置外部存储（比如 localstorage 模式），默认返回 true (此时会退回到内存 Map 限流)
    return true; 
  }
}

// 导出默认实例
export const db = new DbManager();
