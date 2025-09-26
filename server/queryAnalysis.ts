// Query Analysis & Policy System
// Data-driven approach to search scoring and tier routing

export interface QuerySignals {
  tokenCount: number;
  casingPattern: 'lowercase' | 'uppercase' | 'mixed' | 'titlecase' | 'propercase';
  hasDigits: boolean;
  hasHyphens: boolean;
  hasQuotes: boolean;
  hasOperators: boolean;
  stopWordRatio: number;
  avgTokenLength: number;
  hasSpecialChars: boolean;
  isQuoted: boolean;
  containsNumbers: boolean;
  containsProperNouns: boolean;
}

export type QueryClass = 
  | 'entity.proper'     // People, organizations, places
  | 'id/code'           // Identifiers like "1099-INT", "HSA-Form 8889"
  | 'date/range'        // Date queries
  | 'short.keyword'     // 1-3 common tokens
  | 'phrase'            // Quoted or long exact phrase
  | 'question'          // Question-like queries
  | 'topic.freeform';   // ≥4 tokens, mixed case

export interface QueryAnalysis {
  class: QueryClass;
  signals: QuerySignals;
  confidence: number;
}

export interface SearchPolicy {
  name: string;
  description: string;
  
  // Tier thresholds
  semantic_high: number;    // Tier 1 threshold
  semantic_mid: number;     // Tier 2 threshold
  
  // Field caps for lexical scoring (0..1)
  fieldCaps: {
    title: number;
    filename: number;
    headings: number;
    body: number;
    summary: number;
    tags: number;
    folder: number;
  };
  
  // Fusion weights per tier
  tierWeights: {
    tier1: { semantic: number; lexical: number; quality: number };
    tier2: { semantic: number; lexical: number; quality: number };
    tier3: { semantic: number; lexical: number; quality: number };
  };
  
  // Tier ceilings (absolute limits)
  tierCeilings: {
    tier1: number;  // e.g., 0.99
    tier2: number;  // e.g., 0.70
    tier3: number;  // e.g., 0.45
  };
  
  // Proximity settings
  proximityWindow: number;  // Token distance for proximity bonus
  useMaxField: boolean;     // true = max-field logic, false = sum logic
  
  // UI behavior
  hideBelow: number;        // Hide results below this threshold
  labelBelow: number;       // Label as "lower confidence" below this
  
  // Quality settings
  qualityWeight: number;    // Overall quality importance for this query class
}

// Stop words for analysis
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'
]);

// Proper noun indicators (simple heuristics)
const PROPER_NOUN_INDICATORS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'inc', 'corp', 'llc', 'ltd', 'university', 'college',
  'school', 'hospital', 'company', 'department', 'foundation', 'institute', 'center', 'centre'
]);

export class QueryAnalyzer {
  
  /**
   * Analyze query and return classification + signals
   */
  analyzeQuery(query: string): QueryAnalysis {
    const normalizedQuery = query.trim();
    const tokens = this.tokenize(normalizedQuery);
    const signals = this.extractSignals(normalizedQuery, tokens);
    
    // Classify query based on signals
    const classification = this.classifyQuery(normalizedQuery, tokens, signals);
    
    return {
      class: classification.class,
      signals,
      confidence: classification.confidence
    };
  }
  
