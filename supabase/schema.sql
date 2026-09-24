-- =====================================================================
-- Maths Practice — Supabase schema
--
-- Run this once in your Supabase project: Dashboard → SQL Editor →
-- New query → paste this whole file → Run. It is safe to re-run.
--
-- Model
--   profiles     one row per account (created automatically on sign-up)
--   attempts     one row per completed topic attempt
--   tutor_links  which students have shared their progress with which
--                tutor/parent (a student joins using the tutor's code)
--
-- Security: every table has row-level security. A user can only read
-- their own rows; a tutor can additionally read the profiles and attempts
-- of students who linked to them. Nobody can read anyone else's email.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
    id           uuid primary key references auth.users (id) on delete cascade,
    display_name text not null check (char_length(display_name) between 1 and 60),
    role         text not null default 'student' check (role in ('student', 'tutor')),
    tutor_code   text unique,
    created_at   timestamptz not null default now()
);

create table if not exists public.tutor_links (
    tutor_id   uuid not null references public.profiles (id) on delete cascade,
    student_id uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (tutor_id, student_id),
    check (tutor_id <> student_id)
);

create index if not exists tutor_links_student_idx on public.tutor_links (student_id);

create table if not exists public.attempts (
    id           bigint generated always as identity primary key,
    user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
    topic_id     text not null check (char_length(topic_id) between 1 and 100),
    score        integer not null,
    total        integer not null,
    missed       jsonb not null default '[]'::jsonb,
    completed_at timestamptz not null default now(),
    check (total > 0 and score between 0 and total),
    check (jsonb_typeof(missed) = 'array' and pg_column_size(missed) < 32768),
    check (completed_at <= now() + interval '5 minutes')
);

create index if not exists attempts_user_completed_idx on public.attempts (user_id, completed_at desc);

-- ---------------------------------------------------------------------
-- Helpers (security definer so policies can use them without recursion)
-- ---------------------------------------------------------------------

-- Is the current user a tutor of this student?
create or replace function public.is_tutor_of(student uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (
        select 1 from public.tutor_links
        where tutor_id = auth.uid() and student_id = student
    );
$$;

-- Is the current user a student of this tutor? (lets students see their tutor's name)
create or replace function public.is_student_of(tutor uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (
        select 1 from public.tutor_links
        where student_id = auth.uid() and tutor_id = tutor
    );
$$;

-- Short, unambiguous join code (no 0/O, 1/I/L).
create or replace function public.generate_tutor_code()
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
    alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    candidate text;
begin
    loop
        candidate := '';
        for i in 1..6 loop
            candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
        end loop;
        exit when not exists (select 1 from public.profiles where tutor_code = candidate);
    end loop;
    return candidate;
end;
$$;

-- ---------------------------------------------------------------------
-- Create a profile automatically when someone signs up.
-- The sign-up form passes display_name and role in the user metadata.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
    requested_role text := coalesce(new.raw_user_meta_data ->> 'role', 'student');
    name text := left(coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        split_part(coalesce(new.email, 'Student'), '@', 1)
    ), 60);
begin
    if requested_role not in ('student', 'tutor') then
        requested_role := 'student';
    end if;

    insert into public.profiles (id, display_name, role, tutor_code)
    values (
        new.id,
        name,
        requested_role,
        case when requested_role = 'tutor' then public.generate_tutor_code() end
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- RPCs called from the site
-- ---------------------------------------------------------------------

-- A student enters a tutor's code to share their progress with them.
create or replace function public.link_to_tutor(code text)
returns table (tutor_id uuid, display_name text)
language plpgsql security definer set search_path = public
as $$
declare
    tutor public.profiles;
begin
    if auth.uid() is null then
        raise exception 'Not signed in';
    end if;

    select * into tutor
    from public.profiles p
    where p.role = 'tutor' and p.tutor_code = upper(trim(code));

    if tutor.id is null then
        raise exception 'No tutor found with that code';
    end if;
    if tutor.id = auth.uid() then
        raise exception 'You can''t link to yourself';
    end if;

    insert into public.tutor_links (tutor_id, student_id)
    values (tutor.id, auth.uid())
    on conflict do nothing;

    return query select tutor.id, tutor.display_name;
end;
$$;

-- A tutor issues a new join code (existing links are kept).
create or replace function public.regenerate_tutor_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare
    new_code text;
begin
    if not exists (select 1 from public.profiles where id = auth.uid() and role = 'tutor') then
        raise exception 'Only tutor accounts have a code';
    end if;
    new_code := public.generate_tutor_code();
    update public.profiles set tutor_code = new_code where id = auth.uid();
    return new_code;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges: start from nothing, then grant exactly what the site uses
-- ---------------------------------------------------------------------

revoke all on public.profiles, public.tutor_links, public.attempts from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select, delete on public.tutor_links to authenticated;

grant select on public.attempts to authenticated;
grant insert (topic_id, score, total, missed, completed_at) on public.attempts to authenticated;

revoke all on function public.is_tutor_of(uuid), public.is_student_of(uuid),
    public.generate_tutor_code(), public.handle_new_user(),
    public.link_to_tutor(text), public.regenerate_tutor_code() from public, anon;
grant execute on function public.is_tutor_of(uuid), public.is_student_of(uuid),
    public.link_to_tutor(text), public.regenerate_tutor_code() to authenticated;

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.tutor_links enable row level security;
alter table public.attempts    enable row level security;

drop policy if exists "profiles: read own, students', and tutors'" on public.profiles;
create policy "profiles: read own, students', and tutors'" on public.profiles
    for select to authenticated
    using (id = auth.uid() or public.is_tutor_of(id) or public.is_student_of(id));

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
    for update to authenticated
    using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "tutor_links: read own" on public.tutor_links;
create policy "tutor_links: read own" on public.tutor_links
    for select to authenticated
    using (tutor_id = auth.uid() or student_id = auth.uid());

drop policy if exists "tutor_links: either side can unlink" on public.tutor_links;
create policy "tutor_links: either side can unlink" on public.tutor_links
    for delete to authenticated
    using (tutor_id = auth.uid() or student_id = auth.uid());

drop policy if exists "attempts: read own and students'" on public.attempts;
create policy "attempts: read own and students'" on public.attempts
    for select to authenticated
    using (user_id = auth.uid() or public.is_tutor_of(user_id));

drop policy if exists "attempts: insert own" on public.attempts;
create policy "attempts: insert own" on public.attempts
    for insert to authenticated
    with check (user_id = auth.uid());
