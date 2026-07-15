alter table public.bagscan_sessions
  add column if not exists pnr text,
  add column if not exists pnr_hash text,
  add column if not exists airline text,
  add column if not exists flight_number text,
  add column if not exists flight_date date,
  add column if not exists departure_airport text,
  add column if not exists arrival_airport text,
  add column if not exists terminal text,
  add column if not exists bag_tag text,
  add column if not exists baggage_category text,
  add column if not exists weight_kg numeric,
  add column if not exists special_handling text;

create index if not exists idx_bagscan_sessions_user_pnr
  on public.bagscan_sessions (user_id, pnr);

create index if not exists idx_bagscan_sessions_user_pnr_hash
  on public.bagscan_sessions (user_id, pnr_hash);

create index if not exists idx_bagscan_sessions_user_flight
  on public.bagscan_sessions (user_id, airline, flight_number, flight_date);

create index if not exists idx_bagscan_sessions_user_terminal
  on public.bagscan_sessions (user_id, departure_airport, terminal);
