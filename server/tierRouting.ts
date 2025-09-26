// Tier Routing & Fusion System
// Policy-driven tier selection with absolute score ceilings

import { SearchPolicy, QueryAnalysis } from './queryAnalysis.js';
import { LexicalAnalysisResult } from './fieldAwareLexical.js';

export interface TierClassification {
  tier: 1 | 2 | 3;
  reason: string;
  semanticScore: number;
  lexicalScore: number;
  qualityScore: number;
  weights: { semantic: number; lexical: number; quality: number };
  rawCombined: number;
  finalScore: number;
  ceilingApplied: boolean;
  ceiling: number;
}

export interface QualitySignals {
  wordCount: number;
  hasMetadata: boolean;
  recentAccess: boolean;
  isFavorite: boolean;
  isComplete: boolean;
}

export class TierRouter {
  
  /**
   * Classify document into tier and calculate final score using policy
   */
  classifyAndScore(
    semanticScore: number,
    lexicalResult: LexicalAnalysisResult,
    qualitySignals: QualitySignals,
    policy: SearchPolicy,
    analysis: QueryAnalysis,
    docContent: any  // For exact phrase detection
  ): TierClassification {
    
    const lexicalScore = lexicalResult.finalScore;
    const qualityScore = this.calculateQualityScore(qualitySignals, policy.qualityWeight);
    
    // Tier 1: High semantic OR exact phrase in high-signal fields
    if (semanticScore >= policy.semantic_high || this.hasExactPhraseInHighSignalFields(docContent, analysis, lexicalResult)) {
      return this.calculateTierScore(1, semanticScore, lexicalScore, qualityScore, policy, 'High semantic score or exact phrase in title/filename');
    }
    
    // Tier 2: Moderate semantic with acceptable lexical
    if (semanticScore >= policy.semantic_mid && lexicalScore >= 0.2) {
      return this.calculateTierScore(2, semanticScore, lexicalScore, qualityScore, policy, 'Moderate semantic with acceptable lexical');
    }
    
    // Tier 3: Everything else
    return this.calculateTierScore(3, semanticScore, lexicalScore, qualityScore, policy, 'Low semantic score');
  }
  
  /**
   * Check for exact phrase matches in high-signal fields
   */
  private hasExactPhraseInHighSignalFields(
    docContent: any, 
    analysis: QueryAnalysis, 
    lexicalResult: LexicalAnalysisResult
  ): boolean {
    
    // Only check for exact phrases in title/filename for high confidence
    const query = analysis.signals.isQuoted ? 
      this.extractQuotedPhrase(docContent.name || '') : 
      this.getQueryText(analysis);
    
    if (!query) return false;
    
    const titleText = (docContent.name || '').toLowerCase();
    const filenameText = (docContent.originalName || docContent.name || '').toLowerCase();
    
    // Check for exact phrase match
    return titleText.includes(query.toLowerCase()) || 
           filenameText.includes(query.toLowerCase()) ||
           (lexicalResult.winningField === 'title' && lexicalResult.fieldScores.title >= 0.95) ||
           (lexicalResult.winningField === 'filename' && lexicalResult.fieldScores.filename >= 0.95);
  }
  
  private extractQuotedPhrase(text: string): string {
    const match = text.match(/["']([^"']+)["']/);
    return match ? match[1] : text;
  }
  
  private getQueryText(analysis: QueryAnalysis): string {
    // This would need to be passed from the main search function
    // For now, return empty to be safe
    return '';
  }
  
  /**
   * Calculate tier-specific score with policy weights and ceilings
   */
  private calculateTierScore(
    tier: 1 | 2 | 3,
    semanticScore: number,
    lexicalScore: number,
    qualityScore: number,
    policy: SearchPolicy,
    reason: string
  ): TierClassification {
    
    const weights = tier === 1 ? policy.tierWeights.tier1 :
                   tier === 2 ? policy.tierWeights.tier2 :
                   policy.tierWeights.tier3;
    
    const ceiling = tier === 1 ? policy.tierCeilings.tier1 :
                   tier === 2 ? policy.tierCeilings.tier2 :
                   policy.tierCeilings.tier3;
    
    // Calculate weighted combination
    const rawCombined = 
      (semanticScore * weights.semantic) + 
      (lexicalScore * weights.lexical) + 
      (qualityScore * weights.quality);
    
    // Apply tier ceiling (absolute limit)
    const finalScore = Math.min(rawCombined, ceiling);
    const ceilingApplied = finalScore < rawCombined;
    
    return {
      tier,
      reason,
      semanticScore,
      lexicalScore,
      qualityScore,
      weights,
      rawCombined,
      finalScore,
      ceilingApplied,
      ceiling
    };
  }
  
  /**
   * Calculate quality score based on document metadata
   */
  private calculateQualityScore(signals: QualitySignals, qualityWeight: number): number {
    if (qualityWeight === 0) return 0;  // No quality bonus for entity queries
    
    let qualityScore = 0;
    
    // Word count bonus (documents with substantial content)
    if (signals.wordCount > 100) qualityScore += 0.3;
    else if (signals.wordCount > 50) qualityScore += 0.15;
    
    // Metadata completeness
    if (signals.hasMetadata) qualityScore += 0.2;
    
    // Recent access (user engagement)
    if (signals.recentAccess) qualityScore += 0.25;
    
    // User favorites
    if (signals.isFavorite) qualityScore += 0.4;
    
    // Document completeness
    if (signals.isComplete) qualityScore += 0.1;
    
    // Normalize and apply policy weight
    const normalizedQuality = Math.min(1.0, qualityScore);
    return normalizedQuality * qualityWeight;
  }
  
