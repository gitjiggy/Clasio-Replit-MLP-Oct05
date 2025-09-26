// Policy-Driven Search Implementation
// Comprehensive search method with query analysis, field-aware scoring, tier routing, and instrumentation

import { QueryAnalyzer, PolicyRegistry, QueryAnalysis, SearchPolicy } from './queryAnalysis.js';
import { FieldAwareLexicalScorer, FieldContent, LexicalAnalysisResult } from './fieldAwareLexical.js';
import { TierRouter, TierClassification, QualitySignals } from './tierRouting.js';
import { db } from "./db.js";
import { eq, and, desc, ilike, inArray, count, sql, or, isNotNull } from "drizzle-orm";
import { documents, folders, tags, documentTags } from "../shared/schema.js";
import { generateEmbedding, calculateCosineSimilarity, parseEmbeddingFromJSON } from "./gemini.js";
import type { DocumentWithFolderAndTags } from "../shared/schema.js";

export interface PolicyDrivenSearchResult {
  documents: DocumentWithFolderAndTags[];
  relevantDocuments: DocumentWithFolderAndTags[];
  relatedDocuments: DocumentWithFolderAndTags[];
  response: string;
  intent: string;
  keywords: string[];
  timing?: { total: number; fts: number; semantic: number };
  
  // Enhanced instrumentation
  queryAnalysis: QueryAnalysis;
  policyUsed: SearchPolicy;
  topDocumentTraces: string[];
  anomalies: string[];
}

export class PolicyDrivenSearchEngine {
  
  constructor(
    private queryAnalyzer: QueryAnalyzer,
    private policyRegistry: PolicyRegistry,
    private fieldAwareLexicalScorer: FieldAwareLexicalScorer,
    private tierRouter: TierRouter,
    private queryEmbeddingCache: any
  ) {}
  
  /**
   * Comprehensive policy-driven search with full instrumentation
   */
  async searchWithPolicyDrivenAnalysis(
    query: string, 
    filters: any = {}, 
    userId?: string
  ): Promise<PolicyDrivenSearchResult> {
    
    const startTime = performance.now();
    console.log(`🚀 POLICY-DRIVEN SEARCH: "${query}"`);
    
    // STEP 1: Query Analysis → Policy Selection
    const queryAnalysis = this.queryAnalyzer.analyzeQuery(query);
    const policy = this.policyRegistry.getPolicyForQuery(queryAnalysis);
    
    // LOG 1: Query Analysis
    console.log(this.generateQueryAnalysisLog(queryAnalysis, policy));
    
    // LOG 2: Policy Dump
    console.log(this.tierRouter.generatePolicyDump(policy, queryAnalysis));
    
    // STEP 2: Candidate Generation (Hybrid FTS + Prefiltering)
    const ftsStartTime = performance.now();
    const candidates = await this.generateCandidates(query, filters, userId);
    const ftsTime = performance.now() - ftsStartTime;
    
    if (candidates.length === 0) {
      return this.createEmptyResult(queryAnalysis, policy, startTime, ftsTime);
    }
    
    // STEP 3: Semantic Analysis + Field-Aware Lexical + Tier Routing
    const semanticStartTime = performance.now();
    const queryEmbedding = await this.getOrGenerateQueryEmbedding(query);
    
    const scoredResults: TierClassification[] = [];
    const documentTraces: string[] = [];
    
    for (const doc of candidates) {
      try {
        // Calculate semantic score
        const semanticScore = await this.calculateSemanticScore(doc, queryEmbedding);
        
        // Extract field content for field-aware scoring
        const fieldContent = this.extractFieldContent(doc);
        
        // Field-aware lexical scoring with policy caps
        const lexicalResult = await this.fieldAwareLexicalScorer.calculateFieldAwareLexicalScore(
          fieldContent, query, queryAnalysis, policy, 0
        );
        
        // Calculate quality signals
        const qualitySignals = this.extractQualitySignals(doc, userId);
        
        // Tier routing and fusion with policy - CRITICAL: Pass original query for exact phrase detection
        const tierClassification = this.tierRouter.classifyAndScore(
          semanticScore, lexicalResult, qualitySignals, policy, queryAnalysis, doc, query
        );
        
        scoredResults.push(tierClassification);
        
        // Generate detailed trace
        const traceLog = this.fieldAwareLexicalScorer.generateTraceLog(
          doc.id, semanticScore, lexicalResult, tierClassification.tier,
          tierClassification.weights, tierClassification.finalScore
        );
        documentTraces.push(traceLog);
        
        // Enhanced tier log
        console.log(this.tierRouter.generateTierLog(tierClassification, doc.id, doc.name));
        
      } catch (error) {
        console.error(`Error scoring document ${doc.id}:`, error);
        // Continue with other documents
      }
    }
    
    const semanticTime = performance.now() - semanticStartTime;
    
    // STEP 4: Anomaly Detection
    const anomalies = this.tierRouter.detectAnomalies(scoredResults);
    if (anomalies.length > 0) {
      console.warn('🚨 ANOMALIES DETECTED:');
      anomalies.forEach(anomaly => console.warn(`    ${anomaly}`));
    }
    
    // STEP 5: Results Organization with Policy-Driven UI Thresholds
    const finalResults = this.organizeResults(scoredResults, candidates, policy);
    
    // LOG 3: Top-5 Document Traces
    console.log('📊 TOP-5 DOCUMENT TRACES:');
    documentTraces.slice(0, 5).forEach((trace, index) => {
      console.log(`    ${index + 1}. ${trace}`);
    });
    
    const totalTime = performance.now() - startTime;
    console.log(`🏁 Policy-driven search completed: ${totalTime.toFixed(2)}ms (FTS: ${ftsTime.toFixed(2)}ms, Semantic: ${semanticTime.toFixed(2)}ms)`);
    
    return {
      documents: finalResults.allDocuments,
      relevantDocuments: finalResults.highConfidence,
      relatedDocuments: finalResults.lowerConfidence,
      response: this.generateResponse(finalResults, policy),
      intent: 'policy_driven_search',
      keywords: query.split(' ').filter(word => word.trim().length > 0),
      timing: { total: totalTime, fts: ftsTime, semantic: semanticTime },
      queryAnalysis,
      policyUsed: policy,
      topDocumentTraces: documentTraces.slice(0, 5),
      anomalies
    };
  }
  
