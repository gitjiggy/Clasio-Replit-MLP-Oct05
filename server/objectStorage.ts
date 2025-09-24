import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";

// GCS Configuration and Client Setup
function initializeGCSClient(): Storage | null {
  const projectId = process.env.GCP_PROJECT_ID;
  const serviceAccountKey = process.env.GCP_SERVICE_ACCOUNT_KEY;

  // Gracefully handle missing credentials during development
  if (!projectId || !serviceAccountKey) {
    console.warn("⚠️  GCS credentials not found. Storage operations will be disabled.");
    console.warn("   Required env vars: GCP_PROJECT_ID, GCP_SERVICE_ACCOUNT_KEY");
    console.warn("   Please check your Replit secrets configuration.");
    return null;
  }

  try {
    // Parse the service account JSON key
    const credentials = JSON.parse(serviceAccountKey);
    
    console.log("✅ GCS client initialized successfully");
    return new Storage({
      projectId,
      credentials,
    });
  } catch (error) {
    console.error("❌ Failed to initialize GCS client:", error);
    throw new StorageAuthError("Invalid service account key format");
  }
}

// Initialize the GCS client with Clasio's credentials (can be null during development)
export const objectStorageClient = initializeGCSClient();

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class StorageAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageAuthError";
    Object.setPrototypeOf(this, StorageAuthError.prototype);
  }
}

export class StorageTempUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageTempUnavailableError";
    Object.setPrototypeOf(this, StorageTempUnavailableError.prototype);
  }
}

// Object Path Generation Functions
export function generateDocumentPath(userId: string, docId: string, originalFileName: string): string {
  return `users/${userId}/docs/${docId}/${originalFileName}`;
}

export function generatePreviewPath(userId: string, docId: string): string {
  return `users/${userId}/previews/${docId}.jpg`;
}

export function generateMetadataPath(userId: string, docId: string): string {
  return `users/${userId}/metadata/${docId}.json`;
}

export function generateEmbeddingPath(docId: string): string {
  return `system/embeddings/${docId}.json`;
}

export function generateTempUploadPath(): string {
  return `temp/uploads/${randomUUID()}`;
}

// Retry configuration for transient errors
interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 200,
};

