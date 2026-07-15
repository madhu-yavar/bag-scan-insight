create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

insert into storage.buckets (id, name, public)
values ('bagscan-photos', 'bagscan-photos', false)
on conflict (id) do nothing;

create table public.bagscan_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text,
  notes text,
  status text not null default 'completed' check (status in ('draft', 'completed', 'failed', 'needs_review')),
  model text not null,
  analysis_version text not null default 'local-gemini-v1',
  manual_dimensions_json jsonb,
  approved_review_views jsonb not null default '[]'::jsonb,
  capture_validation_status text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.bagscan_images (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.bagscan_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  view text not null check (view in ('front', 'back', 'top', 'side')),
  storage_bucket text not null default 'bagscan-photos',
  storage_path text not null,
  mime_type text not null,
  bytes bigint not null,
  width_px integer,
  height_px integer,
  view_validation_status text,
  view_confidence numeric,
  quality_score numeric,
  identity_score numeric,
  created_at timestamptz not null default now(),
  unique (scan_id, view)
);

create table public.bagscan_extractions (
  scan_id uuid primary key references public.bagscan_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text,
  bag_type text,
  size_class text,
  brand_guess text,
  width_cm numeric,
  height_cm numeric,
  depth_cm numeric,
  volume_liters numeric generated always as (
    case
      when width_cm is not null and height_cm is not null and depth_cm is not null
      then round((width_cm * height_cm * depth_cm / 1000.0)::numeric, 2)
      else null
    end
  ) stored,
  dimension_confidence text,
  dimension_basis text,
  primary_color text,
  secondary_color text,
  material text,
  texture text,
  wheel_count integer,
  wheel_type text,
  handle_count integer,
  overall_condition text,
  capture_validation_status text,
  identity_score numeric,
  quality_score numeric,
  raw_analysis jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bagscan_damage_findings (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.bagscan_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  location text,
  damage_type text,
  severity text,
  description text,
  confidence text,
  created_at timestamptz not null default now()
);

create table public.bagscan_validation_events (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid references public.bagscan_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  view text check (view in ('front', 'back', 'top', 'side')),
  event_type text not null check (
    event_type in ('view_validation', 'identity_validation', 'final_analysis')
  ),
  accepted boolean,
  score numeric,
  confidence text,
  reason text,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

create index idx_bagscan_sessions_user_created_at
  on public.bagscan_sessions (user_id, created_at desc);
create index idx_bagscan_sessions_created_at
  on public.bagscan_sessions (created_at desc);
create index idx_bagscan_sessions_status
  on public.bagscan_sessions (status);

create index idx_bagscan_images_scan_id
  on public.bagscan_images (scan_id);
create index idx_bagscan_images_user_view
  on public.bagscan_images (user_id, view);

create index idx_bagscan_extractions_user_created_at
  on public.bagscan_extractions (user_id, created_at desc);
create index idx_bagscan_extractions_bag_type
  on public.bagscan_extractions (bag_type);
create index idx_bagscan_extractions_size_class
  on public.bagscan_extractions (size_class);
create index idx_bagscan_extractions_condition
  on public.bagscan_extractions (overall_condition);
create index idx_bagscan_extractions_dimensions
  on public.bagscan_extractions (width_cm, height_cm, depth_cm);
create index idx_bagscan_extractions_raw_analysis_gin
  on public.bagscan_extractions using gin (raw_analysis);

create index idx_bagscan_damage_scan_id
  on public.bagscan_damage_findings (scan_id);
create index idx_bagscan_damage_type
  on public.bagscan_damage_findings (damage_type);
create index idx_bagscan_damage_severity
  on public.bagscan_damage_findings (severity);

create index idx_bagscan_validation_scan_id
  on public.bagscan_validation_events (scan_id);
create index idx_bagscan_validation_user_created_at
  on public.bagscan_validation_events (user_id, created_at desc);
create index idx_bagscan_validation_type
  on public.bagscan_validation_events (event_type);

create trigger update_bagscan_sessions_updated_at
  before update on public.bagscan_sessions
  for each row execute function public.update_updated_at_column();

create trigger update_bagscan_extractions_updated_at
  before update on public.bagscan_extractions
  for each row execute function public.update_updated_at_column();

grant select, insert, update, delete on public.bagscan_sessions to authenticated;
grant select, insert, update, delete on public.bagscan_images to authenticated;
grant select, insert, update, delete on public.bagscan_extractions to authenticated;
grant select, insert, update, delete on public.bagscan_damage_findings to authenticated;
grant select, insert, update, delete on public.bagscan_validation_events to authenticated;

grant all on public.bagscan_sessions to service_role;
grant all on public.bagscan_images to service_role;
grant all on public.bagscan_extractions to service_role;
grant all on public.bagscan_damage_findings to service_role;
grant all on public.bagscan_validation_events to service_role;

alter table public.bagscan_sessions enable row level security;
alter table public.bagscan_images enable row level security;
alter table public.bagscan_extractions enable row level security;
alter table public.bagscan_damage_findings enable row level security;
alter table public.bagscan_validation_events enable row level security;

create policy "Owners manage bagscan sessions"
on public.bagscan_sessions for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Owners manage bagscan images"
on public.bagscan_images for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Owners manage bagscan extractions"
on public.bagscan_extractions for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Owners manage bagscan damage findings"
on public.bagscan_damage_findings for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Owners manage bagscan validation events"
on public.bagscan_validation_events for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users read own bagscan photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'bagscan-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users upload own bagscan photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'bagscan-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users update own bagscan photos"
on storage.objects for update
to authenticated
using (
  bucket_id = 'bagscan-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'bagscan-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users delete own bagscan photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'bagscan-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create or replace view public.bagscan_analytics_daily_scans
with (security_invoker = true) as
select
  date_trunc('day', created_at) as day,
  user_id,
  count(*) as scan_count,
  count(*) filter (where status = 'completed') as completed_count,
  count(*) filter (where status = 'needs_review') as needs_review_count,
  count(*) filter (where status = 'failed') as failed_count
from public.bagscan_sessions
group by 1, 2;

create or replace view public.bagscan_analytics_type_distribution
with (security_invoker = true) as
select
  user_id,
  coalesce(bag_type, 'unknown') as bag_type,
  count(*) as scan_count
from public.bagscan_extractions
group by user_id, coalesce(bag_type, 'unknown');

create or replace view public.bagscan_analytics_view_quality
with (security_invoker = true) as
select
  user_id,
  view,
  count(*) as image_count,
  avg(quality_score) as avg_quality_score,
  avg(identity_score) as avg_identity_score,
  count(*) filter (where view_validation_status is not null and view_validation_status <> 'accepted') as rejected_count
from public.bagscan_images
group by user_id, view;

grant select on public.bagscan_analytics_daily_scans to authenticated;
grant select on public.bagscan_analytics_type_distribution to authenticated;
grant select on public.bagscan_analytics_view_quality to authenticated;
