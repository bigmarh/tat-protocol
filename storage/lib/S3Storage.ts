/* 

Uncomment this to use S3Storage


import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { StorageInterface } from "./StorageInterface";

export class S3Storage implements StorageInterface {
  private client: S3Client;
  private bucketName: string;
  private prefix: string;

  constructor(bucketName: string, region: string = "us-east-1", prefix: string = "") {
    this.client = new S3Client({ region });
    this.bucketName = bucketName;
    this.prefix = prefix;
  }

  private getFullKey(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: this.getFullKey(key),
      });

      const response = await this.client.send(command);
      
      if (!response.Body) {
        return null;
      }

      // Convert stream to string
      const streamReader = response.Body.transformToString();
      return streamReader;
    } catch (error) {
      // If the object doesn't exist, return null
      if ((error as any).name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: this.getFullKey(key),
      Body: value,
      ContentType: "application/json",
    });

    await this.client.send(command);
  }

  async removeItem(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: this.getFullKey(key),
    });

    await this.client.send(command);
  }

  async clear(): Promise<void> {
    // Note: S3 doesn't have a direct "clear bucket" operation
    // You would need to list all objects and delete them
    // This is a simplified implementation
    throw new Error("Clear operation not implemented. Use AWS SDK's DeleteObjects command to delete multiple objects.");
  }
} */