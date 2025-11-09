// src/app/api/admin/ai/route.ts
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || !authInfo.role || (authInfo.role !== 'owner' && authInfo.role !== 'admin')) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    const { ollama_host, ollama_model } = await req.json();
    await db.setAIConfig({
      ollama_host: ollama_host || '',
      ollama_model: ollama_model || '',
    });

    return NextResponse.json({ message: 'AI配置保存成功' });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
