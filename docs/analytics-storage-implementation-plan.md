# BagScan Analytics Storage Implementation Plan

Status: reviewed and implemented for initial cloud storage/dashboard release  
Created: 2026-07-15  
Scope: persist BagScan photos, Gemini JSON extractions, normalized analytics fields, PNR/travel context, and dashboard-ready metrics.

## 1. Decision Summary

Use Supabase as the primary analytics/storage backend:

- Supabase Auth already protects the app.
- Supabase Postgres is suitable for structured scan metadata, extracted dimensions, quality scores, and dashboard queries.
- Supabase Storage is suitable for private scan photos with signed URL access.
- Raw Gemini responses should be stored as `jsonb`, while high-value analytics fields should also be copied into typed columns.

The implementation uses `bagscan_*` table and view names to avoid colliding with the older
`public.scans` and `public.scan_images` tables used by the original cloud route.

The current VM-local SQLite/filesystem storage remains as a fallback during migration. New successful scans attempt Supabase first, then fall back to local storage if the cloud save fails.

## 2. Current State

Original production storage was local to the VM:

- SQLite DB: `data/bagscan.sqlite`
- Photos: `data/bagscan-images/<scan-id>/`
- Docker persistence: named volume `godigit-data`

Current saved scan data:

- `scans.analysis_json` stores full Gemini output.
- `scans.summary`, `bag_type`, `overall_condition`, and `capture_validation_status` are extracted into columns.
- `scan_images` stores one local file path per view.
- Saved report routes read images back from the VM filesystem as data URLs.

This works for demos and a single VM, but it is weak for analytics and long-term operation:

- analytics fields are mostly buried inside JSON
- photos are tied to one machine
- backups are manual
- multi-instance deployment would break image access
- dashboard queries would be inefficient and harder to secure

Implemented cloud path:

- Supabase Storage bucket: `bagscan-photos`
- Supabase Postgres tables: `bagscan_sessions`, `bagscan_images`, `bagscan_extractions`, `bagscan_damage_findings`, and `bagscan_validation_events`
- Travel context columns on `bagscan_sessions`: PNR, PNR hash, airline, flight number/date,
  departure/arrival airport, terminal, bag tag, baggage category, manual weight, and special handling.
- Dashboard route: `/dashboard`
- Report routes: `/reports-local` and `/reports-local/$id` read cloud data first, then local fallback

## 3. Goals

1. Persist every completed scan in cloud storage.
2. Persist all four photos for each scan.
3. Persist raw Gemini JSON exactly as returned.
4. Persist normalized fields for analytics:
   - dimensions
   - PNR and flight context
   - airline, airport, terminal, bag tag, and manual weight
   - baggage type
   - material
   - colors
   - texture
   - wheels
   - damage
   - quality and validation scores
5. Build dashboard-ready tables/views without re-parsing JSON in the UI.
6. Keep the scan flow resilient if a save fails.
7. Preserve user ownership and operator auditability.

## 4. Non-Goals For First Implementation

- BigQuery warehouse.
- ML model training pipeline.
- Public image URLs.
- Multi-tenant organization hierarchy beyond user/operator ownership.
- Replacing Supabase Auth.
- Rebuilding the UI design system.

These can be added later if volume or product needs justify them.

## 5. Target Architecture

Scan flow:

1. Operator signs in with Supabase Auth.
2. Operator captures and validates front/back/top/side photos.
3. Server calls Gemini.
4. Server receives structured analysis JSON.
5. Server uploads photos to Supabase Storage private bucket.
6. Server inserts scan/session rows into Supabase Postgres.
7. Server stores:
   - raw JSON
   - normalized analytics columns
   - image paths
   - validation events
8. Reports and dashboard query Supabase.
9. Images are displayed through signed URLs or server-proxied access.

Recommended bucket:

- `bagscan-photos`
- private
- path format: `<user_id>/<scan_id>/<view>.<ext>`

Example:

```text
80a00436-6097-42a7-90fe-b677a676c668/8f2.../front.jpg
80a00436-6097-42a7-90fe-b677a676c668/8f2.../back.jpg
80a00436-6097-42a7-90fe-b677a676c668/8f2.../top.jpg
80a00436-6097-42a7-90fe-b677a676c668/8f2.../side.jpg
```

