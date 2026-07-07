/**
 * Canonical reference matching logic
 * Finds and validates against known baggage specifications
 */

import { createClient } from '@supabase/supabase-js';
import type {
  CanonicalReference,
  BaggageAnalysis,
  ValidationResult,
  MatchOptions,
  VisualSignature
} from './canonical-references.types';

// Initialize Supabase client
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase credentials not found');
  }

  return createClient(url, key);
}

/**
 * Find matching canonical references for a baggage analysis
 */
export async function findMatchingReferences(
  analysis: BaggageAnalysis,
  options: MatchOptions = {}
): Promise<CanonicalReference[]> {
  const {
    brandRequired = false,
    sizeClassRequired = false,
    minSimilarity = 0.5,
    maxResults = 10
  } = options;

  const supabase = getSupabaseClient();

  // Build query
  let query = supabase
    .from('canonical_references')
    .select('*')
    .gte('confirmed_count', 1) // Only get references with at least one confirmation
    .order('confirmed_count', { ascending: false })
    .limit(maxResults);

  // Apply filters
  if (analysis.brand_guess && brandRequired) {
    query = query.ilike('brand', `%${analysis.brand_guess}%`);
  }

  if (analysis.size_class && sizeClassRequired) {
    query = query.eq('size_class', analysis.size_class);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error finding canonical references:', error);
    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Convert and score matches
  const matches = data.map(ref => ({
    ...ref,
    similarityScore: calculateSimilarityScore(analysis, ref)
  }));

  // Filter by minimum similarity and sort
  return matches
    .filter(match => match.similarityScore >= minSimilarity)
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, maxResults);
}

/**
 * Calculate similarity score between analysis and canonical reference
 */
function calculateSimilarityScore(
  analysis: BaggageAnalysis,
  reference: CanonicalReference
): number {
  let score = 0;
  let maxScore = 0;

  // Brand match (high weight)
  maxScore += 30;
  if (analysis.brand_guess && reference.brand.toLowerCase() === analysis.brand_guess.toLowerCase()) {
    score += 30;
  } else if (analysis.brand_guess && reference.brand.toLowerCase().includes(analysis.brand_guess.toLowerCase())) {
    score += 15; // Partial match
  }

  // Size class match (medium weight)
  maxScore += 20;
  if (analysis.size_class && reference.sizeClass === analysis.size_class) {
    score += 20;
  }

  // Material match (medium weight)
  maxScore += 15;
  if (analysis.material && reference.visualSignature.material === analysis.material) {
    score += 15;
  }

  // Wheel count match (medium weight)
  maxScore += 15;
  if (analysis.wheels?.count !== null && reference.visualSignature.wheels.count === analysis.wheels.count) {
    score += 15;
  }

  // Color match (medium weight)
  maxScore += 10;
  if (analysis.colors?.primary) {
    const analysisColor = analysis.colors.primary.toLowerCase();
    const refColor = reference.visualSignature.colors.primary.toLowerCase();

    if (analysisColor === refColor) {
      score += 10;
    } else if (analysisColor.includes(refColor) || refColor.includes(analysisColor)) {
      score += 5;
    }
  }

  // Feature overlap (low weight)
  maxScore += 10;
  if (analysis.features && analysis.features.length > 0) {
    const featureOverlap = analysis.features.filter(f =>
      reference.visualSignature.keyFeatures.some(kf => kf.toLowerCase().includes(f.toLowerCase()))
    ).length;
    score += (featureOverlap / Math.max(analysis.features.length, 1)) * 10;
  }

  // Return normalized score (0-1)
  return maxScore > 0 ? Math.min(score / maxScore, 1) : 0;
}

/**
 * Validate baggage analysis against canonical references
 */
export async function validateAgainstCanonical(
  analysis: BaggageAnalysis
): Promise<ValidationResult> {
  // First, try to find existing references
  const matches = await findMatchingReferences(analysis, {
    brandRequired: false, // We'll try without brand first
    minSimilarity: 0.6
  });

  if (matches.length > 0) {
    const bestMatch = matches[0];
    const dimensionDiff = compareDimensions(
      analysis.dimensions_cm,
      bestMatch.officialDimensions
    );

    return {
      status: dimensionDiff.withinTolerance ? 'validated' : 'flagged',
      canonicalReference: bestMatch,
      dimensionDifference: dimensionDiff,
      reason: dimensionDiff.withinTolerance
        ? 'Dimensions match known specifications'
        : `Dimensions differ from canonical by ${dimensionDiff.maxDiff}cm`,
      suggestedAction: dimensionDiff.withinTolerance
        ? 'Proceed with confidence'
        : 'Verify dimensions or confirm this is a different model'
    };
  }

  // No match found - should we create a new reference?
  if (analysis.brand_guess) {
    return {
      status: 'no-match',
      reason: 'No matching canonical reference found for this baggage',
      suggestedAction: 'Search web for specifications to create new canonical reference'
    };
  }

  return {
    status: 'unknown-brand',
    reason: 'Brand not detected, cannot search for specifications',
    suggestedAction: 'Confirm brand to enable web search validation'
  };
}