// Helper function to implement exponential backoff retry
async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  operationName: string = "operation"
): Promise<T> {
  let lastError: Error = new Error("Unknown error");
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Check if this is an auth error (don't retry)
      if (error.code === 'ENOTFOUND' || error.message?.includes('auth') || error.message?.includes('credentials')) {
        throw new StorageAuthError(`Storage authentication failed: ${error.message}`);
      }
      
      // Log the retry attempt
      console.warn(`${operationName} failed (attempt ${attempt}/${config.maxAttempts}):`, error.message);
      
      // Don't wait after the last attempt
      if (attempt < config.maxAttempts) {
        const delay = config.baseDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`Retrying ${operationName} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // All retries exhausted
  console.error(`${operationName} failed after ${config.maxAttempts} attempts:`, lastError);
  throw new StorageTempUnavailableError(`Storage temporarily unavailable. Please try again shortly.`);
}

// The object storage service using Clasio's GCS bucket
export class ObjectStorageService {
  private bucketName: string;

  // Configure CORS for the bucket to allow direct uploads from browsers
  private async setupBucketCors(): Promise<void> {
    try {
      if (!objectStorageClient) {
        console.warn("⚠️ GCS client not available, skipping CORS setup");
        return;
      }
      
      const bucket = objectStorageClient.bucket(this.bucketName);
      
      // CORS configuration to allow direct uploads from the web application
      const corsConfiguration = [{
        origin: ['*'], // Allow all origins for development; restrict in production
        method: ['GET', 'PUT', 'POST', 'HEAD'],
        responseHeader: ['Content-Type', 'Content-Length', 'ETag'],
        maxAgeSeconds: 3600
      }];

      await bucket.setCorsConfiguration(corsConfiguration);
      console.log(`✅ CORS configured for bucket: ${this.bucketName}`);
    } catch (error) {
      console.warn(`⚠️ Could not configure CORS for bucket: ${error}`);
      // Don't throw - this is a best-effort setup
    }
  }

  constructor() {
    this.bucketName = process.env.GCS_BUCKET_NAME || "development-bucket";
    this.setupBucketCors(); // Configure CORS for direct uploads
    if (!process.env.GCS_BUCKET_NAME) {
      console.warn("⚠️  GCS_BUCKET_NAME not found, using placeholder bucket name");
    }
  }

  // Get the GCS bucket instance
  private getBucket() {
    if (!objectStorageClient) {
      throw new StorageAuthError("GCS client not initialized - check your credentials");
    }
    return objectStorageClient.bucket(this.bucketName);
  }

  // Generate a V4 signed URL for downloads (1 hour TTL)
  async generateDownloadURL(objectPath: string, originalFileName?: string): Promise<string> {
    const bucket = this.getBucket();
    const file = bucket.file(objectPath);

    const options = {
      version: 'v4' as const,
      action: 'read' as const,
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
      responseDisposition: originalFileName ? `attachment; filename="${originalFileName}"` : undefined,
    };

    return withRetry(async () => {
      const [signedUrl] = await file.getSignedUrl(options);
      return signedUrl;
    }, DEFAULT_RETRY_CONFIG, `generateDownloadURL for ${objectPath}`);
  }

  // Generate a V4 signed URL for uploads (15 minutes TTL)
  async generateUploadURL(objectPath: string, contentType: string): Promise<string> {
    const bucket = this.getBucket();
    const file = bucket.file(objectPath);

    const options = {
      version: 'v4' as const,
      action: 'write' as const,
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType,
    };

    return withRetry(async () => {
      const [signedUrl] = await file.getSignedUrl(options);
      return signedUrl;
    }, DEFAULT_RETRY_CONFIG, `generateUploadURL for ${objectPath}`);
  }

  // Check if an object exists
  async objectExists(objectPath: string): Promise<boolean> {
    const bucket = this.getBucket();
    const file = bucket.file(objectPath);

    return withRetry(async () => {
      const [exists] = await file.exists();
      return exists;
    }, DEFAULT_RETRY_CONFIG, `objectExists for ${objectPath}`);
  }

  // Delete an object
  async deleteObject(objectPath: string): Promise<void> {
    const bucket = this.getBucket();
    const file = bucket.file(objectPath);

    return withRetry(async () => {
      await file.delete();
    }, DEFAULT_RETRY_CONFIG, `deleteObject for ${objectPath}`);
  }

  // Stream download an object directly to response
  async downloadObject(objectPathOrFile: string | File, res: Response, originalFileName?: string): Promise<void> {
    let file: File;
    let objectPath: string;

    if (typeof objectPathOrFile === 'string') {
      const bucket = this.getBucket();
      file = bucket.file(objectPathOrFile);
      objectPath = objectPathOrFile;
    } else {
      file = objectPathOrFile;
      objectPath = file.name;
    }

    return withRetry(async () => {
      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        throw new ObjectNotFoundError();
      }

      // Get file metadata
      const [metadata] = await file.getMetadata();
      
      // Set appropriate headers
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": originalFileName 
          ? `attachment; filename="${originalFileName}"` 
          : "attachment",
      });

      // Stream the file to the response
      const stream = file.createReadStream();

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    }, DEFAULT_RETRY_CONFIG, `downloadObject for ${objectPath}`);
  }

  // Get object content as Buffer for AI processing
  async getObjectBuffer(objectPath: string): Promise<Buffer> {
    const bucket = this.getBucket();
    const file = bucket.file(objectPath);

    return withRetry(async () => {
      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        throw new ObjectNotFoundError();
      }

      const stream = file.createReadStream();
      
      const chunks: Buffer[] = [];
      return new Promise<Buffer>((resolve, reject) => {
        stream.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        stream.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
        
        stream.on('error', (error) => {
          console.error("Error reading object stream:", error);
          reject(error);
        });
      });
    }, DEFAULT_RETRY_CONFIG, `getObjectBuffer for ${objectPath}`);
  }

  // Upload file buffer to GCS
  async uploadFileBuffer(buffer: Buffer, objectPath: string, contentType?: string): Promise<void> {
    const bucket = this.getBucket();
    const file = bucket.file(objectPath);

    return withRetry(async () => {
      const stream = file.createWriteStream({
        metadata: {
          contentType: contentType || 'application/octet-stream',
        },
      });

      return new Promise<void>((resolve, reject) => {
        stream.on('error', (error) => {
          console.error("Error uploading file:", error);
          reject(error);
        });

        stream.on('finish', () => {
          console.log(`✅ File uploaded successfully to: ${objectPath}`);
          resolve();
        });

        stream.end(buffer);
      });
    }, DEFAULT_RETRY_CONFIG, `uploadFileBuffer to ${objectPath}`);
  }

  // Get a file object by its path  
  getFile(objectPath: string): File {
    const bucket = this.getBucket();
    return bucket.file(objectPath);
  }

  // Legacy compatibility methods for existing route handlers
  async getObjectEntityFile(objectPath: string): Promise<File> {
    const bucket = this.getBucket();
    return bucket.file(objectPath);
  }

  async getObjectEntityUploadURL(userId?: string, originalFileName?: string, contentType?: string): Promise<{ uploadURL: string; objectPath: string; docId?: string }> {
    // Enforce canonical path structure - no temp path fallbacks
    if (!userId) {
      throw new StorageAuthError("userId is required for canonical object path generation");
    }
    
    if (!originalFileName) {
      throw new Error("originalFileName is required for canonical object path generation");
    }
    
    // Generate proper document path using the user ID and file name
    const docId = randomUUID();
    const objectPath = generateDocumentPath(userId, docId, originalFileName);
    
    const uploadURL = await this.generateUploadURL(objectPath, contentType || "application/octet-stream");
    
    return {
      uploadURL,
      objectPath,
      docId
    };
  }

  normalizeObjectEntityPath(objectPath: string): string {
    // Remove leading slashes and normalize the path
    return objectPath.replace(/^\/+/, '').replace(/\/+/g, '/');
  }

  // Validate that an object path follows the canonical structure and belongs to the user
  validateCanonicalObjectPath(objectPath: string, userId: string, originalFileName?: string): { isValid: boolean; error?: string } {
    // Expected pattern: users/{userId}/docs/{docId}/{originalFileName}
    const canonicalPattern = /^users\/([a-zA-Z0-9_-]+)\/docs\/([a-f0-9-]{36})\/(.+)$/;
    const match = objectPath.match(canonicalPattern);
    
    if (!match) {
      return { 
        isValid: false, 
        error: "Object path must follow format: users/{userId}/docs/{docId}/{originalFileName}" 
      };
    }
    
    const [, pathUserId, docId, pathFileName] = match;
    
    // Verify the path belongs to the authenticated user
    if (pathUserId !== userId) {
      return { 
        isValid: false, 
        error: "Object path userId does not match authenticated user" 
      };
    }
    
    // Verify the filename matches if provided
    if (originalFileName && pathFileName !== originalFileName) {
      return { 
        isValid: false, 
        error: "Object path filename does not match provided originalFileName" 
      };
    }
    
    return { isValid: true };
  }
}
