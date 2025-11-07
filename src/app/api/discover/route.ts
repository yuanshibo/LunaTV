
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { discoverSort } from '@/lib/discover_sort';
import { DoubanItem } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const adminConfig = await db.getAdminConfig();
    if (!adminConfig?.AiConfig?.host) {
      // AI 未配置，直接返回空
      return NextResponse.json({ list: [], total: 0 });
    }

    let user = getAuthInfoFromCookie(request);
    if (!user?.username) {
      const defaultUsername = process.env.USERNAME || 'test';
      user = { username: defaultUsername };
    }

    const { searchParams } = new URL(request.url);
    const start = parseInt(searchParams.get('start') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);

    const cacheKey = `discover_sort_user_${user.username}`;
    let cachedList = await db.getGlobalCache<DoubanItem[]>(cacheKey);

    // 如果没有缓存，则触发一次排序并缓存结果
    if (!cachedList) {
      console.log(
        `[API] No discover cache for ${user.username}, triggering sort...`
      );
      const sortedList = await discoverSort.sort(user.username);
      if (sortedList.length > 0) {
        // 缓存24小时
        await db.setGlobalCache(cacheKey, sortedList, 60 * 60 * 24);
      }
      cachedList = sortedList;
    }

    const paginatedList = (cachedList || []).slice(start, start + limit);

    return NextResponse.json({
      list: paginatedList,
      total: cachedList?.length || 0,
    });
  } catch (error) {
    console.error('Failed to fetch discover content:', error);
    return NextResponse.json(
      { error: 'Failed to fetch discover content' },
      { status: 500 }
    );
  }
}