  /**
   * Generate candidate documents using hybrid FTS approach
   */
  private async generateCandidates(query: string, filters: any, userId?: string): Promise<any[]> {
    const keywords = query.toLowerCase().split(/\s+/).filter(word => word.length > 0).slice(0, 3);
    
    const conditions = [
      eq(documents.isDeleted, false),
      eq(documents.status, 'active')
    ];
    
    if (userId) {
      conditions.push(eq(documents.userId, userId));
    }
    
    // Build keyword conditions
    const keywordConditions = keywords.map(keyword => {
      const searchTerm = `%${keyword}%`;
      return or(
        ilike(documents.name, searchTerm),
        ilike(documents.originalName, searchTerm),
        ilike(documents.aiSummary, searchTerm),
        ilike(documents.documentContent, searchTerm),
        ilike(documents.aiCategory, searchTerm)
      );
    });
    
    const results = await db
      .select({
        documents,
        folder: folders
      })
      .from(documents)
      .leftJoin(folders, eq(documents.folderId, folders.id))
      .where(and(...conditions, or(...keywordConditions)))
      .orderBy(desc(documents.uploadedAt))
      .limit(15);
    
    return results.map(result => ({
      ...result.documents,
      folder: result.folder
    }));
  }
  
  /**
   * Calculate semantic score using embeddings
   */
  private async calculateSemanticScore(doc: any, queryEmbedding: number[]): Promise<number> {
    const fieldScores: number[] = [];
    
    // Title embedding (with boost)
    if (doc.titleEmbedding) {
      const titleEmb = parseEmbeddingFromJSON(doc.titleEmbedding);
      if (titleEmb) {
        const similarity = calculateCosineSimilarity(queryEmbedding, titleEmb);
        fieldScores.push(similarity * 1.1); // Title boost
      }
    }
    
    // Summary embedding
    if (doc.summaryEmbedding) {
      const summaryEmb = parseEmbeddingFromJSON(doc.summaryEmbedding);
      if (summaryEmb) {
        fieldScores.push(calculateCosineSimilarity(queryEmbedding, summaryEmb));
      }
    }
    
    // Content embedding
    if (doc.contentEmbedding) {
      const contentEmb = parseEmbeddingFromJSON(doc.contentEmbedding);
      if (contentEmb) {
        fieldScores.push(calculateCosineSimilarity(queryEmbedding, contentEmb));
      }
    }
    
    // Key topics embedding
    if (doc.keyTopicsEmbedding) {
      const topicsEmb = parseEmbeddingFromJSON(doc.keyTopicsEmbedding);
      if (topicsEmb) {
        fieldScores.push(calculateCosineSimilarity(queryEmbedding, topicsEmb));
      }
    }
    
    // Return maximum field score (strongest signal wins)
    return fieldScores.length > 0 ? Math.max(...fieldScores) : 0;
  }
  
