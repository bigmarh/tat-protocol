/* 

Uncomment this to use RedisStorage


import { createClient, RedisClientType } from "redis";
import { StorageInterface } from "./StorageInterface";

export class RedisStorage implements StorageInterface {
  private client: RedisClientType;
  private prefix: string;

  constructor(redisUrl: string = "redis://localhost:6379", prefix: string = "nostr:") {
    this.client = createClient({ url: redisUrl });
    this.prefix = prefix;
    this.connect();
  }

  private async connect() {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async getItem(key: string): Promise<string | null> {
    try {
      await this.connect();
      return await this.client.get(this.getFullKey(key));
    } catch (error) {
      console.error("Error getting item from Redis:", error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      await this.connect();
      await this.client.set(this.getFullKey(key), value);
    } catch (error) {
      console.error("Error setting item in Redis:", error);
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      await this.connect();
      await this.client.del(this.getFullKey(key));
    } catch (error) {
      console.error("Error removing item from Redis:", error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.connect();
      // Find all keys with the prefix and delete them
      const keys = await this.client.keys(`${this.prefix}*`);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } catch (error) {
      console.error("Error clearing Redis keys:", error);
      throw error;
    }
  }
} */
