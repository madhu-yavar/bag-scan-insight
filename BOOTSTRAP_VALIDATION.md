# Bootstrap Validation System

Automated dimension validation using web search and canonical references.

## How It Works

1. **First Upload**: When a bag is analyzed, the system searches for matching canonical references
2. **No Match**: If no canonical exists, web search finds manufacturer/retailer specifications
3. **Canonical Created**: Official dimensions are stored as a canonical reference
4. **Subsequent Uploads**: Future bags are validated against the canonical database

## Setup

### 1. Run Database Migration

```bash
# Apply the canonical references table migration
cd supabase/migrations
# Migration will be applied automatically in development
```

### 2. Configure Web Search (Optional)

Add one of these to your `.env`:

```bash
# Option 1: Google Custom Search API
GOOGLE_SEARCH_API_KEY=your_api_key
GOOGLE_SEARCH_ENGINE_ID=your_cx_id
SEARCH_PROVIDER=google

# Option 2: SerpAPI
SERPAPI_KEY=your_key
SEARCH_PROVIDER=serpapi

# Without web search, the system still works via manual canonical creation
```

### 3. Environment Variables

```bash
# Required (already configured for Supabase)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Optional (for web search)
SEARCH_PROVIDER=google|serpapi
GOOGLE_SEARCH_API_KEY=xxx
GOOGLE_SEARCH_ENGINE_ID=xxx
```

## Usage

### Basic Usage

```typescript
import { analyzeWithValidation } from '@/lib/enhanced-analysis.server';

const result = await analyzeWithValidation({
  images: baggageImages,
  model: 'google/gemini-3-flash-preview',
  enableBootstrap: true,
  autoWebSearch: true
});

console.log(result.validation.status); // 'validated' | 'flagged' | 'canonical-created'
```

### Manual Canonical Creation

```typescript
import { createCanonicalManual } from '@/lib/bootstrap-validation.server';

await createCanonicalManual({
  brand: 'Samsonite',
  model: 'Winfield 3',
  sizeClass: 'medium',
  dimensions: { width: 55, height: 75, depth: 30 },
  sourceUrl: 'https://samsonite.com/winfield-3'
});
```

### Search Existing Canons

```typescript
import { searchCanonicalByBrand } from '@/lib/bootstrap-validation.server';

const results = await searchCanonicalByBrand({
  brand: 'Carlton',
  sizeClass: 'medium'
});
```

## API Reference

### Server Functions

#### `analyzeWithValidation`
Enhanced baggage analysis with bootstrap validation

```typescript
analyzeWithValidation({
  images: LocalScanImageInput[],
  model?: string,
  enableBootstrap?: boolean,
  autoWebSearch?: boolean
})
```

#### `validateWithBootstrap`
Validate existing analysis against canonical references

```typescript
validateWithBootstrap({
  analysis: BaggageAnalysis,
  autoSearch?: boolean
})
```

#### `createCanonicalManual`
Manually create a canonical reference

```typescript
createCanonicalManual({
  brand: string,
  model?: string,
  sizeClass: string,
  dimensions: { width, height, depth },
  sourceUrl?: string,
  analysis?: BaggageAnalysis
})
```

#### `confirmCanonical`
Confirm and increment a canonical reference

```typescript
confirmCanonical({
  referenceId: string,
  confirmedDimensions?: { width, height, depth }
})
```

## Validation Statuses

| Status | Description | Action |
|--------|-------------|--------|
| `validated` | Dimensions match canonical | Proceed with confidence |
| `flagged` | Dimensions differ from canonical | Verify or confirm different model |
| `no-match` | No canonical found | Web search or manual creation |
| `unknown-brand` | Brand not detected | Manual brand input needed |
| `canonical-created` | New canonical created via web search | First of its kind! |
| `specs-not-found` | Web search found no specs | Manual entry required |

## Dimension Tolerance

Default tolerance is **5cm** per dimension. This accounts for:
- AI estimation errors
- Measurement rounding
- Different measurement methods

## Contributing Canonicals

The system improves with use. Each time a bag is uploaded and validated:
1. The canonical `confirmedCount` increases
2. Future matches become more reliable
3. The database grows organically

## Limitations

- Web search requires API configuration
- First-time uploads without web search need manual canonical creation
- Dimension accuracy depends on manufacturer specifications
- Visual matching may have false positives for similar-looking bags

## Future Enhancements

- [ ] Community voting on dimensions
- [ ] Image-based similarity search
- [ ] Automatic tolerance adjustment based on confidence
- [ ] Multiple canonical management for same model (different years)
- [ ] Retailer price tracking
- [ ] Dimension adjustment over time based on user confirmations
