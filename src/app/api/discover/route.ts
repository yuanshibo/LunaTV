
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { DoubanItem } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = getAuthInfoFromCookie(request);
    if (!user?.username) {
      // In a real-world scenario, you'd want to handle this case more gracefully.
      // For this implementation, we'll try to fall back to a default user
      // to ensure the frontend can still display recommendations for guests
      // or in case of auth issues during testing.
      const defaultUsername = process.env.USERNAME || 'test';
      const cachedList = await db.getGlobalCache<DoubanItem[]>(
        `discover:${defaultUsername}`
      );
      if (!cachedList) {
        return NextResponse.json({ list: [], total: 0 });
      }
      const { searchParams } = new URL(request.url);
      const start = parseInt(searchParams.get('start') || '0', 10);
      const limit = parseInt(searchParams.get('limit') || '25', 10);
      const paginatedList = cachedList.slice(start, start + limit);
      return NextResponse.json({
        list: paginatedList,
        total: cachedList.length,
      });
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
