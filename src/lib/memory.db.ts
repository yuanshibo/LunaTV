/* eslint-disable @typescript-eslint/no-unused-vars */
import { AdminConfig } from './admin.types';
import { IStorage, PlayRecord, Favorite, SkipConfig } from './types';

export class MemoryStorage implements IStorage {
  private data = new Map<string, any>();

  async getPlayRecord(userName: string, key: string): Promise<PlayRecord | null> {
    const userRecords = this.data.get(`playrecord_${userName}`) || {};
    return userRecords[key] || null;
  }

  async setPlayRecord(userName: string, key: string, record: PlayRecord): Promise<void> {
    const userRecords = this.data.get(`playrecord_${userName}`) || {};
    userRecords[key] = record;
    this.data.set(`playrecord_${userName}`, userRecords);
  }

  async getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }> {
    return this.data.get(`playrecord_${userName}`) || {};
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    const userRecords = this.data.get(`playrecord_${userName}`) || {};
    delete userRecords[key];
    this.data.set(`playrecord_${userName}`, userRecords);
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const userFavorites = this.data.get(`favorite_${userName}`) || {};
    return userFavorites[key] || null;
  }

  async setFavorite(userName: string, key: string, favorite: Favorite): Promise<void> {
    const userFavorites = this.data.get(`favorite_${userName}`) || {};
    userFavorites[key] = favorite;
    this.data.set(`favorite_${userName}`, userFavorites);
  }

  async getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }> {
    return this.data.get(`favorite_${userName}`) || {};
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    const userFavorites = this.data.get(`favorite_${userName}`) || {};
    delete userFavorites[key];
    this.data.set(`favorite_${userName}`, userFavorites);
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const users = this.data.get('users') || {};
    if (users[userName]) {
      throw new Error('User already exists');
    }
    users[userName] = password;
    this.data.set('users', users);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const users = this.data.get('users') || {};
    return users[userName] === password;
  }

  async checkUserExist(userName: string): Promise<boolean> {
    const users = this.data.get('users') || {};
    return !!users[userName];
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    const users = this.data.get('users') || {};
    if (!users[userName]) {
      throw new Error('User not found');
    }
    users[userName] = newPassword;
    this.data.set('users', users);
  }

  async deleteUser(userName: string): Promise<void> {
    const users = this.data.get('users') || {};
    delete users[userName];
    this.data.set('users', users);
    this.data.delete(`playrecord_${userName}`);
    this.data.delete(`favorite_${userName}`);
    this.data.delete(`searchhistory_${userName}`);
    this.data.delete(`skipconfig_${userName}`);
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    return this.data.get(`searchhistory_${userName}`) || [];
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const history = this.data.get(`searchhistory_${userName}`) || [];
    const newHistory = [keyword, ...history.filter((item: string) => item !== keyword)].slice(0, 100);
    this.data.set(`searchhistory_${userName}`, newHistory);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    if (keyword) {
      const history = (this.data.get(`searchhistory_${userName}`) || []).filter((item: string) => item !== keyword);
      this.data.set(`searchhistory_${userName}`, history);
    } else {
      this.data.set(`searchhistory_${userName}`, []);
    }
  }

  async getAllUsers(): Promise<string[]> {
    const users = this.data.get('users') || {};
    return Object.keys(users);
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    return this.data.get('adminconfig') || null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    this.data.set('adminconfig', config);
  }

  async getSkipConfig(userName: string, source: string, id: string): Promise<SkipConfig | null> {
    const userSkipConfigs = this.data.get(`skipconfig_${userName}`) || {};
    return userSkipConfigs[`${source}+${id}`] || null;
  }

  async setSkipConfig(userName: string, source: string, id: string, config: SkipConfig): Promise<void> {
    const userSkipConfigs = this.data.get(`skipconfig_${userName}`) || {};
    userSkipConfigs[`${source}+${id}`] = config;
    this.data.set(`skipconfig_${userName}`, userSkipConfigs);
  }

  async deleteSkipConfig(userName: string, source: string, id: string): Promise<void> {
    const userSkipConfigs = this.data.get(`skipconfig_${userName}`) || {};
    delete userSkipConfigs[`${source}+${id}`];
    this.data.set(`skipconfig_${userName}`, userSkipConfigs);
  }

  async getAllSkipConfigs(userName: string): Promise<{ [key: string]: SkipConfig }> {
    return this.data.get(`skipconfig_${userName}`) || {};
  }

  async clearAllData(): Promise<void> {
    this.data.clear();
  }

  async get(key: string): Promise<string | null> {
    return this.data.get(key) || null;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.data.set(key, value);
    if (ttl) {
      setTimeout(() => {
        this.data.delete(key);
      }, ttl * 1000);
    }
  }
}
