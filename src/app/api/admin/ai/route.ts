import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getAuthInfo } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { role } = await getAuthInfo();
    if (role !== 'owner' && role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { host, model } = await req.json();
    const config = await getConfig();
    config.AiConfig = { host, model };
    await db.saveAdminConfig(config);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save AI config:', error);
    return NextResponse.json(
      { error: 'Failed to save AI config' },
      { status: 500 }
    );
  }
}
