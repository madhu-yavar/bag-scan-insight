/**
 * Web search for baggage dimension extraction
 * Searches manufacturer/retailer sites to find official specifications
 */

import { WebSearchResult, ExtractedDimensions, OfficialDimensions, DimensionSource, ConfidenceLevel } from './canonical-references.types';

/**
 * Search for baggage specifications using web search
 */
export async function searchBaggageSpecs(params: {
  brand: string;
  sizeClass?: string;
  material?: string;
}): Promise<WebSearchResult[]> {
  const { brand, sizeClass, material } = params;

  // Build search query focused on finding official specifications
  const queryParts = [
    `${brand} suitcase`,
    sizeClass && `${sizeClass} size`,
    material && material,
    'dimensions cm',
    'specifications'
  ].filter(Boolean);

  const searchQuery = queryParts.join(' ');

  try {
    const results = await performWebSearch(searchQuery);
    return results.filter(result =>
      // Filter out generic results, focus on retailers/manufacturers
      isRelevantBaggageSite(result.url) &&
      result.snippet.toLowerCase().includes(brand.toLowerCase())
    );
  } catch (error) {
    console.error('Web search failed:', error);
    return [];
  }
}

/**
 * Extract dimensions from web search results
 */
export async function extractDimensionsFromResults(
  searchResults: WebSearchResult[],
  brand: string
): Promise<ExtractedDimensions[]> {
  const extracted: ExtractedDimensions[] = [];

  for (const result of searchResults) {
    const dimensions = await attemptDimensionExtraction(result, brand);
    if (dimensions.dimensions) {
      extracted.push(dimensions);
    }
  }

  // Sort by confidence and return
  return extracted.sort((a, b) => {
    const confidenceOrder = { high: 3, medium: 2, low: 1 };
    return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
  });
}

/**
 * Attempt to extract dimensions from a single search result
 */
async function attemptDimensionExtraction(
  result: WebSearchResult,
  brand: string
): Promise<ExtractedDimensions> {
  const sourceType = determineSourceType(result.url);

  // Try to extract from snippet first
  const fromSnippet = extractDimensionsFromText(result.snippet);
  if (fromSnippet) {
    return {
      dimensions: {
        ...fromSnippet,
        source: result.url,
        confidence: sourceType === 'manufacturer' ? 'high' : 'medium',
        unit: 'cm'
      },
      sourceUrl: result.url,
      sourceType,
      confidence: sourceType === 'manufacturer' ? 'high' : 'medium',
      rawText: result.snippet
    };
  }

  // If snippet doesn't contain dimensions, we'd need to fetch the page
  // For MVP, return null and rely on manual confirmation later
  return {
    dimensions: null,
    sourceUrl: result.url,
    sourceType,
    confidence: 'low',
    rawText: result.snippet
  };
}

/**
 * Extract dimensions from text using regex patterns
 */
function extractDimensionsFromText(text: string): OfficialDimensions | null {
  // Common patterns for dimensions (e.g., "55 x 35 x 20 cm", "55×35×20cm")
  const patterns = [
    /(\d+)\s*[x××]\s*(\d+)\s*[x××]\s*(\d+)\s*(?:cm|cm\.|centimeters?)/i,
    /(\d+)\s*[x××]\s*(\d+)\s*[x××]\s*(\d+)\s*(?:in|inches?)/i,
    /(\d+)\s*[x××]\s*(\d+)\s*[x××]\s*(\d+)/i, // Fallback without unit
    /(?:width|w|wide|breadth)[:\s]+(\d+)\s*(?:cm|in)?\s*(?:height|h|high|tall|length)[:\s]+(\d+)\s*(?:cm|in)?\s*(?:depth|d|deep|thick)[:\s]+(\d+)\s*(?:cm|in)?/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const [, w, h, d] = match.map(Number);

      // Sanity check: reasonable baggage dimensions
      if (w >= 20 && w <= 100 && h >= 30 && h <= 130 && d >= 10 && d <= 60) {
        return {
          width: w,
          height: h,
          depth: d,
          source: 'extracted-from-text',
          unit: 'cm',
          confidence: 'medium'
        };
      }
    }
  }

  // Try to find individual dimension mentions
  const width = text.match(/width[:\s]+(\d+)\s*(?:cm|in)/i)?.[1];
  const height = text.match(/height[:\s]+(\d+)\s*(?:cm|in)/i)?.[1];
  const depth = text.match(/depth[:\s]+(\d+)\s*(?:cm|in)/i)?.[1];

  if (width && height && depth) {
    return {
      width: Number(width),
      height: Number(height),
      depth: Number(depth),
      source: 'extracted-from-text',
      unit: 'cm',
      confidence: 'medium'
    };
  }

  return null;
}

