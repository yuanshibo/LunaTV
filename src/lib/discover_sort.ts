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
    label: ["豆瓣高分", "冷门佳片", "获奖", "治愈", "致郁", "励志", "搞笑", "黑色幽默", "人性", "青春", "感人", "经典", "悬疑", "犯罪", "科幻", "魔幻", "动作", "恐怖", "爱情", "古装", "历史", "战争", "传记", "纪录片", "动画", "二次元", "儿童", "家庭", "女性", "职场", "校园", "超级英雄", "怪兽", "赛博朋克", "末日", "时间旅行", "反乌托邦", "烧脑", "定格动画", "美国动画", "动物", "恶搞", "运动", "后宫", "恋爱"]
  },
  tv: {
    category: ["喜剧", "爱情", "悬疑", "武侠", "古装", "家庭", "犯罪", "科幻", "恐怖", "历史", "战争", "动作", "冒险", "传记", "剧情", "奇幻", "惊悚", "灾难", "歌舞", "音乐", "真人秀", "脱口秀"],
    region: ["华语", "欧美", "国外", "韩国", "日本", "中国大陆", "中国香港", "美国", "英国", "泰国", "中国台湾", "意大利", "法国", "德国", "西班牙", "俄罗斯", "瑞典", "巴西", "丹麦", "印度", "加拿大", "爱尔兰", "澳大利亚"],
    year: ["2020年代", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2010年代", "2000年代", "90年代", "80年代", "70年代", "60年代", "更早"],
    platform: ["腾讯视频", "爱奇艺", "优酷", "湖南卫视", "Netflix", "HBO", "BBC", "NHK", "CBS", "NBC", "tvN"],
    label: ["豆瓣高分", "冷门佳片", "获奖", "治愈", "致郁", "励志", "搞笑", "黑色幽默", "人性", "青春", "感人", "经典", "悬疑", "犯罪", "科幻", "魔幻", "动作", "恐怖", "爱情", "古装", "历史", "战争", "传记", "纪录片", "动画", "二次元", "儿童", "家庭", "女性", "职场", "校园", "美剧", "英剧", "韩剧", "日剧", "国产剧", "港剧", "台剧", "泰剧", "网剧", "烧脑", "下饭", "定格动画", "美国动画", "动物", "恶搞", "运动", "后宫", "恋爱", "国漫"]
  }
};

import { generateContent } from './ai';

