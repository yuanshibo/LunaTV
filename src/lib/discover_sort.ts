/* eslint-disable no-console */

import { db } from './db';
import {
  getDoubanDetail,
  getDoubanList,
  getDoubanRecommends,
} from './douban.client';
import { DoubanItem, PlayRecord } from './types';

// AI 排序核心逻辑
export class DiscoverSort {
  // 获取豆瓣 Top 500 数据
  private async getDoubanTop500(): Promise<DoubanItem[]> {
    const cacheKey = 'douban-top-500';
    const cachedData = await db.getGlobalCache<DoubanItem[]>(cacheKey);
    if (cachedData) {
      console.log('Using cached Douban Top 500...');
      return cachedData;
    }

    console.log('Fetching Douban Top 500 in parallel...');
    const pageLimit = 100;
    const pageCount = 5;
    const promises: Promise<DoubanItem[]>[] = [];

    for (let i = 0; i < pageCount; i++) {
      promises.push(
        getDoubanList({
          tag: '热门',
          type: 'tv',
          pageLimit: pageLimit,
          pageStart: i * pageLimit,
        }).then((res) => res.list)
      );
    }

    const results = await Promise.all(promises);
    const combinedList = results.flat();

    if (combinedList.length > 0) {
      // 缓存24小时
      await db.setGlobalCache(cacheKey, combinedList, 60 * 60 * 24);
    }

    return combinedList;
  }

  // 获取用户全部播放记录
  private async getAllPlayRecords(
    userName: string
  ): Promise<{ [key: string]: PlayRecord }> {
    console.log(`Fetching play records for user: ${userName}...`);
    return db.getAllPlayRecords(userName);
  }

  // AI-based sorting (Two-Stage)
  public async sort(userName: string): Promise<DoubanItem[]> {
    console.log(`Starting Two-Stage AI sorting for user: ${userName}...`);

    const adminConfig = await db.getAdminConfig();
    const aiConfig = adminConfig?.AiConfig;

    if (!aiConfig?.host) {
      console.log('AI host not configured. Skipping AI sorting.');
      await db.setGlobalCache(`discover:${userName}`, [], 60 * 60 * 24);
      return [];
    }

    const playRecords = await this.getAllPlayRecords(userName);
    const watchedTitles = Object.values(playRecords).map((r) => r.title).filter(Boolean);

    if (watchedTitles.length === 0) {
      console.log('User has no play records. Returning Top 500 list as fallback.');
      return this.getDoubanTop500();
    }

    // Stage 1: AI Exploration & Strategy Generation
    let candidateItems: DoubanItem[] = [];
    try {
      console.log('Stage 1: AI generating search strategies...');
      const explorationPrompt = this.buildExplorationPrompt(watchedTitles);
      const combinations = await this.callOllama(aiConfig, explorationPrompt);

      const parsedCombinations = JSON.parse(combinations).combinations;
      if (!Array.isArray(parsedCombinations) || parsedCombinations.length === 0) {
        throw new Error('AI did not return valid combinations.');
      }

      console.log(`AI returned ${parsedCombinations.length} search combinations.`);

      const recommendPromises = parsedCombinations.map((combo) =>
        getDoubanRecommends({ kind: 'tv', ...combo, pageLimit: 50 }).then(
          (res) => res.list
        )
      );
      const recommendResults = await Promise.all(recommendPromises);
      const uniqueItems = new Map<string, DoubanItem>();
      recommendResults.flat().forEach((item) => {
        if (!uniqueItems.has(item.id)) {
          uniqueItems.set(item.id, item);
        }
      });
      candidateItems = Array.from(uniqueItems.values());
      console.log(`Found ${candidateItems.length} unique candidates from combinations.`);

    } catch (error) {
      console.error('Error in Stage 1 (AI Exploration). Falling back to Top 500 list.', error);
      candidateItems = await this.getDoubanTop500();
    }

    if (candidateItems.length === 0) {
      console.log('No candidates found. Returning empty list.');
      return [];
    }

    // Stage 2: AI Ranking
    try {
      console.log('Stage 2: AI ranking candidates...');
      const detailedItems = await Promise.all(
        candidateItems.map(async (item) => {
          const detail = await getDoubanDetail(item.id);
          return {
            id: item.id,
            title: item.title,
            intro: detail?.intro || 'No description available.',
          };
        })
      );

      const rankingPrompt = this.buildRankingPrompt(watchedTitles, detailedItems);
      const sortedIdsJson = await this.callOllama(aiConfig, rankingPrompt);
      const sortedIds = JSON.parse(sortedIdsJson);

      if (!Array.isArray(sortedIds)) {
        throw new Error('AI did not return a valid sorted list of IDs.');
      }

      console.log('Successfully received sorted list from AI.');
      const sortedMap = new Map(sortedIds.map((id, index) => [id, index]));

      const sortedList = [...candidateItems].sort((a, b) => {
        const aIndex = sortedMap.get(a.id);
        const bIndex = sortedMap.get(b.id);
        if (aIndex === undefined) return 1;
        if (bIndex === undefined) return -1;
        return aIndex - bIndex;
      });

      return sortedList;

    } catch (error) {
      console.error('Error in Stage 2 (AI Ranking). Returning candidates without final ranking.', error);
      return candidateItems; // Fallback to un-ranked but relevant list
    }
  }

  private async callOllama(aiConfig: { host: string; model?: string }, prompt: string): Promise<string> {
    const response = await fetch(`${aiConfig.host}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: aiConfig.model || 'qwen:7b',
        prompt: prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result.response;
  }

  private buildExplorationPrompt(watchedTitles: string[]): string {
    return `
      A user has watched the following TV shows: ${watchedTitles.join(', ')}.

      Analyze this user's viewing preferences. Based on your analysis, generate 2 to 3 diverse search-condition combinations to find new, interesting shows for them.

      Available search dimensions are:
      - category: "剧情", "喜剧", "动作", "爱情", "科幻", "悬疑", "惊悚", "恐怖", "犯罪"
      - region: "中国大陆", "美国", "香港", "台湾", "日本", "韩国", "英国", "法国"
      - year: "2024", "2023", "2020s", "2010s"
      - label: "经典", "高分", "冷门佳片", "HBO"

      Please return ONLY a valid JSON object in the following format:
      {
        "combinations": [
          { "category": "...", "region": "...", "year": "..." },
          { "label": "...", "category": "..." }
        ]
      }
    `.trim();
  }

  private buildRankingPrompt(
    watchedTitles: string[],
    candidates: { id: string; title: string; intro: string }[]
  ): string {
    return `
      A user's viewing history includes: ${watchedTitles.join(', ')}.

      Based on their preferences, please re-rank the following candidate TV shows, which we have pre-selected.

      Candidate TV shows with descriptions:
      ${candidates
        .map((c) => `- ID: ${c.id}, Title: ${c.title}, Intro: ${c.intro}`)
        .join('\n')}

      Please return ONLY a valid JSON array of strings, where each string is a TV show ID from the candidate list, sorted from most recommended to least recommended. For example: ["id1", "id2", "id3", ...].
    `.trim();
  }
}

export const discoverSort = new DiscoverSort();
