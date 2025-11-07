import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { DoubanItem } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = getAuthInfoFromCookie(request);
    if (!user?.username) {
      return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const start = parseInt(searchParams.get('start') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);

    const cachedList = await db.getGlobalCache<DoubanItem[]>(
      `discover:${user.username}`
    );

    if (!cachedList) {
      return NextResponse.json(
        { error: 'No cached list found' },
        { status: 404 }
      );
    }

    const paginatedList = cachedList.slice(start, start + limit);

    return NextResponse.json({
      list: paginatedList,
      total: cachedList.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch discover content' },
      { status: 500 }
    );
  }
}
