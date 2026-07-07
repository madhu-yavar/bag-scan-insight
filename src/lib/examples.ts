/**
 * Usage examples for the bootstrap validation system
 */

import type { BaggageAnalysis, ValidationResult } from './canonical-references.types';

/**
 * Example 1: Basic validation flow
 */
export async function exampleBasicValidation() {
  // After getting AI analysis
  const analysis: BaggageAnalysis = {
    summary: 'A black Carlton medium-sized hard-shell spinner suitcase',
    brand_guess: 'Carlton',
    size_class: 'medium',
    dimensions_cm: { width: 48, height: 72, depth: 28, confidence: 'low' },
    colors: { primary: 'Black (#1A1A1A)' },
    material: 'hard-shell',
    wheels: { count: 4, type: 'spinner' },
    features: ['telescopic-handle']
  };

  // Validate against canonical references
  const { validateWithBootstrap } = await import('./bootstrap-validation.server');

  const result = await validateWithBootstrap({
    analysis,
    autoSearch: true
  });

  console.log('Validation result:', result);
  // Output: { status: 'validated', canonicalReference: {...}, dimensionDifference: {...} }
}

/**
 * Example 2: Enhanced analysis with built-in validation
 */
export async function exampleEnhancedAnalysis() {
  const baggageImages = [
    { view: 'front' as const, data_url: 'data:image/jpeg;base64,...' },
    { view: 'side' as const, data_url: 'data:image/jpeg;base64,...' }
  ];

  const { analyzeWithValidation } = await import('./enhanced-analysis.server');

  const result = await analyzeWithValidation({
    images: baggageImages,
    model: 'google/gemini-3-flash-preview',
    enableBootstrap: true,
    autoWebSearch: true
  });

  console.log('Analysis:', result.analysis);
  console.log('Validation status:', result.validation?.status);
}

/**
 * Example 3: Manual canonical creation
 */
export async function exampleManualCreation() {
  const { createCanonicalManual } = await import('./bootstrap-validation.server');

  const result = await createCanonicalManual({
    brand: 'Samsonite',
    model: 'Winfield 3 Ultra',
    sizeClass: 'medium',
    dimensions: { width: 55, height: 75, depth: 30 },
    sourceUrl: 'https://samsonite.com/products/winfield-3-ultra'
  });

  console.log('Created canonical:', result.canonical);
}

/**
 * Example 4: Searching existing canonicals
 */
export async function exampleSearchCanonicals() {
  const { searchCanonicalByBrand } = await import('./bootstrap-validation.server');

  const { results } = await searchCanonicalByBrand({
    brand: 'Carlton',
    sizeClass: 'medium'
  });

  console.log('Found canonicals:', results);
}

/**
 * Example 5: Confirming a canonical reference
 */
export async function exampleConfirmCanonical() {
  const { confirmCanonical } = await import('./bootstrap-validation.server');

  // After operator confirms dimensions are correct
  await confirmCanonical({
    referenceId: 'some-uuid',
    confirmedDimensions: { width: 55, height: 75, depth: 30 }
  });
}

/**
 * Example 6: Handling validation results in UI
 */
export function exampleValidationHandler(validation: ValidationResult) {
  switch (validation.status) {
    case 'validated':
      return {
        message: 'Dimensions verified against official specifications',
        variant: 'success',
        showConfirmButton: false
      };

    case 'flagged':
      return {
        message: `Dimensions differ by ${validation.dimensionDifference?.maxDiff}cm from known specs`,
        variant: 'warning',
        showConfirmButton: true,
        canonicalData: validation.canonicalReference?.officialDimensions
      };

    case 'no-match':
      return {
        message: 'No matching reference found - searching for specifications...',
        variant: 'info',
        showWebSearchStatus: true
      };

    case 'canonical-created':
      return {
        message: `New reference created for ${validation.canonicalReference?.brand}`,
        variant: 'success',
        showNewCanonical: true
      };

    default:
      return {
        message: 'Could not validate dimensions',
        variant: 'neutral'
      };
  }
}

/**
 * Example 7: Dimension comparison display
 */
export function formatDimensionComparison(
  estimated: BaggageAnalysis['dimensions_cm'],
  canonical: { width: number; height: number; depth: number }
) {
  if (!estimated || estimated.width === null) return null;

  return {
    width: {
      estimated: estimated.width,
      canonical: canonical.width,
      diff: Math.abs(estimated.width - canonical.width),
      status: Math.abs(estimated.width - canonical.width) < 5 ? '✓' : '⚠'
    },
    height: {
      estimated: estimated.height,
      canonical: canonical.height,
      diff: Math.abs(estimated.height - canonical.height),
      status: Math.abs(estimated.height - canonical.height) < 5 ? '✓' : '⚠'
    },
    depth: {
      estimated: estimated.depth,
      canonical: canonical.depth,
      diff: Math.abs(estimated.depth - canonical.depth),
      status: Math.abs(estimated.depth - canonical.depth) < 5 ? '✓' : '⚠'
    }
  };
}