  /**
   * Extract field content for field-aware scoring
   */
  private extractFieldContent(doc: any): FieldContent {
    return {
      title: doc.name || '',
      filename: doc.originalName || doc.name || '',
      headings: '', // Would be extracted from content if available
      body: doc.documentContent || '',
      summary: doc.aiSummary || '',
      tags: '', // Would need to be fetched separately
      folder: doc.folder?.name || ''
    };
  }
  
  /**
   * Extract quality signals for document
   */
  private extractQualitySignals(doc: any, userId?: string): QualitySignals {
    return {
      wordCount: doc.aiWordCount || 0,
      hasMetadata: !!(doc.aiSummary && doc.aiCategory),
      recentAccess: false, // Would need access log query
      isFavorite: doc.isFavorite || false,
      isComplete: !!(doc.aiSummary && doc.aiCategory && doc.documentContent)
    };
  }
  
  /**
   * Get or generate query embedding with caching
   */
  private async getOrGenerateQueryEmbedding(query: string): Promise<number[]> {
    // Use existing cache if available
    const cached = this.queryEmbeddingCache.getCachedEmbedding?.(query);
    if (cached) {
      return cached;
    }
    
    const embedding = await generateEmbedding(query, 'RETRIEVAL_QUERY');
    this.queryEmbeddingCache.setCachedEmbedding?.(query, embedding);
    return embedding;
  }
  
  /**
   * Organize results based on policy thresholds
   */
  private organizeResults(scoredResults: TierClassification[], candidates: any[], policy: SearchPolicy) {
    // Sort by final score
    const sortedResults = scoredResults
      .map((classification, index) => ({
        ...candidates[index],
        classification
      }))
      .sort((a, b) => b.classification.finalScore - a.classification.finalScore);
    
    // Split based on policy thresholds
    const highConfidence = sortedResults.filter(r => r.classification.finalScore >= policy.hideBelow);
    const lowerConfidence = sortedResults.filter(r => r.classification.finalScore < policy.hideBelow && r.classification.finalScore >= policy.labelBelow);
    
    return {
      allDocuments: sortedResults,
      highConfidence,
      lowerConfidence
    };
  }
  
  /**
   * Generate query analysis log
   */
  private generateQueryAnalysisLog(analysis: QueryAnalysis, policy: SearchPolicy): string {
    return [
      `🔍 QUERY_ANALYSIS: "${analysis.class}" (confidence: ${analysis.confidence.toFixed(2)})`,
      `    SIGNALS: tokens=${analysis.signals.tokenCount}, casing=${analysis.signals.casingPattern}, digits=${analysis.signals.hasDigits}, hyphens=${analysis.signals.hasHyphens}`,
      `    POLICY_SELECTED: "${policy.name}" - ${policy.description}`,
      `    STOP_WORD_RATIO: ${analysis.signals.stopWordRatio.toFixed(2)}, AVG_TOKEN_LENGTH: ${analysis.signals.avgTokenLength.toFixed(1)}`
    ].join('\n');
  }
  
  /**
   * Generate response text based on results
   */
  private generateResponse(results: any, policy: SearchPolicy): string {
    const totalCount = results.allDocuments.length;
    const highConfidenceCount = results.highConfidence.length;
    
    if (totalCount === 0) {
      return "No documents found matching your query.";
    }
    
    if (highConfidenceCount === 0) {
      return `Found ${totalCount} potentially relevant documents with lower confidence scores.`;
    }
    
    return `Found ${highConfidenceCount} highly relevant documents${totalCount > highConfidenceCount ? ` and ${totalCount - highConfidenceCount} additional matches` : ''}.`;
  }
  
  /**
   * Create empty result for no matches
   */
  private createEmptyResult(analysis: QueryAnalysis, policy: SearchPolicy, startTime: number, ftsTime: number): PolicyDrivenSearchResult {
    return {
      documents: [],
      relevantDocuments: [],
      relatedDocuments: [],
      response: "No documents found matching your query.",
      intent: 'policy_driven_search',
      keywords: [],
      timing: { total: performance.now() - startTime, fts: ftsTime, semantic: 0 },
      queryAnalysis: analysis,
      policyUsed: policy,
      topDocumentTraces: [],
      anomalies: []
    };
  }
}