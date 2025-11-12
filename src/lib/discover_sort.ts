/* eslint-disable no-console */

import { AdminConfig } from './admin.types';
import { getConfig } from './config';
import { db } from './db';
import { getDoubanRecommends } from './douban.server';
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

export async function callOllama(
  ollamaHost: string,
  model: string,
  prompt: string,
  isJson = false
) {
  const body = {
    model: model,
    prompt: prompt,
    stream: false,
    ...(isJson ? { format: 'json' } : {}),
  };
  console.log(
    'Ollama request:',
    JSON.stringify(
      {
        model: body.model,
        prompt: body.prompt,
        format: body.format,
      },
      null,
      2
    )
  );

  const res = await fetch(`${ollamaHost}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `Ollama API request failed with status ${res.status}: ${res.statusText}`
    );
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

// Stage 1: Exploration - Generate search criteria from user history
async function explorationStage(
  config: AdminConfig,
  history: WatchHistory[]
) {
  const titles = history.map((h) => h.title).join(', ');
  console.log('User history titles for exploration:', titles);
  const prompt = `
    The user has watched the following titles: ${titles}.
    Based on their viewing history, please generate 2-3 diverse Douban search criteria combinations to discover new content they might like.

    You MUST use the following available search parameters. Choose "kind" first, then pick values from the corresponding categories.
    - "kind": "movie" or "tv".
    - "category":
      - For "movie": [${AVAILABLE_SEARCH_FILTERS.movie.category.join(', ')}]
      - For "tv": [${AVAILABLE_SEARCH_FILTERS.tv.category.join(', ')}]
    - "label": You can optionally use labels like "高分", "经典", "冷门".

    Return the response as a JSON object with a key "combinations", which is an array of criteria objects. Do not invent new categories.
    Example format: {"combinations": [{ "kind": "movie", "category": "科幻", "label": "高分" }, ...]}
  `;

  const criteria = await callOllama(
    config.SiteConfig.ollama_host || OLLAMA_HOST_DEFAULT,
    config.SiteConfig.ollama_model || 'llama3',
    prompt,
    true
  );
  console.log('Generated search criteria:', JSON.stringify(criteria, null, 2));
  return criteria.combinations;
}

// Stage 2: Ranking - Re-rank candidates based on plot summaries
async function rankingStage(
  config: AdminConfig,
  history: WatchHistory[],
  candidates: Douban[]
): Promise<string[]> {
  const historyTitles = history.map((h) => h.title).join(', ');
  const candidateDetails = candidates
    .map((c) => `{id: "${c.id}", title: "${c.title}", year: "${c.year}"}`)
    .join(', ');
  console.log('Candidates for ranking:', JSON.stringify(candidates, null, 2));

  const prompt = `
    A user likes the following titles: ${historyTitles}.
    Please re-rank the following candidate list based on their likely preferences. The list is provided with titles and release years.
    Return only a JSON array of the sorted IDs.
    Candidate list: [${candidateDetails}]
  `;

  const aiResponse = await callOllama(
    config.SiteConfig.ollama_host || OLLAMA_HOST_DEFAULT,
    config.SiteConfig.ollama_model || 'llama3',
    prompt,
    true
  );
  console.log('Raw sorted response from ranking:', JSON.stringify(aiResponse, null, 2));

  let sortedIds: any[] = [];

  if (Array.isArray(aiResponse)) {
    sortedIds = aiResponse;
  } else if (typeof aiResponse === 'object' && aiResponse !== null) {
    if (Array.isArray(aiResponse.sorted_ids)) {
      sortedIds = aiResponse.sorted_ids;
    } else if (Array.isArray(aiResponse.result)) {
      sortedIds = aiResponse.result;
    }
  }

  if (sortedIds.length > 0) {
    // Ensure all elements are strings
    return sortedIds.map(id => String(id));
  }

  console.error('Could not parse a valid array of IDs from AI ranking response.');
  return [];
}

export async function generateAndCacheTasteProfile(user: User): Promise<void> {
  const cacheKey = `taste_profile_user_${user.username}`;
  console.log(`Attempting to generate taste profile for user: ${user.username}`);

  const config = await getConfig();
  if (!config.SiteConfig.ollama_host) {
    console.log('Ollama host not configured, skipping taste profile generation.');
    return;
  }

  const { validRecords, abandonedRecords } = await getAndFilterPlayRecords(user.username);
  const searchHistory = await db.getSearchHistory(user.username);

  if (validRecords.length < 5) {
    console.log(`Not enough significant watch history (${validRecords.length} records) to generate a taste profile for ${user.username}.`);
    return;
  }

  const validHistoryDetails = validRecords
    .map((h) => `{title: "${h.title}", year: "${h.year}"}`)
    .join(', ');

  const abandonedHistoryDetails = abandonedRecords
    .map((h) => `{title: "${h.title}", year: "${h.year}"}`)
    .join(', ');

  const searchHistoryDetails = searchHistory.join(', ');

  const prompt = `
    Analyze the following user data to create a detailed "Taste Profile". The data includes titles they watched significantly ("watched_titles"), titles they quickly abandoned ("abandoned_titles"), and their recent search history ("search_history").

    **Watched Titles (Positive Preference):**
    [${validHistoryDetails}]

    **Abandoned Titles (Negative Preference):**
    [${abandonedHistoryDetails}]

    **Search History (Keywords of Interest):**
    [${searchHistoryDetails}]

    Based on all of this data, create a detailed "Taste Profile" for the user.
    The profile should be a JSON object containing the following keys:
    - "preferred_genres": An array of strings for their most-loved genres.
    - "favorite_themes": An array of strings for specific themes or elements they enjoy.
    - "key_figures": An array of strings for directors or actors they seem to follow.
    - "mood_preference": An array of strings describing the emotional tone of the content they watch.
    - "disliked_elements": An array of strings identifying potential genres or themes they avoid. **Use the "abandoned_titles" as a strong signal for what to include here.**

    Synthesize information from the viewing and search history to create a comprehensive profile. For example, if they search for "诺兰", you can infer an interest in that director.

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
    const tasteProfile = await callOllama(
      config.SiteConfig.ollama_host || OLLAMA_HOST_DEFAULT,
      config.SiteConfig.ollama_model || 'llama3',
      prompt,
      true
    );

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

export async function discoverSort(user: User): Promise<SearchResult[]> {
  const cacheKey = `discover_sort_user_${user.username}`;
  const cachedResult = await db.get(cacheKey);
  if (cachedResult) {
    console.log(`AI recommendations cache hit for user: ${user.username}`);
    return JSON.parse(cachedResult as string);
  }
  console.log(`AI recommendations cache miss for user: ${user.username}`);

  const config = await getConfig();
  if (!config.SiteConfig.ollama_host) {
    console.log('Ollama host not configured, skipping AI sort.');
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

  // --- Fallback Logic ---
  // If no taste profile exists, revert to the old method and trigger a profile generation.
  if (!tasteProfile) {
    console.log(`No taste profile for ${user.username}. Using fallback recommendation logic.`);
    // Trigger profile generation in the background, but don't wait for it.
    generateAndCacheTasteProfile(user);

    // Use the original two-stage logic as a fallback.
    const searchCriteria = await explorationStage(config, recentHistory);
    const candidatePromises = searchCriteria.map(async (criteria: { kind: 'tv' | 'movie'; category: string; label: string }) => {
      try {
        // Diversify source by fetching from a random page within the first 10 pages
        const randomPageStart = Math.floor(Math.random() * 10) * 20;
        const result = await getDoubanRecommends({ ...criteria, pageStart: randomPageStart });
        return result.list;
      } catch (error) {
        console.error(`Fallback: Error fetching for criteria ${JSON.stringify(criteria)}:`, error);
        return [];
      }
    });
    const results = await Promise.all(candidatePromises);
    const uniqueCandidatesMap = new Map<string, Douban>();
    results.flat().forEach(candidate => {
      const candidateKey = `${candidate.title}-${candidate.year}`;
      if (candidate && candidate.title && !uniqueCandidatesMap.has(candidate.title) && !watchedTitlesAndYears.has(candidateKey)) {
        uniqueCandidatesMap.set(candidate.title, candidate);
      }
    });
    const candidates = Array.from(uniqueCandidatesMap.values());
    const fineTuningCandidates = candidates.slice(0, 50);

    let sortedCandidates: Douban[];
    try {
      const sortedIds = await rankingStage(config, recentHistory, fineTuningCandidates);
      sortedCandidates = sortedIds.map((id: string) => candidates.find((c) => c.id === id)).filter(Boolean) as Douban[];
    } catch (error) {
      console.error("Fallback: AI ranking failed, returning un-ranked candidates:", error);
      sortedCandidates = fineTuningCandidates; // Return the truncated list if ranking fails
    }

    const finalResult = sortedCandidates.map(item => ({
      id: item.id,
      title: item.title,
      poster: item.poster,
      source: 'douban',
      source_name: '豆瓣',
      year: item.year,
      episodes: [],
      episodes_titles: [],
    })) as SearchResult[];

    await db.set(cacheKey, JSON.stringify(finalResult), 60 * 60 * 24);
    return finalResult;
  }

  // --- New Taste Profile-based Logic ---
  console.log(`Using taste profile to generate recommendations for ${user.username}.`);
  const recentTitles = recentHistory.map(h => h.title).join(', ');

  const prompt = `
    Based on the user's comprehensive Taste Profile and their recent activity, please provide personalized recommendations.

    **User's Long-term Taste Profile:**
    ${JSON.stringify(tasteProfile, null, 2)}

    **User's Recent Watched Titles:**
    ${recentTitles}

    **Your Task:**
    1.  Synthesize the long-term profile with their immediate interests.
    2.  Generate a list of 2-3 diverse Douban search criteria combinations that reflect this synthesis.
    3.  You MUST use the following available search parameters. Choose "kind" first, then pick values from the corresponding categories.
        - "kind": "movie" or "tv".
        - "category":
          - For "movie": [${AVAILABLE_SEARCH_FILTERS.movie.category.join(', ')}]
          - For "tv": [${AVAILABLE_SEARCH_FILTERS.tv.category.join(', ')}]
        - "label": You can optionally use labels like "高分", "经典", "冷门".
    4.  Return the response as a JSON object with a key "combinations", which is an array of criteria objects. Do not invent new categories.
        Example format: {"combinations": [{ "kind": "movie", "category": "科幻", "label": "高分" }, ...]}
  `;

  try {
    const criteriaResponse = await callOllama(
      config.SiteConfig.ollama_host || OLLAMA_HOST_DEFAULT,
      config.SiteConfig.ollama_model || 'llama3',
      prompt,
      true
    );
    const searchCriteria = criteriaResponse.combinations;

    const candidatePromises = searchCriteria.map(async (criteria: { kind: 'tv' | 'movie'; category: string; label: string }) => {
      try {
        const randomPageStart = Math.floor(Math.random() * 10) * 20;
        const result = await getDoubanRecommends({ ...criteria, pageStart: randomPageStart });
        return result.list;
      } catch (error) {
        console.error(`Error fetching recommendations for criteria ${JSON.stringify(criteria)}:`, error);
        return [];
      }
    });
    const results = await Promise.all(candidatePromises);
    const uniqueCandidatesMap = new Map<string, Douban>();
    results.flat().forEach(candidate => {
      const candidateKey = `${candidate.title}-${candidate.year}`;
      if (candidate && candidate.title && !uniqueCandidatesMap.has(candidate.title) && !watchedTitlesAndYears.has(candidateKey)) {
        uniqueCandidatesMap.set(candidate.title, candidate);
      }
    });
    const candidates = Array.from(uniqueCandidatesMap.values());
    console.log(`Found ${candidates.length} unique, unwatched candidates from profile-based search.`);

    // Coarse-ranking: Truncate the list to a manageable size for the AI.
    const fineTuningCandidates = candidates.slice(0, 50);

    // Re-rank the candidates based on the profile and recent history.
    const sortedIds = await rankingStage(config, recentHistory, fineTuningCandidates);
    const sortedCandidates = sortedIds.map((id: string) => candidates.find((c) => c.id === id)).filter(Boolean) as Douban[];

    const finalResult = sortedCandidates.map(item => ({
      id: item.id,
      title: item.title,
      poster: item.poster,
      source: 'douban',
      source_name: '豆瓣',
      year: item.year,
      episodes: [],
      episodes_titles: [],
    })) as SearchResult[];

    await db.set(cacheKey, JSON.stringify(finalResult), 60 * 60 * 24);
    console.log(`AI recommendations (profile-based) cached for user: ${user.username}`);
    return finalResult;
  } catch (error) {
    console.error(`Error during taste profile-based recommendation for ${user.username}:`, error);
    return []; // Return empty on error
  }
}