export async function generateAndCacheTasteProfile(user: User): Promise<void> {
  const cacheKey = `taste_profile_user_${user.username}`;
  console.log(`Attempting to generate taste profile for user: ${user.username}`);

  const config = await getConfig();
  const provider = config.SiteConfig.aiProvider;

  if (!provider || (provider === 'ollama' && !config.SiteConfig.ollama_host) || (provider === 'gemini' && !config.SiteConfig.geminiApiKey)) {
    console.log('AI provider not configured, skipping taste profile generation.');
    return;
  }

  const { validRecords, abandonedRecords } = await getAndFilterPlayRecords(user.username);
  const searchHistory = await db.getSearchHistory(user.username);
  const favoritesDict = await db.getAllFavorites(user.username);
  const favorites = Object.values(favoritesDict);

  if (validRecords.length < 5 && favorites.length < 3) {
    console.log(`Not enough significant watch history (${validRecords.length} records) and favorites (${favorites.length}) to generate a taste profile for ${user.username}.`);
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

  const favoriteDetails = favorites
    .map((fav) => {
      const desc = sanitizeForPrompt(fav.description);
      return `{title: "${sanitizeForPrompt(fav.title)}", year: "${fav.year}", description: "${desc}"}`;
    })
    .join(', ');

  const searchHistoryDetails = searchHistory.join(', ');

  const prompt = `
    Analyze the following user data to create a detailed "Taste Profile". This data includes "favorited_titles" (which represent the STRONGEST preference signal), titles they watched significantly ("watched_titles"), titles they quickly abandoned ("abandoned_titles"), and their recent search history.

    **Favorited Titles (Strongest Preference):**
    These are items the user explicitly marked as favorites. Give them the highest weight in your analysis.
    Each item includes a title, year, and a brief "description" (synopsis).
    [${favoriteDetails}]

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
    const tasteProfile = await generateContent(prompt, true);

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
  const provider = config.SiteConfig.aiProvider;

  if (!provider || (provider === 'ollama' && !config.SiteConfig.ollama_host) || (provider === 'gemini' && !config.SiteConfig.geminiApiKey)) {
    console.log('AI provider not configured, skipping AI sort.');
    return [];
  }

  const tasteProfile = await getTasteProfile(user.username);
  const { validRecords: allValidHistory, abandonedRecords = [] } = await getAndFilterPlayRecords(user.username);
  const recentHistory = allValidHistory.slice(0, 10);
  const watchedTitlesAndYears = new Set(allValidHistory.map(record => `${record.title}-${record.year}`));

  // Gather abandoned titles for negative filtering
  const abandonedTitles = abandonedRecords.map(r => r.title).join(', ');


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

    **User's Recent Watched Titles (Last 10):**
    ${recentTitles}

    **User's Abandoned/Disliked Titles (AVOID SIMILAR CONTENT):**
    ${abandonedTitles}

    **Your Task:**
    Synthesize the user's long-term profile with their recent activity to generate exactly THREE search criteria combinations. You MUST adhere to the "disliked_elements" in the taste profile and the "Abandoned Titles" list to avoid bad recommendations.

    **Instructions for Each Combination:**

    1.  **Combination 1: Core Interest Match**
        - Analyze the user's strongest and most consistent preferences from their taste profile.
        - Generate a specific and precise search criterion that directly caters to this core interest.
        - **Optimization:** Use the new "label" field to map nuanced tastes (e.g., use "治愈" if they like heartwarming stories, "烧脑" if they like complex plots).

    2.  **Combination 2: Adjacent Exploration**
        - Identify a genre or theme that is related to the user's core interest but they haven't explored much.
        - Generate a criterion that gently pushes their boundaries.
        - **Example:** If the user loves modern "美国" "科幻" films, suggest a classic \`{ "kind": "movie", "category": "科幻", "region": "日本", "year": "90年代" }\`.

    3.  **Combination 3: True Surprise (Wildcard)**
        - **CRITICAL:** This combination MUST be significantly different from the user's "Recent Watched Titles" and "Core Interest".
        - Look for high-quality content ("豆瓣高分", "冷门佳片", "获奖") in a genre or region they rarely visit.
        - **Example:** If they only watch "欧美" "科幻", suggest a "高分" "华语" "剧情" movie.

    **Output Format:**
    - You MUST use the available search parameters and their exact values listed below.
    - Return a single JSON object with a key "combinations", which is an array containing exactly THREE criteria objects.

    **Available Search Parameters:**
    - "kind": "movie" or "tv".
    - "category" for "movie": [${AVAILABLE_SEARCH_FILTERS.movie.category.join(', ')}]
    - "category" for "tv": [${AVAILABLE_SEARCH_FILTERS.tv.category.join(', ')}]
    - "region" for "movie": [${AVAILABLE_SEARCH_FILTERS.movie.region.join(', ')}]
    - "region" for "tv": [${AVAILABLE_SEARCH_FILTERS.tv.region.join(', ')}]
    - "year" for "movie": [${AVAILABLE_SEARCH_FILTERS.movie.year.join(', ')}]
    - "year" for "tv": [${AVAILABLE_SEARCH_FILTERS.tv.year.join(', ')}]
    - "platform" for "tv": [${AVAILABLE_SEARCH_FILTERS.tv.platform.join(', ')}]
    - "label": [${Array.from(new Set([...AVAILABLE_SEARCH_FILTERS.movie.label, ...AVAILABLE_SEARCH_FILTERS.tv.label])).join(', ')}]

    Example format: {"combinations": [{...}, {...}, {...}]}
  `;

  try {
    const criteriaResponse = await generateContent(prompt, true);
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
