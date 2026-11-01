/** 分组 id（稳定标识，不随重命名变化）。旧版本固定分组的 id 为 'A' / 'B' */
export type UserGroup = string;

/** 一个用户分组：可自由命名，并自由选择可访问的资源站 */
export interface UserGroupDef {
  id: string;
  name: string;
  /** true：可访问全部已启用资源站（含以后新增的）；false：仅限 sourceKeys */
  allSources: boolean;
  sourceKeys: string[];
}

/** 单个邀请码配置项 */
export interface InviteCodeItem {
  /** 邀请码字符串（唯一） */
  code: string;
  /** 使用该邀请码注册后自动归入的分组 id（如 'A'、'B' 或自定义分组 id） */
  groupId: UserGroup;
  /** 最大可使用次数（默认 10 次） */
  maxUses: number;
  /** 已使用次数 */
  usedCount: number;
  /** 创建时间戳（毫秒） */
  createdAt?: number;
  /** 过期时间戳（毫秒）；缺省、null 或 0 表示永不过期 */
  expiresAt?: number | null;
  /** 备注说明（选填） */
  note?: string;
}

/** Cloudflare Turnstile 人机验证配置（仅站长可查看与管理） */
export interface TurnstileConfig {
  /** 是否启用 Cloudflare Turnstile 人机验证总开关 */
  Enabled: boolean;
  /** 登录环境是否需要人机验证 */
  EnableLogin: boolean;
  /** 注册环境是否需要人机验证 */
  EnableRegister: boolean;
  /** Cloudflare Turnstile Site Key（前端公钥） */
  SiteKey: string;
  /** Cloudflare Turnstile Secret Key（服务端密钥） */
  SecretKey: string;
}

export interface AdminConfig {
  configVersion?: number;
  SiteConfig: {
    SiteName: string;
    Announcement: string;
    SearchDownstreamMaxPage: number;
    SiteInterfaceCacheTime: number;
    ImageProxy: string;
  };
  UserConfig: {
    AllowRegister: boolean;
    Users: {
      username: string;
      role: 'user' | 'admin' | 'owner';
      banned?: boolean;
      /** 所属分组 id。缺省 / 分组未启用时不受限制（兼容升级前的老用户）；站长不受分组限制 */
      group?: UserGroup;
      /** 管理员改密码或封禁时写入时间戳；签发时间早于该值的旧会话立即作废 */
      sessionsValidAfter?: number;
    }[];
  };
  /**
   * 分组配置。未配置（undefined）表示站长尚未启用分组：所有用户可访问全部已启用资源站。
   * 旧版（固定 A/B 两组）的格式为 DefaultRegisterGroup + GroupBSourceKeys，读取时自动迁移。
   */
  GroupConfig?: {
    Groups?: UserGroupDef[];
    /** 新注册 / 后台新增用户的默认分组 id */
    DefaultRegisterGroupId?: string;
    /** @deprecated 旧格式，仅用于迁移 */
    DefaultRegisterGroup?: 'A' | 'B';
    /** @deprecated 旧格式，仅用于迁移 */
    GroupBSourceKeys?: string[];
  };
  /**
   * 邀请码注册配置（仅站长可查看与管理）。
   * - RequireInviteCode：是否强制要求邀请码才可注册
   * - Codes：后台创建的邀请码列表（支持绑定分组、限制可用次数默认 10 次、设置过期时间）
   */
  InviteConfig?: {
    RequireInviteCode: boolean;
    Codes: InviteCodeItem[];
  };
  /**
   * Cloudflare Turnstile 人机验证配置（仅站长可查看与管理）。
   */
  TurnstileConfig?: TurnstileConfig;
  SourceConfig: {
    key: string;
    name: string;
    api: string;
    detail?: string;
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}
