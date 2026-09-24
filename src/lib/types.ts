import { AdminConfig } from './admin.types';

// 跳过片头片尾配置类型
export interface SkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

// 便利贴数据结构（全员共享模式）
export interface Memo {
  id: number;
  user_id?: string;     // 发布者用户名/ID
  username?: string;    // 发布者显示名称（可与 user_id 相同或作为昵称）
  content: string;      // Memo 内容
  created_at: number;   // 创建时间戳
  is_owner?: boolean;   // 当前浏览用户是否为作者（前端鉴权显示删除按钮）
}

// 播放记录数据结构
export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  index: number; // 第几集
  total_episodes: number; // 总集数
  play_time: number; // 播放进度（秒）
  total_time: number; // 总进度（秒）
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
}

// 收藏数据结构
export interface Favorite {
  source_name: string;
  total_episodes: number; // 总集数
  title: string;
  year: string;
  cover: string;
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
}

// 存储接口（所有存储引擎都已完全对齐实现）
export interface IStorage {
  // 播放记录相关
  getPlayRecord(userName: string, key: string): Promise<PlayRecord | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void>;
  getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }>;
  deletePlayRecord(userName: string, key: string): Promise<void>;

  // 收藏相关
  getFavorite(userName: string, key: string): Promise<Favorite | null>;
  setFavorite(userName: string, key: string, favorite: Favorite): Promise<void>;
  getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }>;
  deleteFavorite(userName: string, key: string): Promise<void>;

  // 用户相关
  registerUser(userName: string, password: string): Promise<void>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  // 检查用户是否存在（无需密码）
  checkUserExist(userName: string): Promise<boolean>;
  // 修改用户密码
  changePassword(userName: string, newPassword: string): Promise<void>;
  // 删除用户（包括密码、搜索历史、播放记录、收藏夹、跳过配置、便利贴）
  deleteUser(userName: string): Promise<void>;

  // 搜索历史相关
  getSearchHistory(userName: string): Promise<string[]>;
  addSearchHistory(userName: string, keyword: string): Promise<void>;
  deleteSearchHistory(userName: string, keyword?: string): Promise<void>;

  // 用户列表
  getAllUsers(): Promise<string[]>;

  // 管理员配置相关
  getAdminConfig(): Promise<AdminConfig | null>;
  setAdminConfig(config: AdminConfig): Promise<void>;

  // ==========================================
  // 以下是正式回归接口的全局扩展能力
  // ==========================================

  // 跳过片头片尾配置相关
  getSkipConfig(userName: string, key: string): Promise<SkipConfig | null>;
  setSkipConfig(userName: string, key: string, config: SkipConfig): Promise<void>;
  getAllSkipConfigs(userName: string): Promise<Record<string, SkipConfig>>;
  deleteSkipConfig(userName: string, key: string): Promise<void>;

  // 便利贴相关（已改为全员共享，查询时不强制锁定用户）
  getMemos(currentUserName?: string): Promise<Memo[]>;
  addMemo(userName: string, content: string): Promise<void>;
  // 🛡️ 逻辑修复 (P3 · L-03)：返回值由 void 改为 boolean，
  // true 表示确实命中并删除了一条属于该用户的记录，false 表示未找到
  // （不存在该 ID，或该 ID 不属于当前用户）。调用方据此区分
  // "真删除成功" 与 "无操作但仍返回成功" 两种情况。
  deleteMemo(userName: string, memoId: number): Promise<boolean>;

  // 【新增】：全局分布式限流机制 (用于登录/注册防刷)
  checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean>;
}

// 搜索结果数据结构
export interface SearchResult {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
}

// --- 日历相关 ---
export type ReleaseCalendarItem = {
  id: string;
  title: string;
  type: 'movie' | 'tv' | string;
  region: string;
  genre: string;
  releaseDate: string; // 格式: YYYY-MM-DD
  director: string;
  actors: string;
  poster?: string;
  episodes?: number | string;
};

export type ReleaseCalendarResult = {
  items: ReleaseCalendarItem[];
  total: number;
  hasMore: boolean;
  filters: {
    types: { label: string; value: string; count: number }[];
    regions: { label: string; value: string; count: number }[];
    genres: { label: string; value: string; count: number }[];
  };
};
