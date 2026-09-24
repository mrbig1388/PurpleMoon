/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { checkCsrf } from '@/lib/csrf-guard';
import { db } from '@/lib/db';

export const runtime = 'edge';

// ==========================================
// 🛡️ 结构防线 (Zod Schema)：防注入、垃圾数据与纯空格
// ==========================================
const postSchema = z.object({
  content: z
    .string({ required_error: '内容不能为空' })
    .trim() // 先去除首尾空格，防止纯空格绕过校验
    .min(1, '内容不能为空')
    .max(500, '内容超长，最多允许 500 个字符'), // 与存储层严格一致
});

const deleteSchema = z.object({
  // 兼容 ID 是字符串或数字的情况，限制长度防溢出
  id: z.union(
    [
      z.string().min(1, '缺少ID').max(100, 'ID 长度异常'),
      z.number(),
    ],
    { required_error: '缺少ID' }
  ),
});

// ==========================================
// 🛡️ 物理防线：限制请求体体积，防止内存溢出 (OOM)
// ==========================================
async function parseSafeBody(request: NextRequest, maxSizeKB: number) {
  const text = await request.text();

  // 1. 体积拦截
  if (text.length > maxSizeKB * 1024) {
    throw new Error('Payload Too Large');
  }

  // 2. 空块拦截
  if (!text.trim()) {
    throw new Error('Empty Body');
  }

  // 3. JSON 解析（此时体积已经绝对安全）
  return JSON.parse(text);
}

// ------------------------------------------
// 接口实现
// ------------------------------------------

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    // 传入当前登录用户名，供底层计算 is_owner 标识
    const memos = await (db as any).storage.getMemos(authInfo.username);
    return NextResponse.json({ memos });
  } catch (error) {
    console.error('获取便签失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  // 🛡️ 安全修复 (P1 · L-04)：CSRF 纵深防御
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response!;

  try {
    // 1. 物理防御：限制请求体最大 50KB
    const rawBody = await parseSafeBody(request, 50);

    // 2. 结构防御：Zod 类型强校验（含 trim）
    const parsed = postSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { content } = parsed.data;

    // 3. 调用底层（内部包含 60s 内限流 3 条及存储引擎防刷）
    await (db as any).storage.addMemo(authInfo.username, content);
    return NextResponse.json({ success: true });

  } catch (error: any) {
    if (error.message === 'Payload Too Large') {
      return NextResponse.json({ error: '请求体过大，超出服务器限制' }, { status: 413 });
    }

    console.error('添加便签失败:', error);

    // 识别是否触发频控（根据错误信息判断），按规范返回 429 状态码
    const isRateLimited = error.message?.includes('频繁') || error.status === 429;
    const statusCode = isRateLimited ? 429 : 400;

    return NextResponse.json(
      { error: error.message || '添加失败，或请求格式错误' },
      { status: statusCode }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  // 🛡️ 安全修复 (P1 · L-04)：CSRF 纵深防御
  const csrf = checkCsrf(request);
  if (!csrf.ok) return csrf.response!;

  try {
    // 物理防御：仅包含 ID 的请求，限制请求体最大 10KB
    const rawBody = await parseSafeBody(request, 10);

    // 结构防御：Zod 类型强校验
    const parsed = deleteSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { id } = parsed.data;
    const memoId = Number(id);

    if (isNaN(memoId)) {
      return NextResponse.json({ error: '无效的便签 ID 格式' }, { status: 400 });
    }

    // 🛡️ 逻辑修复 (P3 · L-03)：只有作者本人可以在存储层成功匹配并删除自己的便签；
    // 根据返回值区分"确实删除了一条"与"未找到匹配记录"，不再对后者也返回虚假成功。
    const deleted = await (db as any).storage.deleteMemo(authInfo.username, memoId);
    if (!deleted) {
      return NextResponse.json(
        { error: '未找到该便签，或你无权删除它' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });

  } catch (error: any) {
    if (error.message === 'Payload Too Large') {
      return NextResponse.json({ error: '请求体过大，超出服务器限制' }, { status: 413 });
    }

    console.error('删除便签失败:', error);
    return NextResponse.json(
      { error: error.message || '删除失败，或请求格式错误' },
      { status: 400 }
    );
  }
}