## 6. Database Model

### 6.1 `bagscan_sessions`

One row per completed or attempted scan.

```sql
create table public.bagscan_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text,
  notes text,
  status text not null check (status in ('draft', 'completed', 'failed', 'needs_review')),
  model text not null,
  analysis_version text not null default 'local-gemini-v1',
  capture_validation_status text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
```

Indexes:

```sql
create index idx_bagscan_sessions_user_created_at
  on public.bagscan_sessions (user_id, created_at desc);

create index idx_bagscan_sessions_created_at
  on public.bagscan_sessions (created_at desc);

create index idx_bagscan_sessions_status
  on public.bagscan_sessions (status);
```

### 6.2 `bagscan_images`

One row per uploaded photo/view.

```sql
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
```

Indexes:

```sql
create index idx_bagscan_images_scan_id
  on public.bagscan_images (scan_id);

create index idx_bagscan_images_user_view
  on public.bagscan_images (user_id, view);
```

### 6.3 `bagscan_extractions`

One row per completed scan. This is the dashboard workhorse table.

```sql
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
```

Indexes:

```sql
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
```

### 6.4 `bagscan_damage_findings`

One row per detected damage item.

```sql
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
```

Indexes:

```sql
create index idx_bagscan_damage_scan_id
  on public.bagscan_damage_findings (scan_id);

create index idx_bagscan_damage_type
  on public.bagscan_damage_findings (damage_type);

create index idx_bagscan_damage_severity
  on public.bagscan_damage_findings (severity);
```

### 6.5 `bagscan_validation_events`

One row per view validation or identity validation decision.

```sql
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
```

Indexes:

```sql
create index idx_bagscan_validation_scan_id
  on public.bagscan_validation_events (scan_id);

create index idx_bagscan_validation_user_created_at
  on public.bagscan_validation_events (user_id, created_at desc);

create index idx_bagscan_validation_type
  on public.bagscan_validation_events (event_type);
```

## 7. Storage Policies

Create private bucket:

```sql
insert into storage.buckets (id, name, public)
values ('bagscan-photos', 'bagscan-photos', false)
on conflict (id) do nothing;
```

Policy direction:

- authenticated operators can upload only under their own user-id prefix
- authenticated operators can read only their own objects
- dashboard admins can read all objects if/when admin roles are added

For first implementation, keep all writes inside authenticated server functions using the user-bound Supabase client from `requireSupabaseAuth`. That avoids needing to expose service role behavior in normal scan save logic.

If service-role operations are later needed for backfill/admin tasks, add `SUPABASE_SERVICE_ROLE_KEY` to production `.env` and keep it server-only.

## 8. Row Level Security

Enable RLS on all new public tables:

```sql
alter table public.bagscan_sessions enable row level security;
alter table public.bagscan_images enable row level security;
alter table public.bagscan_extractions enable row level security;
alter table public.bagscan_damage_findings enable row level security;
alter table public.bagscan_validation_events enable row level security;
```

Initial user-scoped policies are implemented as owner-managed policies for each table:

