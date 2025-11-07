import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { DoubanItem } from '@/lib/types';
import { getLoggedInUser } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getLoggedInUser();
    if (!user) {
      return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const start = parseInt(searchParams.get('start') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);

    const cachedList = await db.getGlobalCache<DoubanItem[]>(
      `discover:${user.username}`
    );

    if (!cachedList) {
      return NextResponse.json({ error: 'No cached list found' }, { status: 404 });
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
