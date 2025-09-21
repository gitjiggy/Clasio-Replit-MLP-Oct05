import { storage } from './storage.js';
import { analyzeDocumentContent } from './gemini.js';
import type { AiAnalysisQueue } from '../shared/schema.js';

/**
 * AI Queue Processor - The digital brain's scheduling system! 🧠⚡
 * 
 * This processor manages AI analysis requests with style, ensuring we stay within
 * Gemini 2.5 Flash-lite free tier limits while keeping users happy with funny updates!
 * 
 * Rate Limits:
 * - 15 requests per minute (RPM) - our AI needs breathing room! 
 * - 1,500 requests per day (RPD) - even digital brains need sleep! 😴
 * - Safety buffer: 1,200 requests/day to avoid hitting the ceiling
 */

class AIQueueProcessor {
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly REQUESTS_PER_MINUTE = 15;
  private readonly DAILY_REQUEST_LIMIT = 1200; // Safety buffer from 1500
  private readonly PROCESSING_INTERVAL_MS = 15000; // Check every 15 seconds
  private readonly RETRY_DELAY_MS = 60000; // 1 minute retry for failed requests
  private tokenBucket = 15; // Start with full bucket
  private lastTokenRefill = Date.now();

  constructor() {
    console.log('🚀 AI Queue Processor initialized! Ready to process documents with style!');
  }

  /**
   * Refill token bucket based on time elapsed - responsible AI usage! ⏰
   */
  private refillTokenBucket(): void {
    const now = Date.now();
    const timePassed = now - this.lastTokenRefill;
    const tokensToAdd = Math.floor(timePassed / (60000 / this.REQUESTS_PER_MINUTE)); // 15 tokens per minute
    
    if (tokensToAdd > 0) {
      this.tokenBucket = Math.min(this.REQUESTS_PER_MINUTE, this.tokenBucket + tokensToAdd);
      this.lastTokenRefill = now;
    }
  }

  /**
   * Start the queue processor - let the digital magic begin! ✨
   */
  public start(): void {
    // Only start if Gemini API key is available
    if (!process.env.GEMINI_API_KEY) {
      console.log('⏸️ AI Queue Processor not started - GEMINI_API_KEY not configured');
      return;
    }

    if (this.processingInterval) {
      console.log('🤖 AI Queue Processor is already running! No need to double-book our digital worker!');
      return;
    }

    console.log('🎭 Starting AI Queue Processor - preparing for document analysis extravaganza!');
    this.processingInterval = setInterval(() => {
      this.processQueue().catch(error => {
        console.error('💥 Queue processing hiccup:', error);
      });
    }, this.PROCESSING_INTERVAL_MS);
  }

