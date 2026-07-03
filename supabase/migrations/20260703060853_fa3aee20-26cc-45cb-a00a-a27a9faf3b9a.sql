
CREATE TYPE public.baggage_view AS ENUM ('front','back','top','side');
CREATE TYPE public.scan_status AS ENUM ('pending','analyzing','completed','failed');

CREATE TABLE public.scans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled scan',
  notes TEXT,
  model TEXT NOT NULL DEFAULT 'gemini',
  status public.scan_status NOT NULL DEFAULT 'pending',
  analysis JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scans TO authenticated;
GRANT ALL ON public.scans TO service_role;
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their scans" ON public.scans FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.scan_images (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES public.scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  view public.baggage_view NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(scan_id, view)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_images TO authenticated;
GRANT ALL ON public.scan_images TO service_role;
ALTER TABLE public.scan_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their scan images" ON public.scan_images FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX scans_user_created_idx ON public.scans(user_id, created_at DESC);
CREATE INDEX scan_images_scan_idx ON public.scan_images(scan_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_scans_updated_at BEFORE UPDATE ON public.scans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage policies for the baggage-images bucket (bucket is created via tool)
CREATE POLICY "Users read own baggage images" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'baggage-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own baggage images" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'baggage-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own baggage images" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'baggage-images' AND auth.uid()::text = (storage.foldername(name))[1]);
