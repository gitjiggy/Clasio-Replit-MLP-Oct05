// Field-Aware Lexical Scoring System
// Policy-driven per-field scoring with caps, proximity, and max-field logic

import { SearchPolicy, QueryAnalysis } from './queryAnalysis.js';

export interface FieldLexicalScores {
  title: number;
  filename: number;
  headings: number;
  body: number;
  summary: number;
  tags: number;
  folder: number;
}

export interface LexicalAnalysisResult {
  fieldScores: FieldLexicalScores;
  rawFieldScores: FieldLexicalScores;  // Before caps applied
  proximityBonuses: FieldLexicalScores;
  winningField: keyof FieldLexicalScores;
  finalScore: number;
  appliedCaps: Partial<FieldLexicalScores>;  // Which fields were capped
}

export interface FieldContent {
  title: string;
  filename: string;
  headings: string;
  body: string;
  summary: string;
  tags: string;
  folder: string;
}

export class FieldAwareLexicalScorer {
  
  /**
   * Calculate field-aware lexical score using policy-driven caps and proximity
   */
  async calculateFieldAwareLexicalScore(
    fieldContent: FieldContent,
    query: string,
    analysis: QueryAnalysis,
    policy: SearchPolicy,
    postgresBaseScore: number = 0
  ): Promise<LexicalAnalysisResult> {
    
    const tokens = this.tokenizeQuery(query);
    const rawFieldScores = this.calculateRawFieldScores(fieldContent, tokens);
    const proximityBonuses = this.calculateProximityBonuses(fieldContent, tokens, policy.proximityWindow);
    
    // Apply proximity bonuses to raw scores
    const boostedScores: FieldLexicalScores = {
      title: rawFieldScores.title + proximityBonuses.title,
      filename: rawFieldScores.filename + proximityBonuses.filename,
      headings: rawFieldScores.headings + proximityBonuses.headings,
      body: rawFieldScores.body + proximityBonuses.body,
      summary: rawFieldScores.summary + proximityBonuses.summary,
      tags: rawFieldScores.tags + proximityBonuses.tags,
      folder: rawFieldScores.folder + proximityBonuses.folder
    };
    
    // Apply policy caps
    const { cappedScores, appliedCaps } = this.applePolicyCaps(boostedScores, policy.fieldCaps);
    
    // Determine winning field and final score
    const { winningField, finalScore } = this.combineFieldScores(cappedScores, policy.useMaxField);
    
    return {
      fieldScores: cappedScores,
      rawFieldScores,
      proximityBonuses,
      winningField,
      finalScore,
      appliedCaps
    };
  }
  
  /**
   * Calculate raw lexical scores per field before caps/bonuses
   */
  private calculateRawFieldScores(content: FieldContent, tokens: string[]): FieldLexicalScores {
    const fields: (keyof FieldContent)[] = ['title', 'filename', 'headings', 'body', 'summary', 'tags', 'folder'];
    const scores: Partial<FieldLexicalScores> = {};
    
    for (const field of fields) {
      const fieldText = content[field].toLowerCase();
      scores[field] = this.calculateSingleFieldScore(fieldText, tokens);
    }
    
    return scores as FieldLexicalScores;
  }
  
  /**
   * Calculate lexical score for a single field
   */
  private calculateSingleFieldScore(fieldText: string, tokens: string[]): number {
    if (!fieldText || tokens.length === 0) return 0;
    
    const foundTokens = tokens.filter(token => fieldText.includes(token.toLowerCase()));
    const tokenCoverage = foundTokens.length / tokens.length;
    
    // Bonus for exact phrase match
    const exactPhraseBonus = fieldText.includes(tokens.join(' ').toLowerCase()) ? 0.3 : 0;
    
    // Bonus for all tokens present
    const allTokensBonus = foundTokens.length === tokens.length ? 0.2 : 0;
    
    // Base score from token coverage
    let baseScore = tokenCoverage * 0.6;
    
    // Apply bonuses
    baseScore += exactPhraseBonus + allTokensBonus;
    
    return Math.min(1.0, baseScore);
  }
  
  /**
   * Calculate proximity bonuses for co-occurring tokens
   */
  private calculateProximityBonuses(
    content: FieldContent, 
    tokens: string[], 
    proximityWindow: number
  ): FieldLexicalScores {
    
    const fields: (keyof FieldContent)[] = ['title', 'filename', 'headings', 'body', 'summary', 'tags', 'folder'];
    const bonuses: Partial<FieldLexicalScores> = {};
    
    for (const field of fields) {
      const fieldText = content[field].toLowerCase();
      bonuses[field] = this.calculateProximityBonus(fieldText, tokens, proximityWindow);
    }
    
    return bonuses as FieldLexicalScores;
  }
  
