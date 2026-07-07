/**
 * Bootstrap validation server functions
 * Coordinates web search, canonical matching, and dimension validation
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  searchBaggageSpecs,
  extractDimensionsFromResults
} from './web-search.server';
import {
  validateAgainstCanonical,
  findCanonicalByBrandAndSize,
  saveCanonicalReference,
  confirmCanonicalReference,
  createVisualSignature
} from './canonical-matching.server';
import type {
  BaggageAnalysis,
  ValidationResult,
  CanonicalReference
} from './canonical-references.types';

/**
 * Main bootstrap validation function
 * Either validates against existing canonical or creates new one via web search
 */
export const validateWithBootstrap = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => {
    const schema = z.object({
      analysis: z.any(), // BaggageAnalysis
      autoSearch: z.boolean().default(true) // Auto-trigger web search if no match
    });
    return schema.parse(input);
  })
  .handler(async ({ data }) => {
    const { analysis, autoSearch } = data;

    // Step 1: Try to validate against existing canonical references
    const validationResult = await validateAgainstCanonical(analysis);

    // Step 2: If no match and auto-search is enabled, perform web search
    if (
      (validationResult.status === 'no-match' || validationResult.status === 'unknown-brand') &&
      autoSearch &&
      analysis.brand_guess
    ) {
      const searchResult = await performWebSearchBootstrap(analysis);
      return {
        ...validationResult,
        webSearchPerformed: true,
        ...searchResult
      };
    }

    return {
      ...validationResult,
      webSearchPerformed: false
    };
  });

/**
 * Perform web search to find specifications and create canonical reference
 */
async function performWebSearchBootstrap(
  analysis: BaggageAnalysis
): Promise<{
  canonicalCreated?: boolean;
  canonicalReference?: CanonicalReference;
  searchResults?: any[];
  extractedDimensions?: any;
}> {
  try {
    // Search for specifications
    const searchResults = await searchBaggageSpecs({
      brand: analysis.brand_guess!,
      sizeClass: analysis.size_class,
      material: analysis.material
    });

    if (searchResults.length === 0) {
      return {
        canonicalCreated: false,
        searchResults: [],
        extractedDimensions: null
      };
    }

    // Extract dimensions from search results
    const extractedDimensions = await extractDimensionsFromResults(
      searchResults,
      analysis.brand_guess!
    );

    if (extractedDimensions.length === 0 || !extractedDimensions[0].dimensions) {
      return {
        canonicalCreated: false,
        searchResults,
        extractedDimensions: null
      };
    }

    // Create canonical reference from best extraction
    const bestExtraction = extractedDimensions[0];
    const canonicalReference = await createCanonicalFromExtraction(
      analysis,
      bestExtraction,
      searchResults
    );

    return {
      canonicalCreated: true,
      canonicalReference,
      searchResults,
      extractedDimensions: bestExtraction
    };
  } catch (error) {
    console.error('Web search bootstrap failed:', error);
    return {
      canonicalCreated: false,
      searchResults: [],
      extractedDimensions: null
    };
  }
}

/**
 * Create canonical reference from extracted dimensions
 */
async function createCanonicalFromExtraction(
  analysis: BaggageAnalysis,
  extraction: any,
  searchResults: any[]
): Promise<CanonicalReference> {
  const visualSignature = createVisualSignature(analysis);

  const canonicalData = {
    brand: analysis.brand_guess!,
    model: extraction.model,
    sizeClass: analysis.size_class || 'unknown',
    officialDimensions: extraction.dimensions,
    visualSignature,
    dimensionSource: extraction.sourceType,
    sourceUrl: extraction.sourceUrl,
    confidence: extraction.confidence,
    metadata: {
      searchQuery: `${analysis.brand_guess} ${analysis.size_class} suitcase dimensions`,
      searchResults: searchResults.slice(0, 5), // Store top 5 results
      extractedFrom: extraction.sourceUrl
    }
  };

  const id = await saveCanonicalReference(canonicalData);

  return {
    id,
    ...canonicalData,
    confirmedCount: 1,
    firstSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Manual confirmation of canonical reference (operator overrides)
 */
export const confirmCanonical = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => {
    const schema = z.object({
      referenceId: z.string(),
      confirmedDimensions: z.object({
        width: z.number(),
        height: z.number(),
        depth: z.number()
      }).optional()
    });
    return schema.parse(input);
  })
  .handler(async ({ data }) => {
    await confirmCanonicalReference(data.referenceId, data.confirmedDimensions);
    return { success: true };
  });

/**
 * Search for canonical references by brand
 */
export const searchCanonicalByBrand = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) => {
    const schema = z.object({
      brand: z.string(),
      sizeClass: z.string().optional()
    });
    return schema.parse(input);
  })
  .handler(async ({ data }) => {
    const results = await findCanonicalByBrandAndSize(data.brand, data.sizeClass);
    return { results };
  });

/**
 * Manual canonical reference creation
 */
export const createCanonicalManual = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => {
    const schema = z.object({
      brand: z.string(),
      model: z.string().optional(),
      sizeClass: z.string(),
      dimensions: z.object({
        width: z.number(),
        height: z.number(),
        depth: z.number()
      }),
      sourceUrl: z.string().optional(),
      analysis: z.any().optional() // BaggageAnalysis for visual signature
    });
    return schema.parse(input);
  })
  .handler(async ({ data }) => {
    const visualSignature = data.analysis
      ? createVisualSignature(data.analysis)
      : {
          colors: { primary: 'Unknown' },
          material: 'unknown',
          wheels: { count: null, type: 'unknown' },
          keyFeatures: []
        };

    const canonicalData = {
      brand: data.brand,
      model: data.model,
      sizeClass: data.sizeClass,
      officialDimensions: {
        ...data.dimensions,
        source: data.sourceUrl || 'manual-entry',
        unit: 'cm',
        confidence: 'high' as const
      },
      visualSignature,
      dimensionSource: 'community' as const,
      sourceUrl: data.sourceUrl,
      confidence: 'high' as const,
      metadata: {
        manuallyCreated: true,
        createdAt: new Date().toISOString()
      }
    };

    const id = await saveCanonicalReference(canonicalData);

    return {
      success: true,
      id,
      canonical: {
        id,
        ...canonicalData,
        confirmedCount: 1,
        firstSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
  });

/**
 * Get canonical reference by ID
 */
export const getCanonicalById = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) => {
    return z.object({ id: z.string() }).parse(input);
  })
  .handler(async ({ data }) => {
    const { createClient } = await import('@supabase/supabase-js');

    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('Supabase credentials not found');
    }

    const supabase = createClient(url, key);

    const { data, error } = await supabase
      .from('canonical_references')
      .select('*')
      .eq('id', data.id)
      .single();

    if (error) {
      throw new Error(`Error fetching canonical: ${error.message}`);
    }

    return { canonical: data };
  });
