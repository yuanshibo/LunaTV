import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  callOllama,
  getTasteProfile,
  AVAILABLE_SEARCH_FILTERS,
  fetchAndProcessCandidates,
  SearchCriterion,
} from '@/lib/discover_sort';
import { db } from '@/lib/db'; // Import db to get watch history
import { directSearch } from '@/lib/search';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';

const OLLAMA_HOST_DEFAULT = 'http://localhost:11434';

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { query } = await request.json();
  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  }

  // --- Step 1: Direct Search ---
  console.log(`Unified search for "${query}" from ${user.username}. Starting with direct search.`);
  const directSearchResults = await directSearch(query, user.username);

  if (directSearchResults.length > 0) {
    console.log(`Direct search found ${directSearchResults.length} results for "${query}". Returning immediately.`);
    return NextResponse.json({ results: directSearchResults });
  }

  // --- Step 2: AI Fallback ---
  console.log(`Direct search found no results for "${query}". Falling back to AI assistant.`);
  const config = await getConfig();
  if (!config.SiteConfig.ollama_host) {
    console.log('Ollama host not configured, skipping AI assistant.');
    // Return the standard empty result format
    return NextResponse.json({ results: [] });
  }

  try {
    const tasteProfile = await getTasteProfile(user.username);
    if (!tasteProfile) {
        console.log(`No taste profile for ${user.username}. AI assistant might have limited context.`);
    }

    const prompt = `
      You are an expert AI assistant for a media streaming app. Your sole task is to generate a precise set of Douban search criteria based on a user's taste profile and their current query.

      **User's Long-term Taste Profile:**
      ${JSON.stringify(tasteProfile, null, 2)}

      **User's Current Query:**
      "${query}"

      **Instructions:**
      1.  **Analyze and Synthesize:** Interpret the user's query in the context of their taste profile.
      2.  **Generate Search Criteria:** Based on your synthesis, create a list of 1-2 diverse Douban search criteria combinations.
          - You MUST use the available search parameters provided below.
          - Do not invent new categories or values.
      3.  **Format Output:** Return a single JSON object with a single key: "searchCriteria". This key should contain an array of criteria objects. Do not include any other keys or conversational text.

      **Available Search Parameters:**
      - "kind": "movie" or "tv".
      - "category" (for movie): [${AVAILABLE_SEARCH_FILTERS.movie.category.join(', ')}]
      - "category" (for tv): [${AVAILABLE_SEARCH_FILTERS.tv.category.join(', ')}]
      - "label": (optional) "高分", "经典", "冷门".

      **Example Output:**
      {
        "searchCriteria": [
          { "kind": "movie", "category": "科幻", "label": "经典" },
          { "kind": "movie", "category": "悬疑" }
        ]
      }
    `;

    const aiResponse = await callOllama(
      config.SiteConfig.ollama_host || OLLAMA_HOST_DEFAULT,
      config.SiteConfig.ollama_model || 'llama3',
      prompt,
      true
    );

    // We only need searchCriteria from the AI now
    const { searchCriteria } = aiResponse as { searchCriteria: SearchCriterion[] };

    if (!searchCriteria || !Array.isArray(searchCriteria)) {
      throw new Error('Invalid response format from AI assistant: missing searchCriteria.');
    }

    // Get user's watch history to filter out content they've already seen.
    const allPlayRecords = await db.getAllPlayRecords(user.username);
    const watchedTitlesAndYears = new Set(
      Object.values(allPlayRecords).map(record => `${record.title}-${record.year}`)
    );

    // Use the unified core function to fetch, process, and sort candidates.
    const finalResult = await fetchAndProcessCandidates(searchCriteria, watchedTitlesAndYears);

    console.log(`AI search fallback for "${query}" found ${finalResult.length} results.`);
    // Return in the unified format
    return NextResponse.json({
      results: finalResult,
    });

  } catch (error) {
    console.error(`Error in /api/ai/assistant fallback for user ${user.username}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
