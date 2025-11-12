
/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
import { getAuthInfo } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { db, getAndFilterPlayRecords, getTasteProfile, saveTasteProfile } from '@/lib/db';
import { searchFromApi } from '@/lib/downstream';
import { getAiSortedRecommendations } from '@/lib/discover_sort';
import { generateTasteProfile } from '@/lib/taste_profile';
import { yellowWords } from '@/lib/yellow';
import { SearchResult } from '@/lib/types';

/**
 * Performs a direct keyword search across all available API sites and streams the results.
 * It sends batches of results as they become available from each source.
 *
 * @param query - The search query string.
 * @param username - The username of the user performing the search.
 * @returns An async generator that yields arrays of search results.
 */
export async function* directSearch(query: string, username: string): AsyncGenerator<SearchResult[]> {
  const config = await getConfig();
  const apiSites = await getAvailableApiSites(username);

  const searchPromises = apiSites.map(async (site) => {
    try {
      const results = await Promise.race([
        searchFromApi(site, query),
        new Promise<any[]>((_, reject) =>
          setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
        ),
      ]);

      if (!config.SiteConfig.DisableYellowFilter) {
        return results.filter((result: any) => {
          const typeName = result.type_name || '';
          return !yellowWords.some((word: string) => typeName.includes(word));
        });
      }
      return results;
    } catch (err: any) {
      console.warn(`Search failed for ${site.name}:`, err.message);
      return []; // Return empty array on error
    }
  });

  // As each promise settles, yield its results immediately.
  for (const promise of searchPromises) {
    const batch = await promise;
    if (batch.length > 0) {
      yield batch;
    }
  }
}


/**
 * Gets AI-powered recommendations based on a user's query and taste profile.
 *
 * @param query - The user's search query.
 * @param username - The username of the user.
 * @returns A promise that resolves to an array of search results.
 */
export async function getAiRecommendations(query: string, username: string): Promise<SearchResult[]> {
  console.log(`Getting AI recommendations for query: "${query}"`);

  const authInfo = await getAuthInfo(username);
  if (!authInfo) {
    console.error('getAiRecommendations: Authentication failed.');
    return [];
  }

  try {
    // 1. Get user's taste profile (or generate if it doesn't exist)
    let tasteProfile = await getTasteProfile(username);
    if (!tasteProfile) {
      console.log(`No taste profile for ${username}, generating...`);
      const playRecords = await getAndFilterPlayRecords(authInfo.username, authInfo.token);
      const searchHistory = await db.getSearchHistory(username);
      // Pass both histories to generate a more accurate profile
      tasteProfile = await generateTasteProfile(playRecords, searchHistory);
      await saveTasteProfile(username, tasteProfile);
      console.log(`New taste profile for ${username} generated and saved.`);
    }

    // 2. Get AI-sorted recommendations using the discover logic
    // We pass the query as an override to the taste profile for this specific search
    const recommendations = await getAiSortedRecommendations(
      username,
      tasteProfile,
      1, // page 1
      50 // limit to 50 results for the AI fallback
    );

    return recommendations.results;

  } catch (error) {
    console.error('Error getting AI recommendations:', error);
    return [];
  }
}