  private tokenize(query: string): string[] {
    // Simple tokenization - split on whitespace and punctuation
    return query.toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 0);
  }
  
  private extractSignals(query: string, tokens: string[]): QuerySignals {
    const originalTokens = query.split(/\s+/).filter(t => t.length > 0);
    
    return {
      tokenCount: tokens.length,
      casingPattern: this.detectCasingPattern(originalTokens),
      hasDigits: /\d/.test(query),
      hasHyphens: /-/.test(query),
      hasQuotes: /["']/.test(query),
      hasOperators: /[+\-*/:&|()]/.test(query),
      stopWordRatio: tokens.filter(t => STOP_WORDS.has(t)).length / Math.max(tokens.length, 1),
      avgTokenLength: tokens.reduce((sum, t) => sum + t.length, 0) / Math.max(tokens.length, 1),
      hasSpecialChars: /[^a-zA-Z0-9\s-]/.test(query),
      isQuoted: /^["'].*["']$/.test(query.trim()),
      containsNumbers: /\b\d+\b/.test(query),
      containsProperNouns: this.hasProperNounIndicators(originalTokens)
    };
  }
  
  private detectCasingPattern(tokens: string[]): QuerySignals['casingPattern'] {
    if (tokens.length === 0) return 'lowercase';
    
    const patterns = tokens.map(token => {
      if (token === token.toLowerCase()) return 'lower';
      if (token === token.toUpperCase()) return 'upper';
      if (token[0] === token[0].toUpperCase() && token.slice(1) === token.slice(1).toLowerCase()) return 'title';
      return 'mixed';
    });
    
    const lowerCount = patterns.filter(p => p === 'lower').length;
    const upperCount = patterns.filter(p => p === 'upper').length;
    const titleCount = patterns.filter(p => p === 'title').length;
    const mixedCount = patterns.filter(p => p === 'mixed').length;
    
    if (titleCount >= tokens.length * 0.5) return 'titlecase';
    if (upperCount >= tokens.length * 0.5) return 'uppercase';
    if (lowerCount >= tokens.length * 0.8) return 'lowercase';
    if (titleCount > 0 && this.hasProperNounIndicators(tokens)) return 'propercase';
    return 'mixed';
  }
  
  private hasProperNounIndicators(tokens: string[]): boolean {
    return tokens.some(token => 
      PROPER_NOUN_INDICATORS.has(token.toLowerCase()) ||
      /^[A-Z][a-z]+$/.test(token) // Simple proper noun pattern
    );
  }
  
  private classifyQuery(query: string, tokens: string[], signals: QuerySignals): { class: QueryClass; confidence: number } {
    
    // ID/Code pattern: contains hyphens + digits, often short
    if (signals.hasHyphens && signals.hasDigits && signals.tokenCount <= 3) {
      return { class: 'id/code', confidence: 0.9 };
    }
    
    // Date/Range pattern: contains numbers and common date indicators
    if (signals.containsNumbers && /\b(20\d{2}|19\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(query)) {
      return { class: 'date/range', confidence: 0.8 };
    }
    
    // Quoted phrase
    if (signals.isQuoted) {
      return { class: 'phrase', confidence: 0.95 };
    }
    
    // Question pattern
    if (/^(what|how|why|when|where|who|which|can|could|should|would|is|are|does|do|did)\b/i.test(query.trim())) {
      return { class: 'question', confidence: 0.85 };
    }
    
    // Entity.proper: proper noun indicators + proper casing
    if ((signals.casingPattern === 'propercase' || signals.casingPattern === 'titlecase') && 
        (signals.containsProperNouns || signals.tokenCount <= 3)) {
      return { class: 'entity.proper', confidence: 0.8 };
    }
    
    // Short keyword: 1-3 common tokens, mostly lowercase
    if (signals.tokenCount <= 3 && signals.casingPattern === 'lowercase' && signals.stopWordRatio < 0.5) {
      return { class: 'short.keyword', confidence: 0.7 };
    }
    
    // Topic freeform: longer queries with mixed characteristics
    if (signals.tokenCount >= 4) {
      return { class: 'topic.freeform', confidence: 0.6 };
    }
    
    // Default to short.keyword for remaining cases
    return { class: 'short.keyword', confidence: 0.5 };
  }
}

// Policy Registry with predefined policies
export class PolicyRegistry {
  private policies: Map<string, SearchPolicy> = new Map();
  
  constructor() {
    this.initializeDefaultPolicies();
  }
  
  private initializeDefaultPolicies() {
    
    // Default policy - works for most queries
    this.policies.set('default', {
      name: 'default',
      description: 'Default policy for general queries',
      semantic_high: 0.75,
      semantic_mid: 0.4,
      fieldCaps: {
        title: 1.0,
        filename: 1.0,
        headings: 0.85,
        body: 0.65,
        summary: 0.15,  // Cap summary-only matches ≤ 0.15
        tags: 0.6,
        folder: 0.5
      },
      tierWeights: {
        tier1: { semantic: 1.0, lexical: 0.0, quality: 0.0 },      // Pure semantic
        tier2: { semantic: 0.6, lexical: 0.3, quality: 0.1 },      // Balanced
        tier3: { semantic: 0.0, lexical: 0.5, quality: 0.5 }       // Reduced impact
      },
      tierCeilings: {
        tier1: 0.99,
        tier2: 0.70,
        tier3: 0.45
      },
      proximityWindow: 15,
      useMaxField: true,
      hideBelow: 0.70,
      labelBelow: 0.50,
      qualityWeight: 0.1
    });
    
    // Entity.proper policy - for people, organizations, places
    this.policies.set('entity.proper', {
      name: 'entity.proper',
      description: 'Policy for proper noun entities (people, organizations, places)',
      semantic_high: 0.7,   // Lower threshold for exact name matches
      semantic_mid: 0.35,
      fieldCaps: {
        title: 1.0,         // Exact filename/title matches very important
        filename: 1.0,
        headings: 0.8,
        body: 0.4,          // Lower body importance for names
        summary: 0.1,       // Very low summary importance 
        tags: 0.7,
        folder: 0.6
      },
      tierWeights: {
        tier1: { semantic: 1.0, lexical: 0.0, quality: 0.0 },
        tier2: { semantic: 0.5, lexical: 0.5, quality: 0.0 },     // No quality for entity queries
        tier3: { semantic: 0.0, lexical: 0.7, quality: 0.3 }
      },
      tierCeilings: {
        tier1: 0.98,
        tier2: 0.65,
        tier3: 0.35         // Very low ceiling for weak entity matches
      },
      proximityWindow: 10,  // Tighter proximity for names
      useMaxField: true,
      hideBelow: 0.65,
      labelBelow: 0.40,
      qualityWeight: 0.0   // No quality bonus for entity searches
    });
    
    // ID/Code policy - for document identifiers
    this.policies.set('id/code', {
      name: 'id/code',
      description: 'Policy for ID and code queries (1099-INT, HSA-Form 8889)',
      semantic_high: 0.6,
      semantic_mid: 0.3,
      fieldCaps: {
        title: 1.0,         // IDs most likely in title/filename
        filename: 1.0,
        headings: 0.9,
        body: 0.7,
        summary: 0.2,
        tags: 0.8,
        folder: 0.3
      },
      tierWeights: {
        tier1: { semantic: 0.8, lexical: 0.2, quality: 0.0 },
        tier2: { semantic: 0.4, lexical: 0.6, quality: 0.0 },
        tier3: { semantic: 0.0, lexical: 0.8, quality: 0.2 }
      },
      tierCeilings: {
        tier1: 0.95,
        tier2: 0.75,
        tier3: 0.40
      },
      proximityWindow: 5,   // Very tight proximity for codes
      useMaxField: true,
      hideBelow: 0.70,
      labelBelow: 0.45,
      qualityWeight: 0.0
    });
    
    // Topic.freeform policy - for longer, exploratory queries
    this.policies.set('topic.freeform', {
      name: 'topic.freeform',
      description: 'Policy for longer topic-based queries (≥4 tokens)',
      semantic_high: 0.65,
      semantic_mid: 0.35,
      fieldCaps: {
        title: 0.8,
        filename: 0.8,
        headings: 0.75,
        body: 0.7,          // Higher body importance for topics
        summary: 0.4,       // Higher summary importance for topics
        tags: 0.6,
        folder: 0.5
      },
      tierWeights: {
        tier1: { semantic: 0.9, lexical: 0.1, quality: 0.0 },
        tier2: { semantic: 0.6, lexical: 0.2, quality: 0.2 },     // Higher quality weight
        tier3: { semantic: 0.2, lexical: 0.4, quality: 0.4 }
      },
      tierCeilings: {
        tier1: 0.90,
        tier2: 0.70,
        tier3: 0.50        // Higher ceiling for topic exploration
      },
      proximityWindow: 25,  // Wider proximity for topic matching
      useMaxField: true,
      hideBelow: 0.60,     // Lower threshold for topic exploration
      labelBelow: 0.40,
      qualityWeight: 0.2   // Allow quality bonuses for broad topics
    });
  }
  
  /**
   * Get policy for a query analysis result
   */
  getPolicyForQuery(analysis: QueryAnalysis): SearchPolicy {
    // Direct mapping from query class to policy
    const policyName = analysis.class === 'short.keyword' ? 'default' : analysis.class;
    
    return this.policies.get(policyName) || this.policies.get('default')!;
  }
  
  /**
   * Get all available policies (for debugging)
   */
  getAllPolicies(): SearchPolicy[] {
    return Array.from(this.policies.values());
  }
  
  /**
   * Register a custom policy
   */
  registerPolicy(policy: SearchPolicy) {
    this.policies.set(policy.name, policy);
  }
}