import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  getTasteProfile,
  AVAILABLE_SEARCH_FILTERS,
  fetchAndProcessCandidates,
  SearchCriterion,
} from '@/lib/discover_sort';
import { generateContent } from '@/lib/ai';
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
  const provider = config.SiteConfig.aiProvider;

  if (!provider || (provider === 'ollama' && !config.SiteConfig.ollama_host) || (provider === 'gemini' && !config.SiteConfig.geminiApiKey)) {
    console.log('AI provider not configured, skipping AI assistant.');
    return NextResponse.json({ results: [] });
  }

  try {
    const tasteProfile = await getTasteProfile(user.username);
    if (!tasteProfile) {
        console.log(`No taste profile for ${user.username}. AI assistant might have limited context.`);
    }

    // Get all play records to use for both recent history context and filtering watched content.
    const allPlayRecords = await db.getAllPlayRecords(user.username);

    // --- Add Recent Watch History to Context ---
    const recentHistory = Object.values(allPlayRecords)
      .sort((a, b) => b.save_time - a.save_time)
      .slice(0, 5)
      .map(r => r.title);
    const recentHistoryDetails = recentHistory.length > 0 ? `[${recentHistory.join(', ')}]` : 'None';


    // --- Rewrite Prompt for Intent Classification and Better Context ---
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

      - **For "Similarity Search":** Deconstruct the *target title* into its core components (e.g., Genre + Mood + Region). Then generate a criterion that matches these components.
        - *Example:* If user asks for "like Interstellar", decompose it to "Science Fiction" + "Hardcore/Burn Brain". Generate: \`{ "kind": "movie", "category": "科幻", "label": "烧脑" }\`.
      - **For "Mood Search":** Map the user's emotional words to the available "label" list.
        - *Example:* "sad movie" -> "致郁"; "funny show" -> "搞笑"; "healing anime" -> "治愈".
      - **For "Specific Search":** Focus on the entity mentioned.
      - **For "Thematic Search":** Combine the theme with the user's taste profile.

      **Step 3: Format Output**
      Return a single JSON object with a single key: "searchCriteria". This key must contain an array of the criteria objects you generated. Do not include any other keys, explanations, or conversational text.
      **Optimization:** You are encouraged to generate 2 different criteria combinations to maximize the chance of finding good results (e.g., one strict match, one slightly broader).

      **Available Search Parameters:**
      - "kind": "movie" or "tv".
      - "category" (for movie): [${AVAILABLE_SEARCH_FILTERS.movie.category.join(', ')}]
      - "category" (for tv): [${AVAILABLE_SEARCH_FILTERS.tv.category.join(', ')}]
      - "label": [${[...new Set([...AVAILABLE_SEARCH_FILTERS.movie.label, ...AVAILABLE_SEARCH_FILTERS.tv.label])].join(', ')}]

      **Example Output:**
      {
        "searchCriteria": [
          { "kind": "movie", "category": "科幻", "label": "经典" },
          { "kind": "movie", "category": "悬疑", "label": "烧脑" }
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
