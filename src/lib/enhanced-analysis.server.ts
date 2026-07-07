/**
 * Enhanced analysis integration
 * Combines AI analysis with bootstrap validation
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { analyzeBaggage } from './scans.functions';
import { validateWithBootstrap } from './bootstrap-validation.server';

/**
 * Enhanced analysis that includes bootstrap validation
 */
export const analyzeWithValidation = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => {
    const schema = z.object({
      images: z.array(
        z.object({
          view: z.enum(['front', 'back', 'top', 'side']),
          data_url: z.string().startsWith('data:image/')
        })
      ).min(1).max(4),
      model: z.enum([
        'google/gemini-3-flash-preview',
        'google/gemini-2.5-flash',
        'google/gemini-2.5-pro'
      ]).default('google/gemini-3-flash-preview'),
      enableBootstrap: z.boolean().default(true), // Enable bootstrap validation
      autoWebSearch: z.boolean().default(true) // Auto-search if no canonical match
    });
    return schema.parse(input);
  })
  .handler(async ({ data }) => {
    // Step 1: Perform AI analysis
    const analysisResult = await analyzeBaggage({
      images: data.images,
      model: data.model
    });

    // Step 2: Apply bootstrap validation if enabled
    let validationResult = null;
    if (data.enableBootstrap) {
      try {
        validationResult = await validateWithBootstrap({
          analysis: analysisResult.analysis,
          autoSearch: data.autoWebSearch
        });
      } catch (error) {
        console.error('Bootstrap validation failed:', error);
        // Continue without validation - non-blocking
        validationResult = {
          status: 'validation-failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    // Step 3: Enhance analysis with validation results
    const enhancedAnalysis = {
      ...analysisResult.analysis,
      _bootstrap: validationResult ? {
        status: validationResult.status,
        canonicalMatch: validationResult.canonicalReference,
        dimensionValidation: validationResult.dimensionDifference,
        recommendedAction: validationResult.suggestedAction,
        webSearchPerformed: validationResult.webSearchPerformed
      } : null
    };

    return {
      analysis: enhancedAnalysis,
      model: analysisResult.model,
      validation: validationResult
    };
  });

/**
 * Quick validation only (for existing analyses)
 */
export const validateExistingAnalysis = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => {
    const schema = z.object({
      analysis: z.any(), // BaggageAnalysis
      autoWebSearch: z.boolean().default(false) // Don't auto-search by default
    });
    return schema.parse(input);
  })
  .handler(async ({ data }) => {
    return await validateWithBootstrap({
      analysis: data.analysis,
      autoSearch: data.autoWebSearch
    });
  });

/**
 * Batch validate multiple analyses
 */
export const batchValidateAnalyses = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => {
    const schema = z.object({
      analyses: z.array(z.any()), // Array of BaggageAnalysis
      autoWebSearch: z.boolean().default(false)
    });
    return schema.parse(input);
  })
  .handler(async ({ data }) => {
    const results = await Promise.allSettled(
      data.analyses.map(analysis =>
        validateWithBootstrap({
          analysis,
          autoSearch: data.autoWebSearch
        })
      )
    );

    return {
      results: results.map((result, index) => ({
        index,
        status: result.status === 'fulfilled' ? result.value.status : 'error',
        data: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? result.reason : null
      })),
      summary: {
        total: data.analyses.length,
        validated: results.filter(r => r.status === 'fulfilled' && r.value.status === 'validated').length,
        flagged: results.filter(r => r.status === 'fulfilled' && r.value.status === 'flagged').length,
        failed: results.filter(r => r.status === 'rejected').length
      }
    };
  });
