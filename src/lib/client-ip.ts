// 🛡️ 安全修复 (P2 · L-05)：统一、可配置的客户端 IP 识别逻辑。
//
// 此前登录/注册接口在拿不到 cf-connecting-ip 时会直接信任客户端可自由
// 构造的 x-forwarded-for 头。如果部署环境是"裸跑 Docker、前面没有会清洗
// 该请求头的反向代理"（不经过 Cloudflare，也没有正确配置 Nginx
// proxy_set_header），攻击者可以每次请求换一个 X-Forwarded-For 值，
// 把自己伪装成"来自不同 IP 的正常用户"，从而绕过基于 IP 的登录/注册限流，
// 对邀请码、密码等进行暴力枚举。
//
// 修复策略：
// 1) cf-connecting-ip 由 Cloudflare 边缘写入，客户端无法伪造，始终优先信任；
// 2) x-forwarded-for 默认不再信任，除非运维显式设置
//    TRUST_X_FORWARDED_FOR=true（用于"自建反向代理已正确清洗该头"的部署场景）；
// 3) 两者都拿不到时归入 'unknown_ip' 桶，且调用方应对该桶使用更严格的限流阈值，
//    而不是让每个不可信来源都各自获得一份独立的限流配额。

export function getClientIp(request: {
  headers: { get(name: string): string | null };
}): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && cfIp.length < 50) {
    return cfIp.trim();
  }

  const trustXff = process.env.TRUST_X_FORWARDED_FOR === 'true';
  if (trustXff) {
    const xff = request.headers.get('x-forwarded-for');
    if (xff) {
      // 仅取链条中的第一个（最接近客户端的一跳），并做长度截断防注入
      const first = xff.split(',')[0].trim();
      if (first && first.length < 50) {
        return first;
      }
    }
  }

  return 'unknown_ip';
}
