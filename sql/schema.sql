-- ============================================================
-- Clinic Wait Time App — Supabase schema
-- Run this whole file once in the Supabase SQL editor.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table if not exists clinic_settings (
  id int primary key default 1,
  avg_consult_minutes numeric not null default 15,
  constraint single_row check (id = 1)
);

insert into clinic_settings (id, avg_consult_minutes)
values (1, 15)
on conflict (id) do nothing;

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text unique not null,
  patient_label text not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'in_progress', 'done', 'cancelled')),
  priority int not null default 0,
  checked_in_at timestamptz not null default now(),
  called_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_tickets_status on tickets (status);
create index if not exists idx_tickets_queue_order on tickets (priority desc, checked_in_at asc);

-- ---------- Row Level Security ----------
-- Default posture: deny everyone. We only open doors we explicitly need.

alter table tickets enable row level security;
alter table clinic_settings enable row level security;

-- Only logged-in staff (the receptionist) can read/write tickets directly.
-- There is NO policy granting the anon (patient) role any access to this
-- table — patients can only reach their own ticket through the
-- get_ticket_status() function below, which is scoped to one code at a time.
create policy "staff full access to tickets"
  on tickets
  for all
  to authenticated
  using (true)
  with check (true);

create policy "staff read settings"
  on clinic_settings
  for select
  to authenticated
  using (true);

create policy "staff update settings"
  on clinic_settings
  for update
  to authenticated
  using (true)
  with check (true);

-- ---------- RPC: patient looks up their own ticket ----------
-- security definer lets this function read the tickets table even though
-- the anon role has no direct policy on it. It only ever returns the one
-- row matching p_code, never the rest of the queue.
create or replace function get_ticket_status(p_code text)
returns table (
  ticket_code text,
  patient_label text,
  status text,
  position_in_queue int,
  estimated_wait_minutes int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket tickets%rowtype;
  v_avg numeric;
  v_position int;
begin
  select * into v_ticket from tickets t where t.ticket_code = upper(p_code);

  if not found then
    return; -- empty result set, frontend shows "ticket not found"
  end if;

  select cs.avg_consult_minutes into v_avg from clinic_settings cs where cs.id = 1;

  select count(*) into v_position
  from tickets t
  where t.status = 'waiting'
    and (
      t.priority > v_ticket.priority
      or (t.priority = v_ticket.priority and t.checked_in_at < v_ticket.checked_in_at)
    );

  return query
  select
    v_ticket.ticket_code,
    v_ticket.patient_label,
    v_ticket.status,
    case when v_ticket.status = 'waiting' then v_position else 0 end,
    case when v_ticket.status = 'waiting' then round(v_position * v_avg)::int else 0 end;
end;
$$;

grant execute on function get_ticket_status(text) to anon, authenticated;

-- ---------- RPC: receptionist checks a patient in ----------
create or replace function create_ticket(p_label text, p_priority int default 0)
returns tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_ticket tickets%rowtype;
begin
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (
      select 1 from tickets
      where ticket_code = v_code and status in ('waiting', 'in_progress')
    );
  end loop;

  insert into tickets (ticket_code, patient_label, priority)
  values (v_code, p_label, p_priority)
  returning * into v_ticket;

  return v_ticket;
end;
$$;

grant execute on function create_ticket(text, int) to authenticated;

-- ---------- RPC: receptionist marks a visit complete ----------
-- Also feeds the real consult duration back into the rolling average,
-- so tomorrow's wait estimates get more accurate over time.
create or replace function complete_ticket(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket tickets%rowtype;
  v_duration numeric;
  v_avg numeric;
begin
  select * into v_ticket from tickets where id = p_id;
  if not found then
    return;
  end if;

  update tickets
  set status = 'done', completed_at = now()
  where id = p_id;

  v_duration := extract(epoch from (now() - coalesce(v_ticket.called_at, v_ticket.checked_in_at))) / 60.0;

  if v_duration > 0 and v_duration < 120 then
    select avg_consult_minutes into v_avg from clinic_settings where id = 1;
    update clinic_settings
    set avg_consult_minutes = round((v_avg * 0.8 + v_duration * 0.2)::numeric, 1)
    where id = 1;
  end if;
end;
$$;

grant execute on function complete_ticket(uuid) to authenticated;

-- ============================================================
-- After running this file, in the Supabase dashboard:
-- 1. Database > Replication: enable replication on the "tickets" table
--    so the receptionist dashboard gets live updates.
-- 2. Authentication > Users: create one user for the receptionist
--    (email + password). That's the only login this app has.
-- ============================================================
