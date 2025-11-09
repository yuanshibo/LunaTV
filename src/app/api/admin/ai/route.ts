// src/app/api/admin/ai/route.ts
import { NextResponse } from 'next/server';

import { DbManager } from '@/lib/db';
import { getAuthInfo } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const authInfo = await getAuthInfo();
    if (!authInfo.role || (authInfo.role !== 'owner' && authInfo.role !== 'admin')) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    const { ollama_host, ollama_model } = await req.json();
    const db = new DbManager();
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
