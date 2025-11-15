/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

/**
 * Performs a direct search across all available API sites.
 * @param query The search query string.
 * @param username The username of the user performing the search.
 * @returns A promise that resolves to an array of search results.
 */
export async function directSearch(query: string, username: string): Promise<SearchResult[]> {
  const config = await getConfig();
  const apiSites = await getAvailableApiSites(username);

  const searchPromises = apiSites.map((site) =>
    Promise.race([
      searchFromApi(site, query),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
      ),
    ]).catch((err) => {
      console.warn(`搜索失败 ${site.name}:`, err.message);
      return []; // Return an empty array on error or timeout
    })
  );

  try {
    const results = await Promise.all(searchPromises);
    let flattenedResults = (results as SearchResult[][]).flat();

    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }

    return flattenedResults;
  } catch (error) {
    console.error('An unexpected error occurred during direct search:', error);
    return [];
  }
}
