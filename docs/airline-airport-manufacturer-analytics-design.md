# BagScan Airline, Airport, And Manufacturer Analytics Design

Status: proposed for next implementation
Date: 2026-07-16

## 1. RCA: Current Dashboard Inconsistency

The current dashboard is intentionally scoped to the signed-in `user_id`.

That means:

- Test user scans are visible only to the test user.
- `ms.madhugraj` scans are visible only to `ms.madhugraj`.
- Separate operators do not see one shared analytics board.

This is correct for private operator reports, but wrong for client analytics. Airline, airport,
insurance, manufacturer, and customer service dashboards need an organization/client scope.

The fix is not a UI refresh change. It needs a data model and RLS change:

- every scan belongs to an organization/client
- every user belongs to one or more organizations
- dashboard queries read organization-level analytics when the user has access
- personal reports can still show only the current user's scans

## 2. Load Error Investigation

Production log access is currently blocked because the local `gcloud` session needs
reauthentication. The command failed with:

```text
gcloud auth login
```

Until production logs are visible, the likely causes are:

- old browser session calling a server function while auth token is expired
- dashboard querying new cloud fields while the page is still on an older cached bundle
- user-scoped analytics returning a different data shape than expected
- Supabase RLS denying cross-user reads, which is expected with the current owner-only design

The next implementation should add better dashboard error messages:

- `Session expired. Please sign in again.`
- `Analytics scope is personal. Switch to organization dashboard.`
- `No scans for this user.`
- `Cloud analytics unavailable. Retry.`

## 3. Target Access Model

Add organization-scoped analytics.

Tables:

```sql
bagscan_organizations (
  id uuid primary key,
  name text not null,
  organization_type text check (
    organization_type in ('airline', 'airport', 'insurance', 'manufacturer', 'demo', 'other')
  ),
  created_at timestamptz not null default now()
)

bagscan_org_members (
  org_id uuid references bagscan_organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text check (role in ('admin', 'manager', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
)
```

Add `org_id` to:

- `bagscan_sessions`
- `bagscan_images`
- `bagscan_extractions`
- `bagscan_damage_findings`
- `bagscan_validation_events`

RLS policy shape:

```sql
exists (
  select 1
  from bagscan_org_members m
  where m.org_id = bagscan_sessions.org_id
    and m.user_id = auth.uid()
)
```

Owner-only personal views can continue filtering by `user_id`.

## 4. Scan Data Model Additions

The current scan already captures:

- PNR
- airline
- flight number
- flight date
- departure airport
- arrival airport
- terminal
- bag tag
- baggage category
- manual weight
- special handling
- dimensions
- bag type
- size class
- material
- condition
- damage
- `brand_guess`

Needed additions:

```sql
alter table bagscan_extractions
  add column if not exists brand_confidence text,
  add column if not exists visible_logo_text text,
  add column if not exists model_guess text,
  add column if not exists model_confidence text,
  add column if not exists shell_type text,
  add column if not exists luggage_form_factor text;
```

Prompt additions:

- Read visible logo/brand text if present.
- Guess manufacturer only when visible evidence exists.
- Keep unknown when not visible.
- Separate `brand_guess` from `model_guess`.
- Include confidence and evidence.

Example JSON fields:

```json
{
  "brand_guess": "VIP",
  "brand_confidence": "medium",
  "visible_logo_text": "VIP",
  "model_guess": null,
  "model_confidence": "low"
}
```

## 5. Baggage Category Auto-Fill

Current UI lets users manually enter baggage category. Next behavior:

1. If the operator manually selects a category, keep it.
2. If empty, auto-fill from dimensions after scan analysis.
3. Let the user override before final save or update after save.

Suggested rule:

```text
cabin:
  linear size <= 115 cm
  and height <= 56 cm
  and width <= 45 cm
  and depth <= 25 cm

checked-in:
  larger than cabin

special:
  carton, garment, oversized, sports, fragile, or manual special handling
```

