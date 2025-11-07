/* eslint-disable no-console */

import { getDoubanList } from './douban.client';
import { db } from './db';
import { DoubanItem } from './types';

// AI 排序核心逻辑
export class DiscoverSort {
  // 获取豆瓣 Top 500 数据
  private async getDoubanTop500(): Promise<DoubanItem[]> {
    console.log('Fetching Douban Top 500...');
    // '热门' tag includes top items.
    // Fetching 500 items by setting pageLimit to 500.
    const doubanResult = await getDoubanList({
      tag: '热门',
      type: 'tv',
      pageLimit: 500,
      pageStart: 0,
    });
    return doubanResult.list;
  }

  // 获取用户全部播放记录
  private async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, any>> {
    console.log(`Fetching play records for user: ${userName}...`);
    return db.getAllPlayRecords(userName);
  }

  // 计算播放权重
  private calculatePlayWeight(playRecord: any): number {
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
