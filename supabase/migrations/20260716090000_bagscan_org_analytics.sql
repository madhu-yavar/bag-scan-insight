create table if not exists public.bagscan_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bagscan_org_members (
  org_id uuid not null references public.bagscan_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('owner', 'admin', 'analyst', 'operator')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create trigger update_bagscan_organizations_updated_at
  before update on public.bagscan_organizations
  for each row execute function public.update_updated_at_column();

insert into public.bagscan_organizations (id, name, slug)
values ('11111111-1111-4111-8111-111111111111', 'BagScan Demo Organization', 'bagscan-demo')
on conflict (id) do nothing;

insert into public.bagscan_org_members (org_id, user_id, role)
select distinct
  '11111111-1111-4111-8111-111111111111'::uuid,
  user_id,
  'admin'
from public.bagscan_sessions
where user_id is not null
on conflict (org_id, user_id) do nothing;

alter table public.bagscan_sessions
  add column if not exists org_id uuid references public.bagscan_organizations(id),
  add column if not exists baggage_category_source text default 'manual'
    check (baggage_category_source in ('manual', 'system', 'operator_override'));

update public.bagscan_sessions
set org_id = '11111111-1111-4111-8111-111111111111'::uuid
where org_id is null;

alter table public.bagscan_sessions
  alter column org_id set not null;

alter table public.bagscan_images
  add column if not exists org_id uuid references public.bagscan_organizations(id);

update public.bagscan_images i
set org_id = s.org_id
from public.bagscan_sessions s
where i.scan_id = s.id
  and i.org_id is null;

update public.bagscan_images
set org_id = '11111111-1111-4111-8111-111111111111'::uuid
where org_id is null;

alter table public.bagscan_images
  alter column org_id set not null;

alter table public.bagscan_extractions
  add column if not exists org_id uuid references public.bagscan_organizations(id),
  add column if not exists brand_confidence text,
  add column if not exists visible_logo_text text,
  add column if not exists model_guess text,
  add column if not exists model_confidence text,
  add column if not exists shell_type text,
  add column if not exists luggage_form_factor text;

update public.bagscan_extractions e
set org_id = s.org_id
from public.bagscan_sessions s
where e.scan_id = s.id
  and e.org_id is null;

update public.bagscan_extractions
set org_id = '11111111-1111-4111-8111-111111111111'::uuid
where org_id is null;

alter table public.bagscan_extractions
  alter column org_id set not null;

alter table public.bagscan_damage_findings
  add column if not exists org_id uuid references public.bagscan_organizations(id);

update public.bagscan_damage_findings d
set org_id = s.org_id
from public.bagscan_sessions s
where d.scan_id = s.id
  and d.org_id is null;

update public.bagscan_damage_findings
set org_id = '11111111-1111-4111-8111-111111111111'::uuid
where org_id is null;

alter table public.bagscan_damage_findings
  alter column org_id set not null;

alter table public.bagscan_validation_events
  add column if not exists org_id uuid references public.bagscan_organizations(id);

update public.bagscan_validation_events v
set org_id = s.org_id
from public.bagscan_sessions s
where v.scan_id = s.id
  and v.org_id is null;

update public.bagscan_validation_events
set org_id = '11111111-1111-4111-8111-111111111111'::uuid
where org_id is null;

alter table public.bagscan_validation_events
  alter column org_id set not null;

create index if not exists idx_bagscan_org_members_user
  on public.bagscan_org_members (user_id, org_id);
create index if not exists idx_bagscan_sessions_org_created_at
  on public.bagscan_sessions (org_id, created_at desc);
create index if not exists idx_bagscan_sessions_org_flight
  on public.bagscan_sessions (org_id, airline, flight_number, flight_date);
create index if not exists idx_bagscan_sessions_org_terminal
  on public.bagscan_sessions (org_id, departure_airport, terminal);
create index if not exists idx_bagscan_sessions_org_category
  on public.bagscan_sessions (org_id, baggage_category);
create index if not exists idx_bagscan_images_org_view
  on public.bagscan_images (org_id, view);
create index if not exists idx_bagscan_extractions_org_brand
  on public.bagscan_extractions (org_id, brand_guess);
create index if not exists idx_bagscan_extractions_org_form
  on public.bagscan_extractions (org_id, luggage_form_factor);
create index if not exists idx_bagscan_damage_org_severity
  on public.bagscan_damage_findings (org_id, severity);
create index if not exists idx_bagscan_validation_org_created_at
  on public.bagscan_validation_events (org_id, created_at desc);

create or replace function public.is_bagscan_org_member(target_org_id uuid, target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bagscan_org_members m
    where m.org_id = target_org_id
      and m.user_id = target_user_id
  );
$$;

create or replace function public.bagscan_default_org_id()
returns uuid
language sql
stable
as $$
  select '11111111-1111-4111-8111-111111111111'::uuid;
$$;

grant select, insert, update, delete on public.bagscan_organizations to authenticated;
grant select, insert, update, delete on public.bagscan_org_members to authenticated;
grant all on public.bagscan_organizations to service_role;
grant all on public.bagscan_org_members to service_role;
grant execute on function public.is_bagscan_org_member(uuid, uuid) to authenticated;
grant execute on function public.bagscan_default_org_id() to authenticated;

alter table public.bagscan_organizations enable row level security;
alter table public.bagscan_org_members enable row level security;

drop policy if exists "BagScan members read organizations" on public.bagscan_organizations;
create policy "BagScan members read organizations"
on public.bagscan_organizations for select
to authenticated
using (public.is_bagscan_org_member(id, auth.uid()));

drop policy if exists "Users create own demo membership" on public.bagscan_org_members;
create policy "Users create own demo membership"
on public.bagscan_org_members for insert
to authenticated
with check (
  user_id = auth.uid()
  and org_id = public.bagscan_default_org_id()
);

drop policy if exists "Users read own org membership" on public.bagscan_org_members;
create policy "Users read own org membership"
on public.bagscan_org_members for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Org members read bagscan sessions" on public.bagscan_sessions;
create policy "Org members read bagscan sessions"
on public.bagscan_sessions for select
to authenticated
using (public.is_bagscan_org_member(org_id, auth.uid()));

drop policy if exists "Org members read bagscan images" on public.bagscan_images;
create policy "Org members read bagscan images"
on public.bagscan_images for select
to authenticated
using (public.is_bagscan_org_member(org_id, auth.uid()));

drop policy if exists "Org members read bagscan extractions" on public.bagscan_extractions;
create policy "Org members read bagscan extractions"
on public.bagscan_extractions for select
to authenticated
using (public.is_bagscan_org_member(org_id, auth.uid()));

drop policy if exists "Org members read bagscan damage findings" on public.bagscan_damage_findings;
create policy "Org members read bagscan damage findings"
on public.bagscan_damage_findings for select
to authenticated
using (public.is_bagscan_org_member(org_id, auth.uid()));

drop policy if exists "Org members read bagscan validation events" on public.bagscan_validation_events;
create policy "Org members read bagscan validation events"
on public.bagscan_validation_events for select
to authenticated
using (public.is_bagscan_org_member(org_id, auth.uid()));

drop policy if exists "Org members read bagscan photos" on storage.objects;
create policy "Org members read bagscan photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'bagscan-photos'
  and exists (
    select 1
    from public.bagscan_images i
    where i.storage_bucket = bucket_id
      and i.storage_path = name
      and public.is_bagscan_org_member(i.org_id, auth.uid())
  )
);
