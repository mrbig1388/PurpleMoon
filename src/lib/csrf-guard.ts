/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

// 🛡️ 安全修复 (P1 · L-04)：
// 此前只有 admin/user、admin/source、admin/site、admin/reset 这几个管理端
// 接口做了 Origin + Content-Type 的纵深防御式 CSRF 校验，favorites /
// playrecords / memos / skipconfig / searchhistory 等用户级写接口完全没有，
// 仅依赖 auth Cookie 的 SameSite=Lax 属性兜底。现将这套校验抽成公共函数，
// 统一应用到所有状态变更（POST/PUT/DELETE）接口上，不再按"是否 admin 接口"
// 区别对待。

export interface CsrfCheckResult {
  ok: boolean;
  response?: NextResponse;
}

/**
 * 对写操作请求做 CSRF 纵深防御校验：
 * 1) Origin 头存在时必须与当前 host 一致；
 * 2) 默认要求 Content-Type 为 application/json（跨站 <form> 无法伪造该头，
 *    会强制触发浏览器 CORS 预检，从而被同源策略拦下）。
 *
 * 部分 DELETE 接口按设计走 query string、不带请求体（前端调用时也不会设置
 * Content-Type），对这类接口传入 { requireJsonContentType: false }，
 * 仅做 Origin 校验，避免误伤正常请求。
 *
 * 用法：
 *   const csrf = checkCsrf(request);
 *   if (!csrf.ok) return csrf.response!;
 */
export function checkCsrf(
  request: NextRequest,
  options: { requireJsonContentType?: boolean } = {}
): CsrfCheckResult {
  const { requireJsonContentType = true } = options;
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  if (origin) {
    try {
      if (new URL(origin).host !== host) {
        console.warn(`[CSRF 拦截] 接口 ${request.nextUrl.pathname} 遇到异常的 Origin: ${origin}`);
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'Forbidden: Invalid Origin' },
            { status: 403 }
          ),
        };
      }
    } catch {
      // Origin 头格式非法，视为可疑请求一并拦截
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Forbidden: Invalid Origin' },
          { status: 403 }
        ),
      };
    }
  }

  if (requireJsonContentType) {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Unsupported Media Type: must be application/json' },
          { status: 415 }
        ),
      };
    }
  }

  return { ok: true };
}
