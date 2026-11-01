import { AdminConfig, TurnstileConfig } from '@/lib/admin.types';
import { UNKNOWN_IP } from '@/lib/client-ip';

export interface PublicTurnstileState {
  enabled: boolean;
  enableLogin: boolean;
  enableRegister: boolean;
  siteKey: string;
}

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_VERIFY_TIMEOUT_MS = 6000;

/**
 * 解析完整的服务端 Turnstile 配置（含环境变量兜底）
 */
export function resolveTurnstileConfig(
  config?: AdminConfig | null
): TurnstileConfig {
  const raw = config?.TurnstileConfig;
  const envSiteKey = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '').trim();
  const envSecretKey = (process.env.TURNSTILE_SECRET_KEY || '').trim();

  if (!raw) {
    return {
      Enabled: false,
      EnableLogin: true,
      EnableRegister: true,
      SiteKey: envSiteKey,
      SecretKey: envSecretKey,
    };
  }

  return {
    Enabled: Boolean(raw.Enabled),
    EnableLogin:
      typeof raw.EnableLogin === 'boolean' ? raw.EnableLogin : true,
    EnableRegister:
      typeof raw.EnableRegister === 'boolean' ? raw.EnableRegister : true,
    SiteKey: typeof raw.SiteKey === 'string' ? raw.SiteKey.trim() : envSiteKey,
    SecretKey:
      typeof raw.SecretKey === 'string' ? raw.SecretKey.trim() : envSecretKey,
  };
}

/**
 * 生成可安全下发给前端的公开 Turnstile 状态（严禁包含 SecretKey）
 */
export function getPublicTurnstileConfig(
  config?: AdminConfig | null
): PublicTurnstileState {
  const resolved = resolveTurnstileConfig(config);
  const ready =
    resolved.Enabled &&
    resolved.SiteKey.length > 0 &&
    resolved.SecretKey.length > 0;

  return {
    enabled: ready,
    enableLogin: ready && resolved.EnableLogin,
    enableRegister: ready && resolved.EnableRegister,
    siteKey: ready ? resolved.SiteKey : '',
  };
}

/**
 * 判断指定环境（login / register）当前是否强制要求通过 Turnstile 人机验证
 */
export function isTurnstileRequiredForScene(
  config: AdminConfig | null | undefined,
  scene: 'login' | 'register'
): boolean {
  const pub = getPublicTurnstileConfig(config);
  if (!pub.enabled) return false;
  return scene === 'login' ? pub.enableLogin : pub.enableRegister;
}

/**
 * 向 Cloudflare Turnstile siteverify 接口验证前端提交的 token
 */
export async function verifyTurnstileToken(options: {
  token?: unknown;
  secretKey: string;
  remoteIp?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { token, secretKey, remoteIp } = options;

  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, error: '请先完成 Cloudflare Turnstile 人机验证' };
  }
  const cleanToken = token.trim();
  if (cleanToken.length > 4096) {
    return { ok: false, error: '人机验证凭证格式无效' };
  }
  if (!secretKey || !secretKey.trim()) {
    return { ok: false, error: '服务端未配置 Turnstile Secret Key' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    TURNSTILE_VERIFY_TIMEOUT_MS
  );

  try {
    const formData = new URLSearchParams();
    formData.set('secret', secretKey.trim());
    formData.set('response', cleanToken);
    if (remoteIp && remoteIp !== UNKNOWN_IP) {
      formData.set('remoteip', remoteIp);
    }

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        ok: false,
        error: '人机验证服务响应异常，请稍后重试',
      };
    }

    const data = (await res.json()) as {
      success?: boolean;
      'error-codes'?: string[];
    };

    if (data && data.success === true) {
      return { ok: true };
    }

    return {
      ok: false,
      error: '人机验证未通过或已过期，请重新验证',
    };
  } catch {
    return {
      ok: false,
      error: '人机验证请求超时或网络异常，请稍后重试',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
