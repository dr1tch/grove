-- Grove cloud vaults: one private vault per user.
-- File bytes live in Storage at vaults/<user id>/<git blob sha>; rows map paths to those blobs.
-- Clients only read tables directly. Every write goes through the functions below, which
-- check the expected sha so a stale save becomes a conflict instead of an overwrite.

create table public.vault_files (
  user_id uuid not null references auth.users on delete cascade,
  -- Mirrors vaultPath(): relative, no empty, "." or ".." segments, no controls or backslash.
  path text not null check (
    char_length(path) between 1 and 1024
    and path !~ '(^/|/$|//|(^|/)\.{1,2}(/|$)|[[:cntrl:]]|\\)'
  ),
  sha text not null check (sha ~ '^[0-9a-f]{40}$'),
  size bigint not null check (size between 0 and 52428800),
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

create table public.vault_versions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  path text not null,
  sha text not null,
  size bigint not null,
  created_at timestamptz not null default now()
);
create index vault_versions_path on public.vault_versions (user_id, path, id desc);

-- A per-user change counter so clients can poll cheaply for remote changes.
create table public.vault_heads (
  user_id uuid primary key references auth.users on delete cascade,
  revision bigint not null default 0
);

alter table public.vault_files enable row level security;
alter table public.vault_versions enable row level security;
alter table public.vault_heads enable row level security;
create policy "own files" on public.vault_files for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own versions" on public.vault_versions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own head" on public.vault_heads for select to authenticated
  using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('vaults', 'vaults', false, 52428800);
-- Blobs are content-addressed and never overwritten, so only insert and select are allowed.
create policy "own blobs read" on storage.objects for select to authenticated
  using (bucket_id = 'vaults' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own blobs write" on storage.objects for insert to authenticated
  with check (bucket_id = 'vaults' and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{40}$'));

-- A path is free when no file sits at a folder above it and no files sit below it,
-- so a file can never shadow a folder (or the reverse), as GitHub also refuses.
create function public.vault_path_free(uid uuid, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.vault_files f
    where f.user_id = uid
      and (starts_with(f.path, p_path || '/') or starts_with(p_path, f.path || '/'))
  );
$$;
revoke all on function public.vault_path_free from public, anon, authenticated;

create function public.vault_bump(uid uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.vault_heads (user_id, revision) values (uid, 1)
    on conflict (user_id) do update set revision = public.vault_heads.revision + 1;
$$;
revoke all on function public.vault_bump from public, anon, authenticated;

-- p_base null creates (fails if the path exists); otherwise the current sha must equal p_base.
create function public.vault_save(p_path text, p_base text, p_sha text, p_size bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  -- Refuse rows that point at missing bytes: that would make the file unreadable.
  if not exists (select 1 from storage.objects
                 where bucket_id = 'vaults' and name = uid::text || '/' || p_sha
                   and (metadata ->> 'size')::bigint = p_size) then
    raise exception 'File contents were not uploaded' using errcode = 'GR400';
  end if;
  if p_base is null then
    if not public.vault_path_free(uid, p_path) then
      raise exception 'A file or folder already uses this path' using errcode = 'GR409';
    end if;
    insert into public.vault_files (user_id, path, sha, size) values (uid, p_path, p_sha, p_size)
      on conflict do nothing;
  else
    update public.vault_files set sha = p_sha, size = p_size, updated_at = now()
      where user_id = uid and path = p_path and sha = p_base;
  end if;
  if not found then raise exception 'File changed elsewhere' using errcode = 'GR409'; end if;
  insert into public.vault_versions (user_id, path, sha, size) values (uid, p_path, p_sha, p_size);
  perform public.vault_bump(uid);
end $$;

create function public.vault_delete(p_path text, p_sha text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  delete from public.vault_files where user_id = uid and path = p_path and sha = p_sha;
  if not found then raise exception 'File changed elsewhere' using errcode = 'GR409'; end if;
  perform public.vault_bump(uid);
end $$;

-- Atomic move: fails if the source changed or the target exists.
create function public.vault_rename(p_path text, p_target text, p_sha text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  if not public.vault_path_free(uid, p_target) then
    raise exception 'A file or folder already uses this path' using errcode = 'GR409';
  end if;
  update public.vault_files set path = p_target, updated_at = now()
    where user_id = uid and path = p_path and sha = p_sha;
  if not found then raise exception 'File changed elsewhere' using errcode = 'GR409'; end if;
  perform public.vault_bump(uid);
exception when unique_violation then
  raise exception 'The destination already exists' using errcode = 'GR409';
end $$;

revoke all on function public.vault_save, public.vault_delete, public.vault_rename from public, anon;
grant execute on function public.vault_save, public.vault_delete, public.vault_rename to authenticated;
