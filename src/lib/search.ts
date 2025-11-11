/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export async function directSearch(query: string, username: string) {
  const config = await getConfig();
  const apiSites = await getAvailableApiSites(username);

  const searchPromises = apiSites.map((site) =>
    Promise.race([
      searchFromApi(site, query),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
      ),
    ]).catch((err) => {
      console.warn(`Search failed for ${site.name}:`, err.message);
      return [];
    })
  );

  const searchResults = await Promise.all(searchPromises);
  let flattenedResults = searchResults.flat();

  if (!config.SiteConfig.DisableYellowFilter) {
    flattenedResults = flattenedResults.filter((result: any) => {
      const typeName = result.type_name || '';
      return !yellowWords.some((word: string) => typeName.includes(word));
    });
  }

  return flattenedResults;
}
