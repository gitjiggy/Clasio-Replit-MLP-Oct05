import { storage } from './storage.js';
import { analyzeDocumentContent, generateEmbedding, serializeEmbeddingToJSON } from './gemini.js';
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
  private readonly REQUESTS_PER_MINUTE = 15; // Free tier limit - respect the limits!
  private readonly DAILY_REQUEST_LIMIT = 1200; // Safety buffer from 1500
  private readonly PROCESSING_INTERVAL_MS = 5000; // Check every 5 seconds (faster processing)
  private readonly RETRY_DELAY_MS = 60000; // 1 minute retry for failed requests
  private tokenBucket = 15; // Start with full bucket (matches REQUESTS_PER_MINUTE)
  private lastTokenRefill = Date.now();

  constructor() {
    // AI Queue Processor initialized
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
      console.log('AI Queue Processor not started - GEMINI_API_KEY not configured');
      return;
    }

    if (this.processingInterval) {
      console.log('AI Queue Processor is already running');
      return;
    }

    console.log('Starting AI Queue Processor');
    this.processingInterval = setInterval(() => {
      this.processQueue().catch(error => {
        console.error('Queue processing error:', error);
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
      console.log('AI Queue Processor stopped');
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
        console.log(`Daily quota reached (${dailyUsage}/${this.DAILY_REQUEST_LIMIT})`);
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
        // Processing document ${nextJob.documentId} for ${nextJob.jobType}
        console.log(`Processing job type: ${nextJob.jobType} for document ${nextJob.documentId}`);
        
        // Get document details
        const document = await storage.getDocumentById(nextJob.documentId, nextJob.userId);
        if (!document) {
          throw new Error(`Document ${nextJob.documentId} not found`);
        }

        if (nextJob.jobType === 'embedding_generation') {
          // EMBEDDING GENERATION JOB
          console.log(`📊 Generating embeddings for document: ${document.name}`);
          
          // Check if embeddings already exist
          if (document.embeddingsGenerated) {
            console.log(`Document ${nextJob.documentId} already has embeddings, marking as completed`);
            await storage.updateQueueJobStatus(nextJob.id, 'completed', 'Embeddings already exist');
            await storage.incrementDailyUsage(today, 0, true); // No API usage
            return;
          }

          // Get document content for embedding generation
          const content = await storage.getDocumentContent(nextJob.documentId, nextJob.userId);
          if (!content || content.trim().length === 0) {
            console.warn(`No content available for embedding generation: ${document.name}`);
            await storage.updateQueueJobStatus(nextJob.id, 'completed', 'No content available for embeddings');
            return;
          }

          // Generate embeddings for different text components
          const titleText = document.name || '';
          const summaryText = document.aiSummary || '';
          const keyTopicsText = (document.aiKeyTopics || []).join(' ');
          
          // Generate embeddings with retry logic
          let titleEmbedding: number[] | null = null;
          let contentEmbedding: number[] | null = null;
          let summaryEmbedding: number[] | null = null;
          let keyTopicsEmbedding: number[] | null = null;
          let apiCalls = 0;

          try {
            // Title embedding
            if (titleText.trim().length > 0) {
              titleEmbedding = await generateEmbedding(titleText, 'RETRIEVAL_DOCUMENT');
              apiCalls++;
            }

            // Content embedding (truncate if too long to avoid token limits)
            const truncatedContent = content.length > 8000 ? content.substring(0, 8000) + '...' : content;
            contentEmbedding = await generateEmbedding(truncatedContent, 'RETRIEVAL_DOCUMENT');
            apiCalls++;

            // Summary embedding (if available)
            if (summaryText.trim().length > 0) {
              summaryEmbedding = await generateEmbedding(summaryText, 'RETRIEVAL_DOCUMENT');
              apiCalls++;
            }

            // Key topics embedding (if available)
            if (keyTopicsText.trim().length > 0) {
              keyTopicsEmbedding = await generateEmbedding(keyTopicsText, 'RETRIEVAL_DOCUMENT');
              apiCalls++;
            }

            // Update document with embeddings
            await storage.updateDocument(nextJob.documentId, {
              titleEmbedding: titleEmbedding ? serializeEmbeddingToJSON(titleEmbedding) : null,
              contentEmbedding: contentEmbedding ? serializeEmbeddingToJSON(contentEmbedding) : null,
              summaryEmbedding: summaryEmbedding ? serializeEmbeddingToJSON(summaryEmbedding) : null,
              keyTopicsEmbedding: keyTopicsEmbedding ? serializeEmbeddingToJSON(keyTopicsEmbedding) : null,
              embeddingsGenerated: true,
              embeddingsGeneratedAt: new Date()
            }, nextJob.userId);

            console.log(`📊 Generated ${apiCalls} embeddings for document: ${document.name}`);
            await storage.updateQueueJobStatus(nextJob.id, 'completed', `Generated ${apiCalls} embeddings successfully`);
            await storage.incrementDailyUsage(today, apiCalls, true);
            
          } catch (embeddingError) {
            console.error(`Failed to generate embeddings for ${document.name}:`, embeddingError);
            throw embeddingError;
          }

        } else if (nextJob.jobType === 'content_extraction') {
          // CONTENT EXTRACTION JOB (background processing)
          console.log(`📄 Extracting content for document: ${document.name}`);
          
          // Check if content already extracted
          if (document.contentExtracted) {
            console.log(`Document ${nextJob.documentId} already has content extracted, marking as completed`);
            await storage.updateQueueJobStatus(nextJob.id, 'completed', 'Content already extracted');
            return;
          }

          try {
            // Extract document content
            const extractionSuccess = await storage.extractDocumentContent(nextJob.documentId, nextJob.userId);
            
            if (extractionSuccess) {
              console.log(`✅ Content extracted successfully for: ${document.name}`);
              await storage.updateQueueJobStatus(nextJob.id, 'completed', 'Content extraction completed successfully');
            } else {
              console.warn(`⚠️ Content extraction failed for: ${document.name}`);
              await storage.updateQueueJobStatus(nextJob.id, 'failed', 'Content extraction failed');
            }
          } catch (extractionError) {
            console.error(`❌ Content extraction error for "${document.name}":`, extractionError);
            throw extractionError;
          }

        } else {
          // DOCUMENT ANALYSIS JOB (existing logic)
          console.log(`🔍 Analyzing document: ${document.name}`);
          
          // Get document content for analysis
          const content = await storage.getDocumentContent(nextJob.documentId, nextJob.userId);
          if (!content) {
            throw new Error(`No content available for document ${nextJob.documentId}`);
          }

          // Perform the magical AI analysis! ✨
          const analysisResult = await analyzeDocumentContent(content);
          
          if (analysisResult) {
            // Generate proper 2-3 line English summary for AI Analysis section
            const { summarizeDocument } = await import('./gemini.js');
            const properSummary = await summarizeDocument(content);
            
            // Update document with AI insights using updateDocument
            await storage.updateDocument(nextJob.documentId, {
              aiSummary: properSummary,
              aiKeyTopics: analysisResult.keyTopics,
              aiDocumentType: analysisResult.documentType,
              aiCategory: analysisResult.category,
              aiConciseName: analysisResult.conciseTitle,
              aiCategoryConfidence: analysisResult.categoryConfidence,
              aiDocumentTypeConfidence: analysisResult.documentTypeConfidence,
              aiWordCount: analysisResult.wordCount,
              aiAnalyzedAt: new Date()
            }, nextJob.userId);
            
            // 🗂️ SMART ORGANIZATION: Automatically organize document into appropriate folder
            try {
              if (analysisResult.category && analysisResult.documentType) {
                const organized = await storage.organizeDocumentIntoFolder(
                  nextJob.documentId, 
                  analysisResult.category, 
                  analysisResult.documentType,
                  nextJob.userId
                );
                if (organized) {
                  console.log(`✅ Smart Organization: "${document.name}" → ${analysisResult.category}/${analysisResult.documentType}`);
                } else {
                  console.warn(`⚠️ Smart Organization failed for "${document.name}"`);
                }
              }
            } catch (orgError) {
              // Don't fail the entire analysis if organization fails
              console.error(`❌ Smart Organization error for "${document.name}":`, orgError);
            }
            
            // Mark queue item as completed with celebration! 🎉
            await storage.updateQueueJobStatus(nextJob.id, 'completed', 'AI analysis completed successfully');
            
            // Track usage for quota management - exactly 1 request per analysis
            await storage.incrementDailyUsage(today, 1, true);
            
            // 📊 AUTO-ENQUEUE EMBEDDING GENERATION: After analysis is complete, queue for embedding generation
            try {
              if (!document.embeddingsGenerated) {
                console.log(`📊 Auto-enqueueing embedding generation for: ${document.name}`);
                await storage.enqueueDocumentForEmbedding(nextJob.documentId, nextJob.userId, 8); // Low priority background job
              }
            } catch (embeddingEnqueueError) {
              console.warn(`Failed to auto-enqueue embedding generation for ${document.name}:`, embeddingEnqueueError);
              // Don't fail the entire analysis if embedding enqueue fails
            }
            
            // AI analysis completed for document ${nextJob.documentId}
          } else {
            throw new Error('AI analysis returned empty results');
          }
        }
      } catch (error) {
        console.error(`AI analysis failed for document ${nextJob.documentId}:`, error);
        
        // Handle retries with grace and humor
        const newRetryCount = nextJob.retryCount + 1;
        const maxRetries = 3; // Three strikes and you're out!
        
        if (newRetryCount <= maxRetries) {
          // Schedule retry - the retry timing and count management should be handled by storage layer
          const errorMessage = `Retry ${newRetryCount}/${maxRetries}: ${error instanceof Error ? error.message : String(error)}`;
          
          await storage.updateQueueJobStatus(nextJob.id, 'pending', errorMessage);
          console.log(`Scheduling retry ${newRetryCount}/${maxRetries} for document ${nextJob.documentId}`);
        } else {
          // Max retries exceeded - time to give up gracefully
          await storage.updateQueueJobStatus(nextJob.id, 'failed', `Max retries exceeded: ${error instanceof Error ? error.message : String(error)}`);
          console.log(`Max retries exceeded for document ${nextJob.documentId}`);
        }
      }

    } catch (error) {
      console.error('Queue processor encountered an unexpected error:', error);
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
      console.log(`Processing document ${documentId} immediately`);
      
      // Check daily quota
      const today = new Date().toISOString().split('T')[0];
      const dailyUsageRecord = await storage.getDailyUsage(today);
      const dailyUsage = dailyUsageRecord?.requestCount || 0;
      
      if (dailyUsage >= this.DAILY_REQUEST_LIMIT) {
        console.log(`Cannot process immediately - daily quota reached`);
        return false;
      }

      // Check rate limit
      this.refillTokenBucket();
      if (this.tokenBucket <= 0) {
        console.log(`Cannot process immediately - rate limit reached`);
        return false;
      }

      // Consume a token
      this.tokenBucket--;

      // Get document details
      const document = await storage.getDocumentById(documentId);
      if (!document) {
        console.error(`Document ${documentId} not found for immediate processing`);
        return false;
      }

      // Get document content for analysis
      const content = await storage.getDocumentContent(documentId, userId);
      if (!content) {
        console.error(`No content available for document ${documentId}`);
        return false;
      }

      // Perform AI analysis
      const analysisResult = await analyzeDocumentContent(content);
      
      if (analysisResult) {
        // Generate proper 2-3 line English summary for AI Analysis section
        const { summarizeDocument } = await import('./gemini.js');
        const properSummary = await summarizeDocument(content);
        
        // Update document with results
        await storage.updateDocument(documentId, {
          aiSummary: properSummary,
          aiKeyTopics: analysisResult.keyTopics,
          aiDocumentType: analysisResult.documentType,
          aiCategory: analysisResult.category,
          aiConciseName: analysisResult.conciseTitle,
          aiCategoryConfidence: analysisResult.categoryConfidence,
          aiDocumentTypeConfidence: analysisResult.documentTypeConfidence,
          aiWordCount: analysisResult.wordCount,
          aiAnalyzedAt: new Date()
        });
        
        // 🗂️ SMART ORGANIZATION: Automatically organize document into appropriate folder (immediate path)
        try {
          if (analysisResult.category && analysisResult.documentType) {
            const organized = await storage.organizeDocumentIntoFolder(
              documentId, 
              analysisResult.category, 
              analysisResult.documentType,
              userId
            );
            if (organized) {
              console.log(`✅ Smart Organization (immediate): "${document.name}" → ${analysisResult.category}/${analysisResult.documentType}`);
            } else {
              console.warn(`⚠️ Smart Organization (immediate) failed for "${document.name}"`);
            }
          }
        } catch (orgError) {
          // Don't fail the entire analysis if organization fails
          console.error(`❌ Smart Organization (immediate) error for "${document.name}":`, orgError);
        }
        
        // Track usage - exactly 1 request per analysis
        await storage.incrementDailyUsage(today, 1, true);
        
        console.log(`Immediate processing completed for document ${documentId}`);
        return true;
      } else {
        console.error(`AI analysis failed for immediate processing of document ${documentId}`);
        return false;
      }
    } catch (error) {
      console.error(`Immediate processing failed for document ${documentId}:`, error);
      return false;
    }
  }
}

// Create singleton instance
export const aiQueueProcessor = new AIQueueProcessor();

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('Received SIGINT - shutting down AI Queue Processor gracefully');
  aiQueueProcessor.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM - shutting down AI Queue Processor gracefully');
  aiQueueProcessor.stop();
  process.exit(0);
});