```sql
create policy "Owners manage bagscan sessions"
on public.bagscan_sessions for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

The same ownership pattern is applied to `bagscan_images`, `bagscan_extractions`, `bagscan_damage_findings`, and `bagscan_validation_events`.

Admin dashboard options:

1. Start simple: dashboard only shows current user data.
2. Add `user_roles` table and `is_admin()` function when cross-user analytics are needed.
3. Add read-all policies only for admins.

Recommended admin model:

```sql
create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'operator')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
```

## 9. Normalization Rules

The Gemini response remains the source of truth in `bagscan_extractions.raw_analysis`.

Normalize these fields at save time:

- `summary`
- `bag_type`
- `size_class`
- `brand_guess`
- `dimensions_cm.width`
- `dimensions_cm.height`
- `dimensions_cm.depth`
- `dimensions_cm.confidence`
- `dimensions_cm.basis`
- `colors.primary`
- `colors.secondary`
- `material`
- `texture`
- `wheels.count`
- `wheels.type`
- `handles.length`
- `overall_condition`
- `capture_validation.overall_status`
- identity/quality scores where available
- `damage[]` into `bagscan_damage_findings`

Parsing should be defensive:

- missing strings become `null`
- missing arrays become `[]`
- invalid dimensions become `null`
- negative or zero dimensions are rejected
- unknown enum-like values are stored as lowercase text rather than failing the save

## 10. Dashboard V1

Implemented route:

- `/dashboard`

Future route options:

- `/dashboard/scans`
- `/dashboard/scans/$id`
- `/dashboard/quality`

Implemented dashboard V1 reads Supabase cloud analytics and VM-local historic reports, then merges
the metrics for the signed-in user. This keeps old reports visible while backfill is deferred.

The visible dashboard is separated by business user so each audience sees a different decision
surface:

- Airline / Airport: PNR-linked bags, flight groups, terminal pressure, captured weight, dimension
  coverage, oversize candidates, high-volume bags, and planning prescriptions.
- Insurance: damage findings, evidence quality, review rate, condition at scan, damage severity,
  and claims prescriptions.
- Manufacturer: baggage type mix, material mix, condition trends, and damage severity for product
  design/manufacturing prescriptions.
- Customer Service: completed scans, review queue, capture quality, PNR-linked customer cases, and
  service prescriptions.

Implemented dashboard V1 widgets:

- total scans
- needs-review scans
- damage findings
- average volume
- PNR-linked scan count
- unique PNR, airline, and flight counts
- captured total/manual baggage weight
- flight-level baggage load grouping
- terminal pressure grouping
- PNR grouping for customer journey support
- oversize candidates based on linear dimensions
- predictive planning readiness based on PNR, flight, and manual weight coverage
- baggage type distribution
- size class distribution
- material distribution
- condition distribution
- retake rate by view
- capture quality by view
- recent scans
- separate role tabs for airline/airport operations, insurance, manufacturing, and customer service
- rule-based prescription panels for operations, insurance, manufacturing, and customer service

Later dashboard widgets:

- scans today / last 7 days / last 30 days
- scan trend over time
- largest/smallest scans
- color distribution
- damage rate
- damage by severity
- validation failure reasons
- same-baggage mismatch rate
- low-confidence extraction queue
- richer route/flight-level baggage load forecasting
- oversize and overweight handling prediction using larger historical samples
- claim risk and evidence completeness scoring

Scan detail page:

- four photos
- raw JSON download
- normalized extraction fields
- validation events
- damage findings
- confidence and review warnings

## 11. Analytics Views

SQL views are included in the migration for common dashboard rollups. The current `/dashboard` implementation computes the first V1 metrics through server functions; the views are available for future heavier reporting.

Example: daily scan counts.

```sql
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
```

Example: type distribution.

```sql
create or replace view public.bagscan_analytics_type_distribution
with (security_invoker = true) as
select
  user_id,
  coalesce(bag_type, 'unknown') as bag_type,
  count(*) as scan_count