  /**
   * Calculate proximity bonus for a single field
   */
  private calculateProximityBonus(fieldText: string, tokens: string[], maxDistance: number): number {
    if (tokens.length < 2) return 0;
    
    // Find positions of all tokens
    const positions: number[][] = tokens.map(token => {
      const indices: number[] = [];
      let pos = fieldText.indexOf(token.toLowerCase());
      while (pos !== -1) {
        indices.push(pos);
        pos = fieldText.indexOf(token.toLowerCase(), pos + 1);
      }
      return indices;
    });
    
    // Check if any combination of token positions are within proximity
    let hasProximity = false;
    for (let i = 0; i < positions.length - 1; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        for (const pos1 of positions[i]) {
          for (const pos2 of positions[j]) {
            if (Math.abs(pos1 - pos2) <= maxDistance) {
              hasProximity = true;
              break;
            }
          }
          if (hasProximity) break;
        }
        if (hasProximity) break;
      }
      if (hasProximity) break;
    }
    
    return hasProximity ? 0.1 : 0;  // Small proximity bonus
  }
  
  /**
   * Apply policy caps to field scores
   */
  private applePolicyCaps(
    scores: FieldLexicalScores, 
    caps: SearchPolicy['fieldCaps']
  ): { cappedScores: FieldLexicalScores; appliedCaps: Partial<FieldLexicalScores> } {
    
    const cappedScores: FieldLexicalScores = { ...scores };
    const appliedCaps: Partial<FieldLexicalScores> = {};
    
    for (const [field, cap] of Object.entries(caps)) {
      const fieldKey = field as keyof FieldLexicalScores;
      if (scores[fieldKey] > cap) {
        cappedScores[fieldKey] = cap;
        appliedCaps[fieldKey] = cap;
      }
    }
    
    return { cappedScores, appliedCaps };
  }
  
  /**
   * Combine field scores using max-field or sum logic
   */
  private combineFieldScores(
    scores: FieldLexicalScores, 
    useMaxField: boolean
  ): { winningField: keyof FieldLexicalScores; finalScore: number } {
    
    if (useMaxField) {
      // Max-field logic: highest scoring field wins
      let maxScore = 0;
      let winningField: keyof FieldLexicalScores = 'title';
      
      for (const [field, score] of Object.entries(scores)) {
        if (score > maxScore) {
          maxScore = score;
          winningField = field as keyof FieldLexicalScores;
        }
      }
      
      return { winningField, finalScore: maxScore };
    } else {
      // Sum logic: weighted combination (not recommended per requirements)
      const totalScore = Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.keys(scores).length;
      return { winningField: 'body', finalScore: Math.min(1.0, totalScore) };  // Default winning field for sum logic
    }
  }
  
  /**
   * Tokenize query for processing
   */
  private tokenizeQuery(query: string): string[] {
    return query.toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 0);
  }
  
  /**
   * Generate detailed trace log for a document
   */
  generateTraceLog(
    docId: string,
    cosineScore: number,
    lexicalResult: LexicalAnalysisResult,
    tier: number,
    weights: { semantic: number; lexical: number; quality: number },
    finalScore: number
  ): string {
    
    const { fieldScores, proximityBonuses, winningField, appliedCaps } = lexicalResult;
    
    // Format: docId | cosine | lex:title | lex:filename | lex:headings | lex:body | lex:summary | proximity | tier | weights(sem,lex,qual) | final
    const proximityStr = Object.entries(proximityBonuses)
      .filter(([_, bonus]) => bonus > 0)
      .map(([field, bonus]) => `${field}:+${bonus.toFixed(2)}`)
      .join(',') || 'none';
    
    const capsStr = Object.keys(appliedCaps).length > 0 
      ? `[capped:${Object.keys(appliedCaps).join(',')}]` 
      : '';
    
    return [
      docId.substring(0, 8),  // Short doc ID
      cosineScore.toFixed(3),
      `lex:title=${fieldScores.title.toFixed(2)}`,
      `lex:filename=${fieldScores.filename.toFixed(2)}`,
      `lex:headings=${fieldScores.headings.toFixed(2)}`,
      `lex:body=${fieldScores.body.toFixed(2)}`,
      `lex:summary=${fieldScores.summary.toFixed(2)}${capsStr}`,
      `proximity=${proximityStr}`,
      `tier=${tier}`,
      `weights(${weights.semantic.toFixed(1)},${weights.lexical.toFixed(1)},${weights.quality.toFixed(1)})`,
      `winner=${winningField}`,
      `final=${finalScore.toFixed(3)}`
    ].join(' | ');
  }
}