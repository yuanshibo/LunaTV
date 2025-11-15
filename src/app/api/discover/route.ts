import { NextRequest, NextResponse } from 'next/server';

import { getUserFromRequest } from '@/lib/auth';
import { discoverSort } from '@/lib/discover_sort';

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);

    const allRecommendations = await discoverSort(user);
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const results = allRecommendations.slice(startIndex, endIndex);
    const hasMore = endIndex < allRecommendations.length;

    console.log(`Returning ${results.length} recommendations for user ${user.username} from /api/discover (page ${page}, limit ${limit})`);

    return NextResponse.json({
      results,
      hasMore,
    });
  } catch (error) {
    console.error(`Error in /api/discover for user ${user.username}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
