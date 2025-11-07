/* eslint-disable no-console */

import { db } from './db';
import { getDoubanList } from './douban.client';
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

    console.log('Fetching Douban Top 500...');
    const doubanResult = await getDoubanList({
      tag: '热门',
      type: 'tv',
      pageLimit: 500,
      pageStart: 0,
    });

    if (doubanResult.list && doubanResult.list.length > 0) {
      // 缓存24小时
      await db.setGlobalCache(cacheKey, doubanResult.list, 60 * 60 * 24);
    }

    return doubanResult.list;
  }

  // 获取用户全部播放记录
  private async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, { play_time: number; total_time: number }>> {
    console.log(`Fetching play records for user: ${userName}...`);
    return db.getAllPlayRecords(userName);
  }

  // 计算播放权重
  private calculatePlayWeight(playRecord: {
    play_time: number;
    total_time: number;
  }): number {
    if (!playRecord || !playRecord.total_time) {
      return 0;
    }
    return (playRecord.play_time || 0) / playRecord.total_time;
  }

  // 排序
  public async sort(userName: string): Promise<DoubanItem[]> {
    console.log('Sorting discover content...');
    const [doubanList, playRecords] = await Promise.all([
      this.getDoubanTop500(),
      this.getAllPlayRecords(userName),
    ]);

    const playWeights: Record<string, number> = {};
    for (const key in playRecords) {
      playWeights[key] = this.calculatePlayWeight(playRecords[key]);
    }

    doubanList.sort((a, b) => {
      const weightA = playWeights[a.id] || 0;
      const weightB = playWeights[b.id] || 0;
      return weightB - weightA;
    });

    return doubanList;
  }
}

export const discoverSort = new DiscoverSort();
