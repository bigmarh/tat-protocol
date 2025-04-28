/* 

Uncomment this to use FirebaseRTDBStorage


import { getDatabase, ref, set, get, remove } from "firebase/database";
import { StorageInterface } from "./StorageInterface";

export class FirebaseStorage implements StorageInterface {
  private db: any;
  private basePath: string;

  constructor(app: any, basePath: string = "nostr") {
    this.db = getDatabase(app);
    this.basePath = basePath;
  }

  private getFullPath(key: string): string {
    return `${this.basePath}/${key}`;
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const snapshot = await get(ref(this.db, this.getFullPath(key)));
      return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
      console.error("Error getting item from Firebase:", error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      await set(ref(this.db, this.getFullPath(key)), value);
    } catch (error) {
      console.error("Error setting item in Firebase:", error);
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      await remove(ref(this.db, this.getFullPath(key)));
    } catch (error) {
      console.error("Error removing item from Firebase:", error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await remove(ref(this.db, this.basePath));
    } catch (error) {
      console.error("Error clearing Firebase path:", error);
      throw error;
    }
  }
} */