  /**
   * Stop the queue processor - time for a coffee break! ☕
   */
  public stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      console.log('⏸️ AI Queue Processor stopped - our digital brain is taking a well-deserved break!');
    }
  }

  /**
   * Process the queue with intelligent rate limiting - the main show! 🎪
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      // Already processing, skip this cycle to avoid overwhelming our AI
      return;
    }

    try {
      this.isProcessing = true;

      // Refill token bucket based on time passed
      this.refillTokenBucket();

      // Check daily quota first - financial responsibility is key! 💰
      const today = new Date().toISOString().split('T')[0];
      const dailyUsageRecord = await storage.getDailyUsage(today);
      const dailyUsage = dailyUsageRecord?.requestCount || 0;
      
      if (dailyUsage >= this.DAILY_REQUEST_LIMIT) {
        console.log(`🛑 Daily quota reached (${dailyUsage}/${this.DAILY_REQUEST_LIMIT})! Our AI is resting until tomorrow! 😴`);
        return;
      }

      // Only process if we have tokens available - respect the rate limit! 
      if (this.tokenBucket <= 0) {
        return; // No tokens available, wait for refill
      }

      // Get next job (only one at a time to respect rate limits)
      const nextJob = await storage.dequeueNextAnalysisJob();
      if (!nextJob) {
        return; // No jobs available
      }

      // Consume a token
      this.tokenBucket--;

      try {
        console.log(`🎨 Starting AI analysis for document ${nextJob.documentId} (Priority: ${nextJob.priority})`);
        
        // Get document details for analysis
        const document = await storage.getDocumentById(nextJob.documentId);
        if (!document) {
          throw new Error(`Document ${nextJob.documentId} not found - it seems to have vanished! 🎭`);
        }

        // Get document content for analysis
        const content = await storage.getDocumentContent(nextJob.documentId);
        if (!content) {
          throw new Error(`No content available for document ${nextJob.documentId}`);
        }

        // Perform the magical AI analysis! ✨
        const analysisResult = await analyzeDocumentContent(content);
        
        if (analysisResult) {
          // Update document with AI insights using updateDocument
          await storage.updateDocument(nextJob.documentId, {
            aiSummary: `${analysisResult.conciseTitle} - Key topics: ${analysisResult.keyTopics.join(', ')}`,
            aiKeyTopics: analysisResult.keyTopics,
            aiDocumentType: analysisResult.documentType,
            aiCategory: analysisResult.category,
            aiConciseName: analysisResult.conciseTitle,
            aiCategoryConfidence: analysisResult.categoryConfidence,
            aiDocumentTypeConfidence: analysisResult.documentTypeConfidence,
            aiWordCount: analysisResult.wordCount,
            aiAnalyzedAt: new Date()
          });
          
          // Mark queue item as completed with celebration! 🎉
          await storage.updateQueueJobStatus(nextJob.id, 'completed', 'AI analysis completed successfully! 🎉');
          
          // Track usage for quota management - exactly 1 request per analysis
          await storage.incrementDailyUsage(today, 1, true);
          
          console.log(`✅ AI analysis completed for document ${nextJob.documentId}! Digital insights delivered! 🧠✨`);
        } else {
          throw new Error('AI analysis returned empty results - our digital brain needs more coffee! ☕');
        }
      } catch (error) {
        console.error(`❌ AI analysis failed for document ${nextJob.documentId}:`, error);
        
        // Handle retries with grace and humor
        const newRetryCount = nextJob.retryCount + 1;
        const maxRetries = 3; // Three strikes and you're out!
        
        if (newRetryCount <= maxRetries) {
          // Schedule retry - the retry timing and count management should be handled by storage layer
          const errorMessage = `Retry ${newRetryCount}/${maxRetries}: ${error instanceof Error ? error.message : String(error)}`;
          
          await storage.updateQueueJobStatus(nextJob.id, 'pending', errorMessage);
          console.log(`🔄 Scheduling retry ${newRetryCount}/${maxRetries} for document ${nextJob.documentId}`);
        } else {
          // Max retries exceeded - time to give up gracefully
          await storage.updateQueueJobStatus(nextJob.id, 'failed', `Max retries exceeded: ${error instanceof Error ? error.message : String(error)}`);
          console.log(`💔 Max retries exceeded for document ${nextJob.documentId} - sometimes even digital magic has limits!`);
        }
      }

    } catch (error) {
      console.error('🚨 Queue processor encountered an unexpected error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get processor status - transparency is key! 📊
   */
  public getStatus(): { isRunning: boolean; isProcessing: boolean; tokensAvailable: number } {
    this.refillTokenBucket(); // Update token count before reporting
    return {
      isRunning: this.processingInterval !== null,
      isProcessing: this.isProcessing,
      tokensAvailable: this.tokenBucket
    };
  }

  /**
   * Process a specific document immediately (for priority requests) - VIP service! 👑
   */
  public async processDocumentImmediately(documentId: string, userId: string): Promise<boolean> {
    try {
      console.log(`⚡ Processing document ${documentId} immediately - VIP treatment activated!`);
      
      // Check daily quota
      const today = new Date().toISOString().split('T')[0];
      const dailyUsageRecord = await storage.getDailyUsage(today);
      const dailyUsage = dailyUsageRecord?.requestCount || 0;
      
      if (dailyUsage >= this.DAILY_REQUEST_LIMIT) {
        console.log(`🛑 Cannot process immediately - daily quota reached! Even VIPs must respect the limits! 😅`);
        return false;
      }

      // Check rate limit
      this.refillTokenBucket();
      if (this.tokenBucket <= 0) {
        console.log(`⏰ Cannot process immediately - rate limit reached! Even VIPs must wait for tokens!`);
        return false;
      }

      // Consume a token
      this.tokenBucket--;

      // Get document details
      const document = await storage.getDocumentById(documentId);
      if (!document) {
        console.error(`📄 Document ${documentId} not found for immediate processing!`);
        return false;
      }

      // Get document content for analysis
      const content = await storage.getDocumentContent(documentId);
      if (!content) {
        console.error(`📄 No content available for document ${documentId}`);
        return false;
      }

      // Perform AI analysis
      const analysisResult = await analyzeDocumentContent(content);
      
      if (analysisResult) {
        // Update document with results
        await storage.updateDocument(documentId, {
          aiSummary: `${analysisResult.conciseTitle} - Key topics: ${analysisResult.keyTopics.join(', ')}`,
          aiKeyTopics: analysisResult.keyTopics,
          aiDocumentType: analysisResult.documentType,
          aiCategory: analysisResult.category,
          aiConciseName: analysisResult.conciseTitle,
          aiCategoryConfidence: analysisResult.categoryConfidence,
          aiDocumentTypeConfidence: analysisResult.documentTypeConfidence,
          aiWordCount: analysisResult.wordCount,
          aiAnalyzedAt: new Date()
        });
        
        // Track usage - exactly 1 request per analysis
        await storage.incrementDailyUsage(today, 1, true);
        
        console.log(`🎯 Immediate processing completed for document ${documentId}! Lightning-fast AI magic! ⚡`);
        return true;
      } else {
        console.error(`🤔 AI analysis failed for immediate processing of document ${documentId}`);
        return false;
      }
    } catch (error) {
      console.error(`💥 Immediate processing failed for document ${documentId}:`, error);
      return false;
    }
  }
}

// Create singleton instance - one processor to rule them all! 💍
export const aiQueueProcessor = new AIQueueProcessor();

// Graceful shutdown handling - even robots need proper goodbyes! 👋
process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT - shutting down AI Queue Processor gracefully...');
  aiQueueProcessor.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM - shutting down AI Queue Processor gracefully...');
  aiQueueProcessor.stop();
  process.exit(0);
});