/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { checkCsrf } from '@/lib/csrf-guard';
import { db } from '@/lib/db';

export const runtime = 'edge';

// 最大保存条数
const HISTORY_LIMIT = 20;

// ==========================================
// 🛡️ 结构防线 (Zod Schema)
// ==========================================
const searchHistorySchema = z.object({
  // 严格限制关键字长度为 1~100 字符，防止存入巨大的垃圾数据
  keyword: z.string().trim().min(1, '关键字不能为空').max(100, '关键字长度不能超过100字符'),
});

// ==========================================
// 🛡️ 物理防线：限制请求体体积
// ==========================================
async function parseSafeBody(request: NextRequest, maxSizeKB: number) {
  const text = await request.text();
  if (text.length > maxSizeKB * 1024) throw new Error('Payload Too Large');
  if (!text.trim()) throw new Error('Empty Body');
  return JSON.parse(text);
}

// ------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const history = await db.getSearchHistory(authInfo.username);
    return NextResponse.json(history, { status: 200 });
  } catch (err) {
    console.error('获取搜索历史失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // 🛡️ 安全修复 (P1 · L-04)：CSRF 纵深防御
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response!;

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 物理防御：搜索关键字的请求体极小，限制为 10KB
    const rawBody = await parseSafeBody(request, 10);

    // 结构防御：Zod 强校验
    const parsed = searchHistorySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { keyword } = parsed.data;

    await db.addSearchHistory(authInfo.username, keyword);

    const history = await db.getSearchHistory(authInfo.username);
    return NextResponse.json(history.slice(0, HISTORY_LIMIT), { status: 200 });
  } catch (err: any) {
    if (err.message === 'Payload Too Large') {
      return NextResponse.json({ error: '请求体过大' }, { status: 413 });
    }
    console.error('添加搜索历史失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  // 🛡️ 安全修复 (P1 · L-04)：该接口走 query string、无请求体
  const csrf = checkCsrf(request, { requireJsonContentType: false });
  if (!csrf.ok) return csrf.response!;

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const kw = searchParams.get('keyword')?.trim();

    // 如果带有 kw，也可选用正则拦截，但这里仅是下发至 KV 删除键值，通常相对安全
    await db.deleteSearchHistory(authInfo.username, kw || undefined);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除搜索历史失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