/**
 * Determine if a URL is from a manufacturer or retailer
 */
function determineSourceType(url: string): DimensionSource {
  const manufacturers = [
    'samsonite.com', 'travelpro.com', 'away.com', 'briggs-riley.com',
    'victorinox.com', 'delsey.com', 'american-tourister.com', 'carlton.com',
    'rimowa.com', 'tumi.com'
  ];

  const retailers = [
    'amazon.com', 'amazon.co.uk', 'ebay.com', 'walmart.com',
    'target.com', 'johnlewis.com', 'argos.co.uk', 'dickssportinggoods.com',
    'rei.com', 'backcountry.com'
  ];

  const hostname = new URL(url).hostname.toLowerCase();

  if (manufacturers.some(m => hostname.includes(m.replace('.com', '')))) {
    return 'manufacturer';
  }

  if (retailers.some(r => hostname.includes(r.replace('.com', '').replace('.co.uk', '')))) {
    return 'retailer';
  }

  return 'unknown';
}

/**
 * Check if a URL is from a relevant baggage site
 */
function isRelevantBaggageSite(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Filter out social media, news, etc.
    const excludedDomains = [
      'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com',
      'reddit.com', 'pinterest.com', 'linkedin.com', 'tiktok.com',
      'news.google.com', 'news.yahoo.com'
    ];

    if (excludedDomains.some(d => hostname.includes(d))) {
      return false;
    }

    // Prioritize e-commerce and manufacturer sites
    const goodTlds = ['.com', '.co.uk', '.co.in', '.com.au', '.de', '.fr', '.ca'];
    const hasGoodTld = goodTlds.some(tld => hostname.endsWith(tld));

    return hasGoodTld || !hostname.includes('.');
  } catch {
    return false;
  }
}

/**
 * Perform actual web search (implementation depends on search provider)
 * This is a placeholder - you'd integrate with:
 * - Google Search API
 * - Bing Search API
 * - SerpAPI
 * - DuckDuckGo
 * - Or your preferred search service
 */
async function performWebSearch(query: string): Promise<WebSearchResult[]> {
  // TODO: Implement actual web search integration
  // For now, return empty array - this should be replaced with real search

  const searchProvider = process.env.SEARCH_PROVIDER || 'google';

  switch (searchProvider) {
    case 'google': {
      // Google Custom Search API implementation
      // const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
      // const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
      // const response = await fetch(`https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`);
      // const data = await response.json();
      // return data.items?.map(item => ({ title: item.title, url: item.link, snippet: item.snippet })) || [];
      break;
    }
    case 'serpapi': {
      // SerpAPI implementation
      // const apiKey = process.env.SERPAPI_KEY;
      // const response = await fetch(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${apiKey}`);
      // const data = await response.json();
      // return data.organic_results?.map(item => ({ title: item.title, url: item.link, snippet: item.snippet })) || [];
      break;
    }
    default:
      console.warn('No web search provider configured');
  }

  return [];
}

/**
 * Convert inches to centimeters
 */
export function inchesToCm(inches: number): number {
  return Math.round(inches * 2.54);
}

/**
 * Convert centimeters to inches
 */
export function cmToInches(cm: number): number {
  return Math.round(cm / 2.54 * 10) / 10;
}
