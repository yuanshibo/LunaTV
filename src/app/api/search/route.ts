/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { searchFromApi } from '@/lib/downstream';
import { DoubanItem } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { douban: [], results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  }

  const config = await getConfig();
  const doubanResults = await searchDoubanSuggestions(query, config.SiteConfig).catch((error) => {
    console.warn('豆瓣搜索失败:', (error as Error).message);
    return [] as DoubanItem[];
  });

  if (doubanResults.length > 0) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { douban: doubanResults, results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  }

  const apiSites = await getAvailableApiSites(authInfo.username);

  // 添加超时控制和错误处理，避免慢接口拖累整体响应
  const searchPromises = apiSites.map((site) =>
    Promise.race([
      searchFromApi(site, query),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
      ),
    ]).catch((err) => {
      console.warn(`搜索失败 ${site.name}:`, err.message);
      return []; // 返回空数组而不是抛出错误
    })
  );

  try {
    const results = await Promise.allSettled(searchPromises);
    const successResults = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => (result as PromiseFulfilledResult<any>).value);
    let flattenedResults = successResults.flat();
    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }
    const cacheTime = await getCacheTime();

    if (flattenedResults.length === 0) {
      // no cache if empty
      return NextResponse.json({ douban: [], results: [] }, { status: 200 });
    }

    return NextResponse.json(
      { douban: [], results: flattenedResults },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}

const DOUBAN_ALLOWED_TYPES = new Set(['movie', 'tv', 'show']);

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

async function searchDoubanSuggestions(
  query: string,
  siteConfig: AdminConfig['SiteConfig']
): Promise<DoubanItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const requestUrl = buildDoubanSuggestUrl(trimmed, siteConfig);
  const doubanData = await fetchDoubanData<DoubanSuggestItem[]>(requestUrl);

  if (!Array.isArray(doubanData)) return [];

  return doubanData
    .filter((item) => {
      const type = (item.type || item.subtype || '').toLowerCase();
      return DOUBAN_ALLOWED_TYPES.has(type);
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
    .filter((item) => item.id && item.title);
}

function buildDoubanSuggestUrl(
  query: string,
  siteConfig: AdminConfig['SiteConfig']
): string {
  const proxyType = (siteConfig?.DoubanProxyType || 'direct').toLowerCase();
  const customProxy = (siteConfig?.DoubanProxy || '').trim();

  const baseUrl =
    proxyType === 'cmliussss-cdn-tencent'
      ? 'https://movie.douban.cmliussss.net/j/subject_suggest'
      : proxyType === 'cmliussss-cdn-ali'
        ? 'https://movie.douban.cmliussss.com/j/subject_suggest'
        : 'https://movie.douban.com/j/subject_suggest';

  const target = `${baseUrl}?q=${encodeURIComponent(query)}`;

  switch (proxyType) {
    case 'cors-anywhere':
      return `https://cors-anywhere.com/${target}`;
    case 'cors-proxy-zwei':
      return `https://ciao-cors.is-an.org/${encodeURIComponent(target)}`;
    case 'custom':
      if (!customProxy) {
        return target;
      }
      if (customProxy === 'https://cors-anywhere.com/' || customProxy.endsWith('cors-anywhere.com/')) {
        return `${customProxy}${target}`;
      }
      return `${customProxy}${encodeURIComponent(target)}`;
    default:
      return target;
  }
}
