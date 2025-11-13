/* eslint-disable no-console */

import { AdminConfig } from './admin.types';
import { getConfig } from './config';
import { db } from './db';
import { getDoubanRecommends } from './douban.server';
import { generateContentWithGemini } from './gemini';
import { Douban, SearchResult, User, WatchHistory } from './types';

const OLLAMA_HOST_DEFAULT = 'http://localhost:11434';

export const AVAILABLE_SEARCH_FILTERS = {
  movie: {
    category: ["喜剧", "爱情", "动作", "科幻", "悬疑", "犯罪", "惊悚", "冒险", "音乐", "历史", "奇幻", "恐怖", "战争", "传记", "歌舞", "武侠", "情色", "灾难", "西部", "纪录片", "短片"],
    region: ["华语", "欧美", "韩国", "日本", "中国大陆", "美国", "中国香港", "中国台湾", "英国", "法国", "德国", "意大利", "西班牙", "印度", "泰国", "俄罗斯", "加拿大", "澳大利亚", "爱尔兰", "瑞典", "巴西", "丹麦"],
    year: ["2020年代", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2010年代", "2000年代", "90年代", "80年代", "70年代", "60年代", "更早"],
  },
  tv: {
    category: ["喜剧", "爱情", "悬疑", "武侠", "古装", "家庭", "犯罪", "科幻", "恐怖", "历史", "战争", "动作", "冒险", "传记", "剧情", "奇幻", "惊悚", "灾难", "歌舞", "音乐"],
    region: ["华语", "欧美", "国外", "韩国", "日本", "中国大陆", "中国香港", "美国", "英国", "泰国", "中国台湾", "意大利", "法国", "德国", "西班牙", "俄罗斯", "瑞典", "巴西", "丹麦", "印度", "加拿大", "爱尔兰", "澳大利亚"],
    year: ["2020年代", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2010年代", "2000年代", "90年代", "80年代", "70年代", "60年代", "更早"],
    platform: ["腾讯视频", "爱奇艺", "优酷", "湖南卫视", "Netflix", "HBO", "BBC", "NHK", "CBS", "NBC", "tvN"],
  }
};

export async function callAI(prompt: string, isJson = false): Promise<any> {
  const config = await getConfig();
  const provider = config.SiteConfig.ai_provider || 'ollama';

  if (provider === 'gemini') {
    const apiKey = config.SiteConfig.gemini_api_key;
    const modelName = config.SiteConfig.gemini_model || 'gemini-pro';
    if (!apiKey) {
      throw new Error('Gemini API key is not configured.');
    }
    const result = await generateContentWithGemini(apiKey, modelName, prompt);
    return isJson ? JSON.parse(result) : result;
  } else {
    // Default to Ollama
    const ollamaHost = config.SiteConfig.ollama_host || OLLAMA_HOST_DEFAULT;
    const modelName = config.SiteConfig.ollama_model || 'llama3';

    const body = {
      model: modelName,
      prompt: prompt,
      stream: false,
      ...(isJson ? { format: 'json' } : {}),
    };

    console.log('Ollama request:', JSON.stringify({ model: body.model, prompt: body.prompt, format: body.format }, null, 2));

    const res = await fetch(`${ollamaHost}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama API request failed with status ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { context, ...logData } = data;
    console.log('Ollama response:', JSON.stringify(logData, null, 2));

    if (data.done === false) {
      throw new Error('Ollama response was not complete.');
    }

    return isJson ? JSON.parse(data.response) : data.response;
  }
}

export async function generateAndCacheTasteProfile(user: User): Promise<void> {
  const cacheKey = `taste_profile_user_${user.username}`;
  console.log(`Attempting to generate taste profile for user: ${user.username}`);

  const config = await getConfig();
  const provider = config.SiteConfig.ai_provider;

  if (!provider || (provider === 'ollama' && !config.SiteConfig.ollama_host) || (provider === 'gemini' && !config.SiteConfig.gemini_api_key)) {
    console.log('AI provider not configured, skipping taste profile generation.');
    return;
  }

  const { validRecords, abandonedRecords } = await getAndFilterPlayRecords(user.username);
  const searchHistory = await db.getSearchHistory(user.username);

  if (validRecords.length < 5) {
    console.log(`Not enough significant watch history (${validRecords.length} records) to generate a taste profile for ${user.username}.`);
    return;
  }

  const sanitizeForPrompt = (str: string | undefined | null) => {
    if (!str) return '';
    // Replace characters that could break the prompt structure, like double quotes.
    return str.replace(/"/g, "'").replace(/\n/g, ' ').trim();
  };

  const validHistoryDetails = validRecords
    .map((h) => {
      const desc = sanitizeForPrompt(h.description);
      return `{title: "${sanitizeForPrompt(h.title)}", year: "${h.year}", description: "${desc}"}`;
    })
    .join(', ');

  const abandonedHistoryDetails = abandonedRecords
    .map((h) => {
      const desc = sanitizeForPrompt(h.description);
      return `{title: "${sanitizeForPrompt(h.title)}", year: "${h.year}", description: "${desc}"}`;
    })
    .join(', ');

  const searchHistoryDetails = searchHistory.join(', ');

  const prompt = `
    Analyze the following user data to create a detailed "Taste Profile". The data includes titles they watched significantly ("watched_titles"), titles they quickly abandoned ("abandoned_titles"), and their recent search history ("search_history").

    **Watched Titles (Positive Preference):**
    Each item includes a title, year, and a brief "description" (synopsis).
    [${validHistoryDetails}]

    **Abandoned Titles (Negative Preference):**
    Each item includes a title, year, and a brief "description" (synopsis).
    [${abandonedHistoryDetails}]

    **Search History (Keywords of Interest):**
    [${searchHistoryDetails}]

    Based on ALL of this data, create a detailed "Taste Profile" for the user.
    **Pay special attention to the "description" field**, as it provides deep insights into the plot, themes, and style the user prefers or dislikes.
    **Note that the title lists are sorted by recency**, with the first items being the most recently watched. Give more weight to these recent items to better capture the user's current interests.

    The profile should be a JSON object containing the following keys:
    - "preferred_genres": An array of strings for their most-loved genres.
    - "favorite_themes": An array of strings for specific themes, plot elements, or character archetypes they enjoy (e.g., "time travel", "dystopian societies", "complex anti-heroes"). **Derive this heavily from the descriptions.**
    - "key_figures": An array of strings for directors or actors they seem to follow.
    - "mood_preference": An array of strings describing the emotional tone of the content they watch (e.g., "thought-provoking", "suspenseful", "uplifting").
    - "disliked_elements": An array of strings identifying potential genres or themes they avoid. **Use the "abandoned_titles" and their descriptions as a strong signal for what to include here.**

    Synthesize information from the viewing history, descriptions, and search history to create a comprehensive profile.

    Please provide a concise and accurate analysis. Example output:
    {
      "preferred_genres": ["科幻", "悬疑"],
      "favorite_themes": ["时间旅行", "反乌托邦"],
      "key_figures": ["克里斯托弗·诺兰"],
      "mood_preference": ["烧脑", "结局反转"],
      "disliked_elements": ["浪漫喜剧"]
    }
  `;

  try {
    const tasteProfile = await callAI(prompt, true);

    console.log(`Generated taste profile for ${user.username}:`, JSON.stringify(tasteProfile, null, 2));

    // Cache the profile for 7 days.
    await db.set(cacheKey, JSON.stringify(tasteProfile), 60 * 60 * 24 * 7);
    console.log(`Taste profile cached for user: ${user.username}`);
  } catch (error) {
    console.error(`Failed to generate taste profile for ${user.username}:`, error);
  }
}

async function getAndFilterPlayRecords(username: string): Promise<{ validRecords: WatchHistory[], abandonedRecords: WatchHistory[] }> {
  const historyDict = await db.getAllPlayRecords(username);
  const allRecords = Object.values(historyDict);

  if (!allRecords || allRecords.length === 0) {
    return { validRecords: [], abandonedRecords: [] };
  }

  console.log(`Found ${allRecords.length} raw play records for user: ${username}. Filtering...`);

  const validRecords: WatchHistory[] = [];
  const abandonedRecords: WatchHistory[] = [];

  allRecords.forEach(record => {
    const isSeries = record.total_episodes > 1;
    if (isSeries) {
      if (record.index >= 1) {
        validRecords.push(record);
      } else {
        abandonedRecords.push(record);
      }
    } else {
      if (!record.total_time || record.total_time === 0) {
        // Cannot determine progress, treat as abandoned
        abandonedRecords.push(record);
        return;
      }
      const progress = record.play_time / record.total_time;
      if (progress >= 0.2) {
        validRecords.push(record);
      } else {
        abandonedRecords.push(record);
      }
    }
  });

  console.log(`Found ${validRecords.length} valid and ${abandonedRecords.length} abandoned records after filtering for user: ${username}.`);

  // Sort both arrays by save_time descending
  validRecords.sort((a, b) => b.save_time - a.save_time);
  abandonedRecords.sort((a, b) => b.save_time - a.save_time);

  return { validRecords, abandonedRecords };
}

export async function getTasteProfile(username: string): Promise<any | null> {
  const cacheKey = `taste_profile_user_${username}`;
  const cachedProfile = await db.get(cacheKey);
  if (cachedProfile) {
    console.log(`Taste profile cache hit for user: ${username}`);
    return JSON.parse(cachedProfile as string);
  }
  console.log(`Taste profile cache miss for user: ${username}`);
  return null;
}

// Define a clear type for the criteria object for reusability and type safety.
export type SearchCriterion = {
  kind: 'tv' | 'movie';
  category: string;
  label: string;
};

/**
 * The new core utility function for AI-driven recommendations.
 * It takes search criteria, fetches candidates, processes them, and returns a sorted list.
 * @param searchCriteria - An array of search criteria generated by the AI.
 * @param watchedTitlesAndYears - A Set of 'title-year' strings to filter out watched content.
 * @returns A promise that resolves to a sorted array of SearchResult.
 */
export async function fetchAndProcessCandidates(
  searchCriteria: SearchCriterion[],
  watchedTitlesAndYears: Set<string>
): Promise<SearchResult[]> {
  const candidatePromises = searchCriteria.map(async (criteria) => {
    const candidatesForCriterion: Douban[] = [];
    try {
      // Step 1: Fetch the first page to get the total count and initial data.
      const firstPageResult = await getDoubanRecommends({ ...criteria, pageStart: 0, pageLimit: 20 });
      if (firstPageResult && firstPageResult.list) {
        candidatesForCriterion.push(...firstPageResult.list);
      }

      const total = firstPageResult.total ?? 0;
      const pageSize = 20;

      // Step 2: If there's more than one page, fetch a random subsequent page for diversity.
      if (total > pageSize) {
        const maxPages = Math.ceil(total / pageSize);
        // We fetch from the second page onwards, so random page is between 1 and maxPages-1
        const randomPage = Math.floor(Math.random() * (maxPages - 1)) + 1;
        const randomPageStart = randomPage * pageSize;

        const secondPageResult = await getDoubanRecommends({ ...criteria, pageStart: randomPageStart, pageLimit: pageSize });
        if (secondPageResult && secondPageResult.list) {
          candidatesForCriterion.push(...secondPageResult.list);
        }
      }
    } catch (error) {
      console.error(`Error fetching recommendations for criteria ${JSON.stringify(criteria)}:`, error);
      // Return whatever was gathered, even if partial, or an empty array on total failure.
    }
    return candidatesForCriterion;
  });

  const results = await Promise.all(candidatePromises);
  const uniqueCandidatesMap = new Map<string, Douban>();

  results.flat().forEach(candidate => {
    if (!candidate || !candidate.title) return;

    const candidateKey = `${candidate.title}-${candidate.year}`;
    // Filter out watched content and deduplicate by title
    if (!uniqueCandidatesMap.has(candidate.title) && !watchedTitlesAndYears.has(candidateKey)) {
      uniqueCandidatesMap.set(candidate.title, candidate);
    }
  });

  const candidates = Array.from(uniqueCandidatesMap.values());

  // Sort by 'rate' in descending order. Higher ratings come first.
  candidates.sort((a, b) => {
    const rateA = a.rate ? parseFloat(a.rate) : 0;
    const rateB = b.rate ? parseFloat(b.rate) : 0;
    return rateB - rateA;
  });

  // Format the final results into the standard SearchResult format.
  return candidates.map(item => ({
    id: item.id,
    title: item.title,
    poster: item.poster,
    source: 'douban',
    source_name: '豆瓣',
    year: item.year,
    episodes: [],
    episodes_titles: [],
  })) as SearchResult[];
}

export async function discoverSort(user: User): Promise<SearchResult[]> {
  const cacheKey = `discover_sort_user_${user.username}`;
  const cachedResult = await db.get(cacheKey);
  if (cachedResult) {
    console.log(`AI recommendations cache hit for user: ${user.username}`);
    return JSON.parse(cachedResult as string);
  }
  console.log(`AI recommendations cache miss for user: ${user.username}`);

  const config = await getConfig();
  const provider = config.SiteConfig.ai_provider;

  if (!provider || (provider === 'ollama' && !config.SiteConfig.ollama_host) || (provider === 'gemini' && !config.SiteConfig.gemini_api_key)) {
    console.log('AI provider not configured, skipping AI sort.');
    return [];
  }

  const tasteProfile = await getTasteProfile(user.username);
  const { validRecords: allValidHistory } = await getAndFilterPlayRecords(user.username);
  const recentHistory = allValidHistory.slice(0, 10);
  const watchedTitlesAndYears = new Set(allValidHistory.map(record => `${record.title}-${record.year}`));


  if (recentHistory.length === 0) {
    console.log(`No recent significant play history for ${user.username}, cannot generate recommendations.`);
    return [];
  }

  // --- Unified AI-driven Recommendation Logic ---
  console.log(`Generating recommendations for ${user.username}.`);

  // If no taste profile exists, trigger generation but don't wait for it.
  if (!tasteProfile) {
    console.log(`No taste profile for ${user.username}. Triggering background generation.`);
    generateAndCacheTasteProfile(user);
    // We can still proceed with recent history as a temporary proxy for taste.
  }

  const recentTitles = recentHistory.map(h => h.title).join(', ');
  const tasteProfilePrompt = tasteProfile
    ? `**User's Long-term Taste Profile:**\n${JSON.stringify(tasteProfile, null, 2)}`
    : `The user has no long-term profile. Please infer their taste from their recent activity.`;

  const prompt = `
    You are an expert movie and TV show recommender. Your goal is to generate a diverse, personalized, and creative set of Douban search criteria for a user.

    ${tasteProfilePrompt}

    **User's Recent Watched Titles:**
    ${recentTitles}

    **Your Task:**
    Synthesize the user's long-term profile with their recent activity to generate exactly THREE search criteria combinations, each with a distinct purpose, to provide a well-rounded recommendation experience.

    **Instructions for Each Combination:**

    1.  **Combination 1: Core Interest Match**
        - Analyze the user's strongest and most consistent preferences from their taste profile.
        - Generate a specific and precise search criterion that directly caters to this core interest.
        - **Example:** If the user loves "悬疑" and "科幻", don't just search for "科幻". Instead, create a more targeted criterion like \`{ "kind": "movie", "category": "悬疑", "label": "高分" }\` that also aligns with their preference for highly-rated content.

    2.  **Combination 2: Adjacent Exploration**
        - Identify a genre or theme that is related to the user's core interest but they haven't explored much.
        - Generate a criterion that gently pushes their boundaries.
        - **Example:** If the user loves modern "美国" "科幻" films, suggest a classic \`{ "kind": "movie", "category": "科幻", "region": "日本", "year": "90年代" }\` to introduce them to a different style of the same genre.

    3.  **Combination 3: Surprise Niche (Wildcard)**
        - Look for an interesting, less obvious connection in their profile or history.
        - Generate a creative, "cold start" criterion for a niche genre or theme they might unexpectedly enjoy.
        - **Example:** If a user watches many "犯罪" dramas that often feature complex legal battles, you might infer an interest in courtroom dramas and suggest a \`{ "kind": "movie", "category": "剧情", "label": "经典" }\` and hint that it's a courtroom-focused film.

    **Output Format:**
    - You MUST use the available search parameters and their exact values listed below.
    - Return a single JSON object with a key "combinations", which is an array containing exactly THREE criteria objects, following the logic above.

    **Available Search Parameters:**
    - "kind": "movie" or "tv".
    - "category" for "movie": [${AVAILABLE_SEARCH_FILTERS.movie.category.join(', ')}]
    - "category" for "tv": [${AVAILABLE_SEARCH_FILTERS.tv.category.join(', ')}]
    - "region" for "movie": [${AVAILABLE_SEARCH_FILTERS.movie.region.join(', ')}]
    - "region" for "tv": [${AVAILABLE_SEARCH_FILTERS.tv.region.join(', ')}]
    - "year" for "movie": [${AVAILABLE_SEARCH_FILTERS.movie.year.join(', ')}]
    - "year" for "tv": [${AVAILABLE_SEARCH_FILTERS.tv.year.join(', ')}]
    - "platform" for "tv": [${AVAILABLE_SEARCH_FILTERS.tv.platform.join(', ')}]
    - "label": You can optionally use "高分", "经典", "冷门".

    Example format: {"combinations": [{...}, {...}, {...}]}
  `;

  try {
    const criteriaResponse = await callAI(prompt, true);
    const searchCriteria = criteriaResponse.combinations as SearchCriterion[];

    if (!searchCriteria || !Array.isArray(searchCriteria)) {
      throw new Error('Invalid response format from AI: "combinations" is not a valid array.');
    }

    console.log(`AI generated ${searchCriteria.length} search criteria, now fetching and processing candidates.`);

    // Use the new, unified core function to get the final sorted list.
    const finalResult = await fetchAndProcessCandidates(searchCriteria, watchedTitlesAndYears);

    await db.set(cacheKey, JSON.stringify(finalResult), 60 * 60 * 24);
    console.log(`AI recommendations cached for user: ${user.username}. Found ${finalResult.length} items.`);
    return finalResult;
  } catch (error) {
    console.error(`Error during AI recommendation generation for ${user.username}:`, error);
    return []; // Return empty on error to prevent crashing the UI.
  }
}
