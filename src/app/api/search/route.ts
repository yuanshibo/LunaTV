/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

import { directSearch } from '@/lib/search';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const cacheTime = await getCacheTime();

  if (!query) {
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  }

  try {
    let results = await directSearch(query, authInfo.username);

    // If no results, fallback to AI Assistant
    if (results.length === 0) {
      console.log('No direct results, falling back to AI Assistant for non-streamed search.');
      try {
        const aiResponse = await fetch('http://localhost:3000/api/ai/assistant', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': request.headers.get('cookie') || '',
          },
          body: JSON.stringify({ query }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          if (aiData.results && aiData.results.length > 0) {
            results = aiData.results;
            // You might want to include aiData.responseText in the final response as well.
            // For now, we'll just return the results to maintain consistency.
          }
        }
      } catch (aiError) {
        console.error('AI assistant fallback failed for non-streamed search:', aiError);
      }
    }

    if (results.length === 0) {
      return NextResponse.json({ results: [] }, { status: 200 });
    }

    return NextResponse.json(
      { results },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    console.error(`Error in /api/search:`, error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
