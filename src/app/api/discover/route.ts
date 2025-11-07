
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { DoubanItem } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const adminConfig = await db.getAdminConfig();
    if (!adminConfig?.AiConfig?.host) {
      return NextResponse.json({ list: [], total: 0 });
    }

    let user = getAuthInfoFromCookie(request);
    if (!user?.username) {
      const defaultUsername = process.env.USERNAME || 'test';
      user = { username: defaultUsername, is_admin: false };
    }

    const { searchParams } = new URL(request.url);
    const start = parseInt(searchParams.get('start') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);

    const cachedList = await db.getGlobalCache<DoubanItem[]>(
      `discover:${user.username}`
    );

    if (!cachedList) {
      return NextResponse.json({ list: [], total: 0 });
    }

    const paginatedList = cachedList.slice(start, start + limit);

    return NextResponse.json({
      list: paginatedList,
      total: cachedList.length,
    });
  } catch (error) {
    console.error('Failed to fetch discover content:', error);
    return NextResponse.json(
      { error: 'Failed to fetch discover content' },
      { status: 500 }
    );
  }
}