/**
 * Compare estimated dimensions against official dimensions
 */
function compareDimensions(
  estimated: BaggageAnalysis['dimensions_cm'],
  official: { width: number; height: number; depth: number }
) {
  if (!estimated || estimated.width === null || estimated.height === null || estimated.depth === null) {
    return {
      width: 0,
      height: 0,
      depth: 0,
      maxDiff: 0,
      withinTolerance: false
    };
  }

  const widthDiff = Math.abs(estimated.width - official.width);
  const heightDiff = Math.abs(estimated.height - official.height);
  const depthDiff = Math.abs(estimated.depth - official.depth);

  const maxDiff = Math.max(widthDiff, heightDiff, depthDiff);
  const withinTolerance = maxDiff < 5; // 5cm tolerance

  return {
    width: widthDiff,
    height: heightDiff,
    depth: depthDiff,
    maxDiff,
    withinTolerance
  };
}

/**
 * Create visual signature from baggage analysis
 */
export function createVisualSignature(analysis: BaggageAnalysis): VisualSignature {
  return {
    colors: {
      primary: analysis.colors?.primary || 'Unknown',
      secondary: analysis.colors?.secondary || undefined
    },
    material: (analysis.material as VisualSignature['material']) || 'unknown',
    wheels: {
      count: analysis.wheels?.count ?? null,
      type: analysis.wheels?.type as any || 'unknown'
    },
    keyFeatures: analysis.features || [],
    shapeHints: analysis.texture ? [analysis.texture] : undefined
  };
}

/**
 * Confirm and increment canonical reference
 */
export async function confirmCanonicalReference(
  referenceId: string,
  confirmedDimensions?: { width: number; height: number; depth: number }
): Promise<void> {
  const supabase = getSupabaseClient();

  const updateData: any = {
    confirmed_count: (await getConfirmedCount(referenceId)) + 1,
    last_confirmed_at: new Date().toISOString()
  };

  // Optional: Update dimensions if they're consistently different
  if (confirmedDimensions) {
    // Could implement logic here to adjust official dimensions
    // if multiple users confirm different measurements
  }

  const { error } = await supabase
    .from('canonical_references')
    .update(updateData)
    .eq('id', referenceId);

  if (error) {
    console.error('Error confirming canonical reference:', error);
    throw error;
  }
}

/**
 * Get current confirmation count for a reference
 */
async function getConfirmedCount(referenceId: string): Promise<number> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('canonical_references')
    .select('confirmed_count')
    .eq('id', referenceId)
    .single();

  return data?.confirmed_count || 0;
}

/**
 * Save new canonical reference
 */
export async function saveCanonicalReference(
  reference: Omit<CanonicalReference, 'id' | 'createdAt' | 'updatedAt' | 'confirmedCount' | 'firstSeenAt'>
): Promise<string> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('canonical_references')
    .insert({
      brand: reference.brand,
      model: reference.model,
      size_class: reference.sizeClass,
      official_dimensions: reference.officialDimensions,
      visual_signature: reference.visualSignature,
      dimension_source: reference.dimensionSource,
      source_url: reference.sourceUrl,
      confidence: reference.confidence,
      metadata: reference.metadata,
      confirmed_count: 1,
      first_seen_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error saving canonical reference:', error);
    throw error;
  }

  return data.id;
}

/**
 * Search for existing canonical by brand and size
 */
export async function findCanonicalByBrandAndSize(
  brand: string,
  sizeClass?: string
): Promise<CanonicalReference[]> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('canonical_references')
    .select('*')
    .ilike('brand', `%${brand}%`);

  if (sizeClass) {
    query = query.eq('size_class', sizeClass);
  }

  query = query
    .gte('confirmed_count', 1)
    .order('confirmed_count', { ascending: false });

  const { data, error } = await query;

  if (error) {
    console.error('Error finding canonical by brand:', error);
    return [];
  }

  return (data || []) as CanonicalReference[];
}
