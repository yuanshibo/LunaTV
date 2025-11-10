import { NextRequest, NextResponse } from 'next/server';

import { getUserFromRequest } from '@/lib/auth';
import { discoverSort } from '@/lib/discover_sort';

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await discoverSort(user);
    console.log(`Returning ${results.length} recommendations for user ${user.username} from /api/discover`);
    return NextResponse.json(results);
  } catch (error) {
    console.error(`Error in /api/discover for user ${user.username}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
