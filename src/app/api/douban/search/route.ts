import { NextRequest, NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { DoubanItem, DoubanResult } from '@/lib/types';

interface DoubanSuggestItem {
  id: string;
  title: string;
  original_title?: string;
  sub_title?: string;
  year?: string;
  type?: string;
  subtype?: string;
  cover?: string;
  poster?: string;
  img?: string;
}

const ALLOWED_TYPES = new Set(['movie', 'tv', 'show']);

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get('q') || '';
  const query = rawQuery.trim();

  if (!query) {
    return NextResponse.json(
      { error: '缺少必要参数: q' },
      { status: 400 }
    );
  }

  const target = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`;

  try {
    const doubanData = await fetchDoubanData<DoubanSuggestItem[]>(target);
    const list: DoubanItem[] = Array.isArray(doubanData)
      ? doubanData
        .filter((item) => {
          const type = (item.type || item.subtype || '').toLowerCase();
          return ALLOWED_TYPES.has(type);
        })
        .map((item) => {
          const rawType = (item.type || item.subtype || '').toLowerCase();
          const normalizedType = rawType === 'tv' || rawType === 'show' ? 'tv' : 'movie';
          return {
            id: item.id?.toString() || '',
            title: item.title || item.original_title || '',
            poster: item.img || item.cover || item.poster || '',
            rate: '',
            year: item.year || item.sub_title?.match(/(\d{4})/)?.[1] || '',
            type: normalizedType,
          } as DoubanItem;
        })
        .filter((item) => item.id && item.title)
      : [];

    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list,
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取豆瓣数据失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
