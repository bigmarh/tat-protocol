import { Storage, Bucket } from '@google-cloud/storage';
import { StorageInterface } from './StorageInterface.js';
import { DebugLogger } from '@tat-protocol/utils';

const Debug = DebugLogger.getInstance();

/**
 * Google Cloud credentials interface
 */
interface GoogleCloudCredentials {
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
}

export class GoogleCloudStorage implements StorageInterface {
  private bucket: Bucket;
  private prefix: string;

  constructor(bucketName: string, prefix: string = '', credentials?: GoogleCloudCredentials) {
    const storage = new Storage({ credentials });
    this.bucket = storage.bucket(bucketName);
    this.prefix = prefix;
  }

  private getFullKey(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const file = this.bucket.file(this.getFullKey(key));
      const [exists] = await file.exists();

      if (!exists) {
        return null;
      }

      const [content] = await file.download();
      return content.toString();
    } catch (error) {
      Debug.error('Error getting item from Google Cloud Storage:' + error, 'GoogleCloudStorage');
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      const file = this.bucket.file(this.getFullKey(key));
      await file.save(value, {
        contentType: 'application/json',
      });
    } catch (error) {
      Debug.error('Error saving item to Google Cloud Storage:' + error, 'GoogleCloudStorage');
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      const file = this.bucket.file(this.getFullKey(key));
      await file.delete();
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as any).code !== 404) {
        throw error;
      }
    }
  }

  async clear(): Promise<void> {
    // Delete all files with the prefix
    try {
      if (this.prefix) {
        // Delete only files with the prefix
        await this.bucket.deleteFiles({
          prefix: this.prefix,
        });
      } else {
        // Delete all files in the bucket
        await this.bucket.deleteFiles();
      }
    } catch (error) {
      Debug.error('Error clearing Google Cloud Storage:' + error, 'GoogleCloudStorage');
      throw error;
    }
  }
}
