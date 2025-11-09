/* eslint-disable no-console */

import { AdminConfig } from './admin.types';
import { getConfig } from './config';
import { db } from './db';
import { getDoubanRecommends } from './douban.client';
import { Douban, SearchResult, User, WatchHistory } from './types';

const OLLAMA_HOST_DEFAULT = 'http://localhost:11434';

async function callOllama(
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
  return isJson ? JSON.parse(data.response) : data.response;
}

// Stage 1: Exploration - Generate search criteria from user history
async function explorationStage(
  config: AdminConfig,
  history: WatchHistory[]
) {
  const titles = history.map((h) => h.title).join(', ');
  const prompt = `
    The user has watched the following titles: ${titles}.
    Based on their viewing history, please generate 2-3 diverse Douban search criteria combinations to discover new content they might like.
    The available search parameters are: "kind" (e.g., "movie", "tv"), "category" (e.g., "科幻", "悬疑", "动作"), and "label" (e.g., "高分", "经典", "冷门").
    Return the response as a JSON object with a key "combinations", which is an array of criteria objects.
    Example format: {"combinations": [{ "kind": "movie", "category": "科幻", "label": "高分" }, ...]}
  `;

  const criteria = await callOllama(
    config.AIConfig.ollama_host || OLLAMA_HOST_DEFAULT,
    config.AIConfig.ollama_model || 'llama3',
    prompt,
    true
  );

  return criteria.combinations;
}

// Stage 2: Ranking - Re-rank candidates based on plot summaries
async function rankingStage(
  config: AdminConfig,
  history: WatchHistory[],
  candidates: Douban[]
) {
  const historyTitles = history.map((h) => h.title).join(', ');
  const candidateDetails = candidates
    .map((c) => `{id: "${c.id}", title: "${c.title}", intro: "${c.intro}"}`)
    .join(', ');

  const prompt = `
    A user likes the following titles: ${historyTitles}.
    Please re-rank the following candidate list based on their likely preferences. The list is provided with titles and plot summaries.
    Return only a JSON array of the sorted IDs.
    Candidate list: [${candidateDetails}]
  `;

  const sortedIds = await callOllama(
    config.AIConfig.ollama_host || OLLAMA_HOST_DEFAULT,
    config.AIConfig.ollama_model || 'llama3',
    prompt,
    true
  );

  return sortedIds;
}

export async function discoverSort(user: User): Promise<SearchResult[]> {
  const cacheKey = `discover_sort_user_${user.username}`;
  const cachedResult = await db.get(cacheKey);
  if (cachedResult) {
    return JSON.parse(cachedResult as string);
  }

  const config = await getConfig();
  if (!config.AIConfig.ollama_host) {
    console.log('Ollama host not configured, skipping AI sort.');
    return [];
  }

  const historyDict = await db.getAllPlayRecords(user.username);
  const history = Object.values(historyDict);
  if (!history || history.length === 0) {
    return [];
  }

  // Stage 1: Exploration
  const searchCriteria = await explorationStage(config, history);
  const candidatePromises = searchCriteria.map((criteria: { kind: 'tv' | 'movie'; category: string; label: string }) =>
    getDoubanRecommends(criteria)
  );
  const results = await Promise.all(candidatePromises);
  const candidates = Array.from(new Set(results.flat())); // Flatten and deduplicate

  // Stage 2: Ranking
  let sortedCandidates: Douban[];
  try {
    const sortedIds = await rankingStage(config, history, candidates);
    sortedCandidates = sortedIds.map((id: string) =>
      candidates.find((c) => c.id === id)
    );
  } catch (error) {
    console.error("AI ranking stage failed, falling back to un-ranked candidates:", error);
    sortedCandidates = candidates;
  }

  const finalResult = sortedCandidates.filter(Boolean).map(item => ({
    id: item.id,
    title: item.title,
    poster: item.poster,
    source: 'douban',
    source_name: '豆瓣',
    year: item.year,
    episodes: [],
    episodes_titles: [],
  })) as SearchResult[];

  await db.set(cacheKey, JSON.stringify(finalResult), 60 * 60 * 24); // Cache for 1 day

  return finalResult;
}