Store both:

- `baggage_category`: final operator-visible category
- `baggage_category_source`: `manual|auto_dimension|unknown`

## 6. Airline Dashboard

Airline view should be separate from airport view.

Filters:

- airline
- flight date
- flight number
- departure airport
- arrival airport
- terminal
- cabin / checked-in / special

Core questions:

- How many bags are expected per flight?
- What is total scanned baggage weight per flight?
- How many oversized/high-volume bags per flight?
- Which flights need more ground staff?
- Which flights need additional belt/load planning?
- Which PNRs have multiple bags?
- Which gates/routes have higher exception rate?

Widgets:

- Flight baggage load table
- Weight by flight/date
- Oversize by flight
- Cabin vs checked-in mix
- PNR multi-bag groups
- Exception queue by flight
- Trend by date

Prescriptions:

- Add ground staff for flights with high checked-in or oversize volume.
- Assign manual handling support for flights with oversized bags.
- Flag high baggage count PNRs for pre-load review.
- Use weight/volume signals to support load planning. Fuel planning should be advisory only until
  integrated with airline load-control systems.
- Improve counter/gate readiness for flights with high cabin-bag ratio.

## 7. Airport Dashboard

Airport view should aggregate across airlines.

Filters:

- airport
- terminal
- airline
- date
- hour window
- baggage category
- route

Core questions:

- What is the baggage load by terminal?
- Which airlines create the most baggage pressure?
- Which hours create peak baggage load?
- Which terminals need additional belt, trolley, screening, or internal transport capacity?
- Which airlines/flights have oversize concentration?
- Are certain arrival/departure corridors creating pressure?

Widgets:

- Terminal pressure board
- Airline distribution by terminal
- Hourly baggage volume
- Oversize/checked-in distribution
- Ground transport pressure
- Screening/belt readiness score
- Airport-wide exception queue

Prescriptions:

- Increase belt/trolley readiness during peak terminal windows.
- Keep oversize handling support near terminals with higher exception load.
- Coordinate with airlines whose flights create repeated baggage pressure.
- Adjust internal transport allocation by terminal/date/hour.
- Use baggage volume and weight trend as early signal for infrastructure capacity planning.

## 8. Manufacturer Dashboard

Manufacturer view should use visual product intelligence, not airline planning data.

Filters:

- brand/manufacturer
- bag type
- size class
- material
- shell type
- condition
- damage type

Core questions:

- Which brands/types are most scanned?
- Which materials show higher damage?
- Which size classes are most common?
- Which damage types appear by material/type?
- Which wheel/handle/corner failures appear repeatedly?

Widgets:

- Brand distribution
- Bag type distribution
- Material distribution
- Damage by material
- Damage severity trend
- Wheel/handle damage trend
- Condition by brand/type

Prescriptions:

- Prioritize durability review for types/materials with high damage rate.
- Review wheel and handle design if repeated damage appears.
- Use demand mix to decide manufacturing focus.
- Compare hard-shell vs soft-shell damage patterns.

## 9. Implementation Sequence

Recommended order:

1. Fix dashboard load errors with clearer server-function error messages and reauth/log inspection.
2. Add organization tables and `org_id` to BagScan tables.
3. Backfill all existing scans into a default demo organization.
4. Update server functions to accept a selected analytics scope: `personal` or `organization`.
5. Split dashboard tabs into:
   - Airline
   - Airport
   - Insurance
   - Manufacturer
   - Customer Service
6. Add airline/airport filter controls.
7. Add brand/model extraction fields and manufacturer widgets.
8. Add baggage category auto-fill from dimensions.
9. Redeploy and test with three users under the same organization.

## 10. Immediate Decision

The current per-user behavior is useful for operator privacy, but the client-facing dashboard should
be organization-scoped by default.

For demos, create one default organization and assign all current test users to it. Then the dashboard
will show all scans from all assigned users consistently.