from public.bagscan_extractions
group by user_id, coalesce(bag_type, 'unknown');
```

Example: quality by view.

```sql
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
```

## 12. Implementation Phases

### Phase 1: Migrations And Storage

Status: implemented.

Deliverables:

- Supabase migration for tables, indexes, RLS, and bucket.
- Helper module for parsing Gemini output into normalized fields.
- Typed cloud scan storage contracts.

Acceptance criteria:

- remote migration applied to Supabase project `spzuiycdiiymapqbrnkl`
- bucket exists and is private
- authenticated users can manage only their own rows and object prefixes
- unauthenticated users cannot access scan data

### Phase 2: Cloud Save Path

Status: implemented.

Deliverables:

- new server function `saveCloudScan`
- image upload to Supabase Storage
- DB inserts into new tables
- current `/scan-local` flow saves to cloud after Gemini analysis
- current SQLite save kept as optional fallback during transition

Acceptance criteria:

- one scan creates:
  - one `bagscan_sessions` row
  - four `bagscan_images` rows
  - one `bagscan_extractions` row
  - zero or more `bagscan_damage_findings` rows
  - validation event rows where available
- photos are retrievable only by the owner/admin
- raw JSON can be downloaded from scan detail

### Phase 3: Reports From Cloud

Status: implemented without route rename.

Deliverables:

- `/reports-local` reads Supabase first and local fallback second
- report list reads Supabase
- report detail reads Supabase
- images use signed URLs

Acceptance criteria:

- reports survive container rebuilds and VM replacement
- reports are visible after sign-in from a different browser/device

### Phase 4: Dashboard V1

Status: implemented for overview metrics; filters are deferred.

Deliverables:

- `/dashboard` overview
- dashboard query functions
- analytics SQL views

Acceptance criteria:

- dashboard loads from Supabase
- charts/tables reflect newly saved scans
- low-confidence and retake metrics are visible

### Phase 5: Backfill Existing VM Data

Status: deferred.

Deliverables:

- script to read `data/bagscan.sqlite`
- upload existing images from `data/bagscan-images`
- insert rows into cloud schema
- idempotency by preserving old scan id in `reference` or adding `legacy_local_id`

Acceptance criteria:

- existing scans appear in cloud reports/dashboard
- backfill can be re-run safely
- missing local images are reported but do not stop the whole job

### Phase 6: Cutover And Cleanup

Status: deferred.

Deliverables:

- remove local SQLite dependency from default production save path
- keep emergency export/backfill script
- update README and deployment docs
- add backup/restore runbook

Acceptance criteria:

- new production scans depend on Supabase, not the VM volume
- Docker volume can be rebuilt without losing cloud reports/photos

## 13. Implemented Code Changes

New files:

- `supabase/migrations/20260715000000_bagscan_cloud_analytics.sql`
- `src/lib/cloud-scan-store.functions.ts`
- `src/lib/cloud-scan-store.server.ts`
- `src/lib/cloud-scan-store.types.ts`
- `src/lib/analysis-normalizer.ts`
- `src/routes/dashboard.tsx`

Changed files:

- `src/routes/scan-local.tsx`
- `src/routes/reports-local.tsx`
- `src/routes/reports-local.$id.tsx`
- `src/components/AppHeader.tsx`
- `src/routeTree.gen.ts`
- `README.md`

## 14. Operational Requirements

Environment variables:

- existing:
  - `SUPABASE_URL`
  - `SUPABASE_PUBLISHABLE_KEY`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `GEMINI_API_KEY_1`
- optional for admin/backfill:
  - `SUPABASE_SERVICE_ROLE_KEY`

Deployment:

- run Supabase migrations
- deploy app image
- verify bucket policies
- run a scan
- verify dashboard row counts
- verify signed image access

Backups:

- Supabase database backups should be enabled according to project tier.
- Photos live in Supabase Storage; retention/export policy should be defined before production use.

## 15. Risks And Mitigations

Risk: image upload succeeds but DB insert fails.  
Mitigation: use deterministic storage paths and cleanup orphaned objects on failure where possible.

Risk: DB insert succeeds but one image upload fails.  
Mitigation: save session as `failed` or `needs_review`; surface retry in UI.

Risk: dashboard queries get slow as scans grow.  
Mitigation: use normalized columns, indexes, SQL views, and later materialized views.

Risk: operators need cross-user analytics.  
Mitigation: add `user_roles` and admin RLS policies before enabling global dashboard access.

Risk: raw Gemini schema changes.  
Mitigation: store `analysis_version`, keep raw JSON, and make normalizer tolerant.

Risk: private image access breaks in dashboard.  
Mitigation: generate signed URLs server-side or use authenticated Supabase Storage access with strict policies.

## 16. Remaining Decisions

1. Should the dashboard initially show only the signed-in operator's scans, or all scans for admins?
2. How long should local SQLite remain as fallback after the cloud path is proven?
3. Should old VM scans be backfilled now or after more dashboard filters are added?
4. What retention policy do we want for photos?
5. Do we need PII redaction for reference/notes fields?

## 17. Recommended Next Step

After deployment:

1. Run one fresh scan through `https://godigit.yavar.ai/scan-local`.
2. Confirm four objects appear under `bagscan-photos/<user_id>/<scan_id>/`.
3. Confirm one row appears in each core table.
4. Open `/reports-local` and `/dashboard` from a second browser session after signing in.
5. Decide whether to build date/type filters or backfill existing local scans next.
