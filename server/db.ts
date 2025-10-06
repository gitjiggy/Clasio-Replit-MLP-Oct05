import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Configure connection pool with production-optimized settings for Neon
const isProduction = process.env.NODE_ENV === 'production';

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool (increased for background jobs)
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: isProduction ? 15000 : 5000, // Higher timeout for production (15s vs 5s)
  maxUses: 7500, // Close (and replace) a connection after it has been used 7500 times
  allowExitOnIdle: false, // Don't exit the process when all connections are idle
  // Add statement timeout to prevent long-running queries from blocking the pool
  statement_timeout: isProduction ? 30000 : 10000, // 30s in production, 10s in dev
});

// Enhanced error handling with automatic pool recovery
let poolErrorCount = 0;
const MAX_POOL_ERRORS = 5;

pool.on('error', (err: Error, client: any) => {
  console.error('Pool error on idle client:', err.message);
  poolErrorCount++;
  
  // If we get too many pool errors, attempt recovery
  if (poolErrorCount >= MAX_POOL_ERRORS) {
    console.warn(`⚠️  Pool has encountered ${poolErrorCount} errors. Resetting error count...`);
    poolErrorCount = 0; // Reset counter to allow continued operation
  }
});

// Add connect event to track successful connections
pool.on('connect', () => {
  // Reset error count on successful connections
  if (poolErrorCount > 0) {
    console.log('✅ Pool connection established, resetting error count');
    poolErrorCount = 0;
  }
});

export const db = drizzle({ client: pool, schema });

// Helper function to execute queries with timeout and retry logic
export async function executeWithTimeout<T>(
  queryFn: () => Promise<T>,
  timeoutMs: number = 5000,
  retries: number = 2
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout')), timeoutMs);
      });
      
      return await Promise.race([queryFn(), timeoutPromise]);
    } catch (error) {
      const isLastAttempt = attempt === retries;
      const isTimeoutError = error instanceof Error && error.message === 'Query timeout';
      
      if (isLastAttempt || !isTimeoutError) {
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  
  throw new Error('All retry attempts failed');
}
