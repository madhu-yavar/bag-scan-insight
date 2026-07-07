/**
 * Canonical reference types for bootstrap validation system
 * Stores manufacturer/retailer baggage specifications found via web search
 */

export type DimensionSource = 'manufacturer' | 'retailer' | 'community' | 'unknown';
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * Official dimensions from manufacturer/retailer sources
 */
export interface OfficialDimensions {
  width: number;
  height: number;
  depth: number;
  source: string; // Where dimensions were found
  url?: string; // Link to product page
  unit: 'cm' | 'inches';
  confidence: ConfidenceLevel;
}

/**
 * Visual signature for matching bags without model names
 */
export interface VisualSignature {
  colors: {
    primary: string;
    secondary?: string;
  };
  material: 'hard-shell' | 'soft-shell' | 'leather' | 'fabric' | 'nylon' | 'polycarbonate' | 'other' | 'unknown';
  wheels: {
    count: number | null;
    type: 'spinner' | 'inline' | 'none' | 'unknown';
  };
  keyFeatures: string[]; // ['expandable', 'tsa-lock', 'external-pockets']
  shapeHints?: string[]; // ['ribbed-front', 'glossy', 'matte']
}

/**
 * Canonical reference entry for a baggage model
 */
export interface CanonicalReference {
  id: string;
  brand: string;
  model?: string;
  sizeClass: string;
  officialDimensions: OfficialDimensions;
  visualSignature: VisualSignature;
  dimensionSource: DimensionSource;
  sourceUrl?: string;
  confidence: ConfidenceLevel;
  confirmedCount: number;
  firstSeenAt: string;
  lastConfirmedAt?: string;
  metadata?: {
    searchQuery?: string;
    searchResults?: WebSearchResult[];
    extractedFrom?: string;
    screenshotUrls?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Result from web search for baggage specifications
 */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  relevance?: number;
}

/**
 * Extracted dimensions from search results
 */
export interface ExtractedDimensions {
  dimensions: OfficialDimensions | null;
  model?: string;
  sourceUrl: string;
  sourceType: DimensionSource;
  confidence: ConfidenceLevel;
  rawText?: string; // Original text where dimensions were found
}

/**
 * Validation result when comparing against canonical references
 */
export interface ValidationResult {
  status: 'validated' | 'flagged' | 'unknown-brand' | 'no-match' | 'canonical-created' | 'specs-not-found';
  canonicalReference?: CanonicalReference;
  dimensionDifference?: {
    width: number;
    height: number;
    depth: number;
    maxDiff: number;
    withinTolerance: boolean;
  };
  reason?: string;
  suggestedAction?: string;
}

/**
 * Options for finding matching canonical references
 */
export interface MatchOptions {
  brandRequired?: boolean;
  sizeClassRequired?: boolean;
  minSimilarity?: number; // 0-1 scale for visual similarity
  maxResults?: number;
}

/**
 * Analysis output from baggage AI
 */
export interface BaggageAnalysis {
  summary?: string;
  bag_type?: string;
  size_class?: string;
  dimensions_cm?: {
    width: number | null;
    height: number | null;
    depth: number | null;
    confidence: string;
    basis?: string;
  };
  colors?: {
    primary: string;
    secondary?: string | null;
  };
  material?: string;
  texture?: string;
  wheels?: {
    count: number | null;
    type: string;
  };
  handles?: string[];
  features?: string[];
  brand_guess?: string | null;
  damage?: any[];
  overall_condition?: string;
  notes?: string;
}
