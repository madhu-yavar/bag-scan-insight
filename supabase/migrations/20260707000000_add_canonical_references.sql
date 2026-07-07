-- Canonical reference table for storing manufacturer/retailer baggage specifications
CREATE TYPE public.dimension_source AS ENUM ('manufacturer', 'retailer', 'community', 'unknown');
CREATE TYPE public.confidence_level AS ENUM ('low', 'medium', 'high');

CREATE TABLE public.canonical_references (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand TEXT NOT NULL,
  model TEXT,
  size_class TEXT NOT NULL,
  official_dimensions JSONB NOT NULL, -- {width, height, depth, source, url}
  visual_signature JSONB NOT NULL, -- {colors, features, material, wheel_count, etc.}
  dimension_source public.dimension_source NOT NULL DEFAULT 'unknown',
  source_url TEXT,
  confidence public.confidence_level NOT NULL DEFAULT 'low',
  confirmed_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_confirmed_at TIMESTAMPTZ,
  metadata JSONB, -- Additional data like search results, screenshots, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient matching
CREATE INDEX canonical_brand_idx ON public.canonical_references(brand);
CREATE INDEX canonical_size_class_idx ON public.canonical_references(size_class);
CREATE INDEX canonical_confirmed_idx ON public.canonical_references(confirmed_count DESC);
CREATE INDEX canonical_signature_idx ON public.canonical_references USING GIN(visual_signature);

-- RLS policies
GRANT SELECT, INSERT, UPDATE ON public.canonical_references TO authenticated;
GRANT ALL ON public.canonical_references TO service_role;
ALTER TABLE public.canonical_references ENABLE ROW LEVEL SECURITY;

-- Read-only for all authenticated users (they can read but not modify others' data)
CREATE POLICY "Users read canonical references" ON public.canonical_references FOR SELECT
  TO authenticated USING (true);

-- Only service role can write (via server functions)
CREATE POLICY "Service role manages canonical references" ON public.canonical_references FOR ALL
  TO service_role USING (true);

-- Updated at trigger
CREATE TRIGGER update_canonical_references_updated_at BEFORE UPDATE ON public.canonical_references
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
