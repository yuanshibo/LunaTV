import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { callOllama, getTasteProfile, AVAILABLE_SEARCH_FILTERS } from '@/lib/discover_sort';
import { getDoubanRecommends } from '@/lib/douban.server';
import { directSearch } from '@/lib/search'; // 导入 directSearch
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
      You are a helpful and friendly AI assistant for a media streaming app.
      A user has a long-term "Taste Profile" and has just made a specific query.
      Your task is to synthesize this information to provide a helpful, conversational response and a precise set of search criteria.

      **User's Long-term Taste Profile:**
      ${JSON.stringify(tasteProfile, null, 2)}

      **User's Current Query:**
      "${query}"

      **Instructions:**
      1.  **Analyze and Synthesize:** Interpret the user's query in the context of their taste profile.
      2.  **Generate Conversational Response:** Create a short, friendly, and natural text response (in Chinese) that acknowledges their request and explains what you're recommending.
      3.  **Generate Search Criteria:** Based on your synthesis, create a list of 1-2 diverse Douban search criteria combinations.
          - You MUST use the available search parameters provided below.
          - Do not invent new categories or values.
      4.  **Format Output:** Return a single JSON object with two keys: "responseText" and "searchCriteria". "searchCriteria" should be an array of objects.

      **Available Search Parameters:**
      - "kind": "movie" or "tv".
      - "category" (for movie): [${AVAILABLE_SEARCH_FILTERS.movie.category.join(', ')}]
      - "category" (for tv): [${AVAILABLE_SEARCH_FILTERS.tv.category.join(', ')}]
      - "label": (optional) "高分", "经典", "冷门".

      **Example Output:**
      {
        "responseText": "当然！如果您喜欢赛博朋克和深度思考，这几部电影可能会是您的菜：",
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
    const { searchCriteria } = aiResponse;

    if (!searchCriteria || !Array.isArray(searchCriteria)) {
      throw new Error('Invalid response format from AI assistant: missing searchCriteria.');
    }

    const candidatePromises = searchCriteria.map(async (criteria: { kind: 'tv' | 'movie'; category: string; label: string }) => {
      try {
        const result = await getDoubanRecommends(criteria);
        return result.list;
      } catch (error) {
        console.error(`AI Assistant: Error fetching for criteria ${JSON.stringify(criteria)}:`, error);
        return [];
      }
    });

    const results = await Promise.all(candidatePromises);
    const uniqueCandidatesMap = new Map<string, any>();
    results.flat().forEach(candidate => {
      if (candidate && candidate.title && !uniqueCandidatesMap.has(candidate.title)) {
        uniqueCandidatesMap.set(candidate.title, candidate);
      }
    });
    const candidates = Array.from(uniqueCandidatesMap.values());

    const finalResult = candidates.map(item => ({
      id: item.id,
      title: item.title,
      poster: item.poster,
      source: 'douban',
      source_name: '豆瓣',
      year: item.year,
      episodes: [],
      episodes_titles: [],
    })) as SearchResult[];

    // Return in the unified format
    return NextResponse.json({
      results: finalResult,
    });

  } catch (error) {
    console.error(`Error in /api/ai/assistant fallback for user ${user.username}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
