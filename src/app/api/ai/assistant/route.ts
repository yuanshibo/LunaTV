import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  getTasteProfile,
  AVAILABLE_SEARCH_FILTERS,
  fetchAndProcessCandidates,
  SearchCriterion,
} from '@/lib/discover_sort';
import { generateContent } from '@/lib/ai';
import { db } from '@/lib/db';
import { directSearch } from '@/lib/search';
import { SearchResult } from '@/lib/types';
import { User } from '@/lib/types';

export const runtime = 'nodejs';

async function* streamAssistantResponse(query: string, user: User): AsyncGenerator<string> {
  // Helper function to stream an array of results
  const streamResults = (results: SearchResult[]): string => {
    return results.map(result => JSON.stringify(result) + '\n').join('');
  };

  // --- Step 1: Direct Search ---
  const directSearchResults = await directSearch(query, user.username);
  if (directSearchResults.length > 0) {
    yield streamResults(directSearchResults);
    return;
  }

  // --- Step 2: AI Fallback ---
  const config = await getConfig();
  const provider = config.SiteConfig.aiProvider;

  if (!provider || (provider === 'ollama' && !config.SiteConfig.ollama_host) || (provider === 'gemini' && !config.SiteConfig.geminiApiKey)) {
    return; // No provider, end the stream.
  }

  const tasteProfile = await getTasteProfile(user.username);
  const allPlayRecords = await db.getAllPlayRecords(user.username);
  const recentHistory = Object.values(allPlayRecords)
    .sort((a, b) => b.save_time - a.save_time)
    .slice(0, 5)
    .map(r => r.title);
  const recentHistoryDetails = recentHistory.length > 0 ? `[${recentHistory.join(', ')}]` : 'None';

  const prompt = `
    You are an expert AI assistant for a media streaming app. Your sole task is to generate a precise set of Douban search criteria based on a user's taste profile, their recent activity, and their current query.

    **User's Long-term Taste Profile:**
    ${JSON.stringify(tasteProfile, null, 2)}

    **User's 5 Most Recently Watched Titles:**
    ${recentHistoryDetails}

    **User's Current Query:**
    "${query}"

    **Your Task:**
    **Step 1: Classify User Intent**
    First, analyze the user's query and classify their primary intent. Choose one of the following categories:
    - "Specific Search": The user is looking for a specific actor, director, or an exact title. (e.g., "汤姆·汉克斯的电影", "找一下三体")
    - "Thematic Search": The user is looking for a specific theme, genre, or plot type. (e.g., "关于时间旅行的电影", "有没有类似黑镜的剧集")
    - "Mood Search": The user is looking for content that evokes a certain feeling or mood. (e.g., "适合一个人晚上看的治愈系电影", "来点轻松搞笑的下饭剧")
    - "Similarity Search": The user wants something similar to a title they already know. (e.g., "有没有像《星际穿越》那样的科幻片")

    **Step 2: Synthesize and Generate Criteria**
    Based on your intent classification from Step 1, synthesize all the available information (taste profile, recent history, and the query itself) to create a list of 1-2 highly relevant Douban search criteria combinations.
    - For "Specific Search", focus on the entity mentioned.
    - For other searches, use the taste profile and recent history to refine the criteria to the user's specific tastes. For example, if they ask for a "suspense film" and their profile shows a love for "dystopian" themes, combine these concepts.

    **Step 3: Format Output**
    Return a single JSON object with a single key: "searchCriteria". This key must contain an array of the criteria objects you generated. Do not include any other keys, explanations, or conversational text.

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

  const aiResponse = await generateContent(prompt, true);
  const { searchCriteria } = aiResponse as { searchCriteria: SearchCriterion[] };

  if (!searchCriteria || !Array.isArray(searchCriteria)) {
    throw new Error('Invalid response format from AI assistant: missing searchCriteria.');
  }

  const watchedTitlesAndYears = new Set(
    Object.values(allPlayRecords).map(record => `${record.title}-${record.year}`)
  );

  const finalResult = await fetchAndProcessCandidates(searchCriteria, watchedTitlesAndYears);
  yield streamResults(finalResult);
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  // Step 1: Authenticate and get query from the NextRequest object
  const user = await getUserFromRequest(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { query } = await request.json();
  if (!query || typeof query !== 'string') {
    return new Response(JSON.stringify({ error: 'Invalid query' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Step 2: Create the stream and pass necessary data to it
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamAssistantResponse(query, user)) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (error) {
        console.error(`Critical error in /api/ai/assistant stream for query "${query}":`, error);
        controller.enqueue(encoder.encode(JSON.stringify({ error: 'Internal Server Error' }) + '\n'));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson', // Newline Delimited JSON
    },
  });
}
