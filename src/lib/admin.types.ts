export interface AdminConfig {
  // 🛡️ 逻辑修复 (P2 · L-02)：配置对象的乐观并发版本号。
  // 每次 setAdminConfig 成功写入都会自增。管理端接口在写入时会带上
  // 读取时看到的版本号，仅当存储层当前版本与之一致才允许写入，
  // 否则视为发生了并发冲突，拒绝本次写入（而不是静默覆盖对方的修改）。
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
    }[];
  };
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
