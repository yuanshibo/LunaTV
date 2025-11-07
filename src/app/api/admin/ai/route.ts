import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(req);
    const config = await getConfig();
    const user = config.UserConfig.Users.find(
      (u) => u.username === authInfo?.username
    );
    if (user?.role !== 'owner' && user?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { host, model } = await req.json();
    config.AiConfig = { host, model };
    await db.saveAdminConfig(config);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save AI config' },
      { status: 500 }
    );
  }
}
