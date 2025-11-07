/* eslint-disable no-console */

import { db } from './db';
import { getDoubanDetail, getDoubanList } from './douban.client';
import { DoubanItem } from './types';

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
  ): Promise<Record<string, { play_time: number; total_time: number }>> {
    console.log(`Fetching play records for user: ${userName}...`);
    return db.getAllPlayRecords(userName);
  }

  // AI-based sorting
  public async sort(userName: string): Promise<DoubanItem[]> {
    console.log(`Starting AI-based sorting for user: ${userName}...`);

    const adminConfig = await db.getAdminConfig();
    const aiConfig = adminConfig?.AiConfig;

    if (!aiConfig?.host) {
      console.log('AI host not configured. Skipping AI sorting.');
      return [];
    }

    const [doubanList, playRecords] = await Promise.all([
      this.getDoubanTop500(),
      this.getAllPlayRecords(userName),
    ]);

    if (Object.keys(playRecords).length === 0) {
      console.log('User has no play records. Returning original Douban list.');
      return doubanList;
    }

    console.log('Fetching details for candidate items...');
    const detailedItems = await Promise.all(
      doubanList.map(async (item) => {
        const detail = await getDoubanDetail(item.id);
        return {
          id: item.id,
          title: item.title,
          intro: detail?.intro || 'No description available.',
        };
      })
    );

    const watchedTitles = Object.values(playRecords).map((r: any) => r.title).filter(Boolean);

    const prompt = this.buildPrompt(watchedTitles, detailedItems);

    try {
      console.log('Calling Ollama API...');
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
        throw new Error(`Ollama API request failed: ${response.statusText}`);
      }

      const result = await response.json();
      const sortedIds = JSON.parse(result.response);

      if (!Array.isArray(sortedIds)) {
        throw new Error('AI did not return a valid sorted list of IDs.');
      }

      console.log('Successfully sorted list from AI.');

      const sortedList = sortedIds
        .map((id: string) => doubanList.find((item) => item.id === id))
        .filter((item): item is DoubanItem => !!item);

      // Add any remaining items from the original list that were not in the sorted list
      const remainingItems = doubanList.filter(
        (item) => !sortedIds.includes(item.id)
      );

      return [...sortedList, ...remainingItems];

    } catch (error) {
      console.error('Error during AI sorting:', error);
      // Fallback to the original list in case of AI error
      return doubanList;
    }
  }

  private buildPrompt(
    watchedTitles: string[],
    candidates: { id: string; title: string; intro: string }[]
  ): string {
    const prompt = `
      Here is a user's viewing history: ${watchedTitles.join(', ')}.

      Based on this history, please analyze their preferences and re-rank the following list of candidate TV shows. Provide a sorted list of IDs, from most recommended to least recommended.

      Candidate TV shows with descriptions:
      ${candidates
        .map((c) => `- ID: ${c.id}, Title: ${c.title}, Intro: ${c.intro}`)
        .join('\n')}

      Please return ONLY a valid JSON array of strings, where each string is a TV show ID from the candidate list, sorted by recommendation preference. For example: ["id1", "id2", "id3", ...].
    `;
    return prompt.trim();
  }
}

export const discoverSort = new DiscoverSort();
