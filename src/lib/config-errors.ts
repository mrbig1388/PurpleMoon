// 🛡️ 逻辑修复 (P2 · L-02)：并发写入冲突异常。
//
// 管理端配置(用户/资源站/站点设置等)此前是"整体读出→内存中修改→整体写回"，
// 没有原子性保证：两个管理员几乎同时发起不同的变更时，后写入的一方会
// 直接覆盖掉先写入的一方，改动被悄悄丢弃且没有任何报错。
// 现通过 AdminConfig.configVersion 字段做乐观并发控制：写入时存储层会校验
// 当前版本是否与调用方读取时看到的版本一致，不一致则抛出本异常，
// 由上层（config.ts 的 withConfigConflictRetry）决定重试或报错，
// 而不是无条件覆盖。
//
// 独立成单独文件是为了避免循环依赖：config.ts 依赖 db.ts，
// db.ts 依赖各存储后端(d1.db.ts/redis.db.ts/upstash.db.ts)，
// 如果这些存储后端反过来又依赖 config.ts 就会形成循环引用。
export class ConfigConflictError extends Error {
  constructor(message = '配置已被其他管理员修改，请重试') {
    super(message);
    this.name = 'ConfigConflictError';
  }
}