  /**
   * Generate detailed tier classification log
   */
  generateTierLog(classification: TierClassification, docId: string, docName: string): string {
    const { tier, reason, semanticScore, lexicalScore, qualityScore, weights, rawCombined, finalScore, ceilingApplied, ceiling } = classification;
    
    const ceilingNote = ceilingApplied ? ` [CEILING_APPLIED: ${rawCombined.toFixed(3)} → ${finalScore.toFixed(3)}]` : '';
    
    return [
      `🎯 TIER_${tier}_CLASSIFICATION: "${docName}" (${docId.substring(0, 8)})`,
      `    REASON: ${reason}`,
      `    SEMANTIC: ${semanticScore.toFixed(6)}`,
      `    LEXICAL: ${lexicalScore.toFixed(6)}`,
      `    QUALITY: ${qualityScore.toFixed(6)}`,
      `    WEIGHTS: semantic=${weights.semantic.toFixed(1)}, lexical=${weights.lexical.toFixed(1)}, quality=${weights.quality.toFixed(1)}`,
      `    FORMULA: (${semanticScore.toFixed(3)} × ${weights.semantic.toFixed(1)}) + (${lexicalScore.toFixed(3)} × ${weights.lexical.toFixed(1)}) + (${qualityScore.toFixed(3)} × ${weights.quality.toFixed(1)}) = ${rawCombined.toFixed(6)}`,
      `    CEILING: tier_${tier}_limit=${ceiling.toFixed(2)}${ceilingNote}`,
      `    FINAL_SCORE: ${finalScore.toFixed(6)} (${(finalScore * 100).toFixed(1)}%)`
    ].join('\n');
  }
  
  /**
   * Detect anomalies in scoring results
   */
  detectAnomalies(results: TierClassification[]): string[] {
    const anomalies: string[] = [];
    
    // Check for score bunching (≥3 results within narrow band)
    const scores = results.map(r => r.finalScore).sort((a, b) => b - a);
    for (let i = 0; i <= scores.length - 3; i++) {
      const range = scores[i] - scores[i + 2];
      if (range <= 0.04) {
        anomalies.push(`BUNCHING_DETECTED: ${scores.slice(i, i + 3).map(s => s.toFixed(3)).join(', ')} (range: ${range.toFixed(3)})`);
        break;  // Only report first bunching instance
      }
    }
    
    // Check for tier ceiling violations
    results.forEach((result, index) => {
      if (result.finalScore > result.ceiling + 0.001) {  // Small tolerance for floating point
        anomalies.push(`CEILING_VIOLATION: doc_${index + 1} score=${result.finalScore.toFixed(3)} exceeds tier_${result.tier}_ceiling=${result.ceiling.toFixed(2)}`);
      }
    });
    
    // Check for summary-only high scores
    results.forEach((result, index) => {
      if (result.finalScore > 0.5 && result.lexicalScore > 0.5) {
        // This would need more context about which field won, but we can add it later
        // For now, just check if it's a potential summary-only inflation
      }
    });
    
    return anomalies;
  }
  
  /**
   * Generate policy dump for debugging
   */
  generatePolicyDump(policy: SearchPolicy, analysis: QueryAnalysis): string {
    return [
      `📋 POLICY_DUMP: "${policy.name}" (query_class: ${analysis.class})`,
      `    DESCRIPTION: ${policy.description}`,
      `    SEMANTIC_THRESHOLDS: high=${policy.semantic_high.toFixed(2)}, mid=${policy.semantic_mid.toFixed(2)}`,
      `    FIELD_CAPS: title=${policy.fieldCaps.title.toFixed(2)}, filename=${policy.fieldCaps.filename.toFixed(2)}, summary=${policy.fieldCaps.summary.toFixed(2)}, body=${policy.fieldCaps.body.toFixed(2)}`,
      `    TIER_WEIGHTS: T1(${policy.tierWeights.tier1.semantic.toFixed(1)},${policy.tierWeights.tier1.lexical.toFixed(1)},${policy.tierWeights.tier1.quality.toFixed(1)}) T2(${policy.tierWeights.tier2.semantic.toFixed(1)},${policy.tierWeights.tier2.lexical.toFixed(1)},${policy.tierWeights.tier2.quality.toFixed(1)}) T3(${policy.tierWeights.tier3.semantic.toFixed(1)},${policy.tierWeights.tier3.lexical.toFixed(1)},${policy.tierWeights.tier3.quality.toFixed(1)})`,
      `    TIER_CEILINGS: T1=${policy.tierCeilings.tier1.toFixed(2)}, T2=${policy.tierCeilings.tier2.toFixed(2)}, T3=${policy.tierCeilings.tier3.toFixed(2)}`,
      `    PROXIMITY_WINDOW: ${policy.proximityWindow} chars`,
      `    UI_THRESHOLDS: hide_below=${policy.hideBelow.toFixed(2)}, label_below=${policy.labelBelow.toFixed(2)}`,
      `    QUALITY_WEIGHT: ${policy.qualityWeight.toFixed(2)}`
    ].join('\n');
  }
}