/*

Uncomment this code block to use FirebaseRTDBStorage

import { getDatabase, ref, set, get, remove } from "firebase/database";
import { StorageInterface } from "./StorageInterface.js";
import { DebugLogger } from "@tat-protocol/utils";

const Debug = DebugLogger.getInstance();

// Firebase app interface
interface FirebaseApp {
  database?(): FirebaseDatabase;
  [key: string]: unknown;
}

// Firebase database interface
interface FirebaseDatabase {
  ref(path: string): unknown;
  [key: string]: unknown;
}

export class FirebaseStorage implements StorageInterface {
  private db: FirebaseDatabase;
  private basePath: string;

  constructor(app: FirebaseApp, basePath: string = "nostr") {
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
      Debug.error("Error getting item from Firebase:" + error, 'FirebaseStorage');
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      await set(ref(this.db, this.getFullPath(key)), value);
    } catch (error) {
      Debug.error("Error setting item in Firebase:" + error, 'FirebaseStorage');
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      await remove(ref(this.db, this.getFullPath(key)));
    } catch (error) {
      Debug.error("Error removing item from Firebase:" + error, 'FirebaseStorage');
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await remove(ref(this.db, this.basePath));
    } catch (error) {
      Debug.error("Error clearing Firebase path:" + error, 'FirebaseStorage');
      throw error;
    }
  }
}

*/
