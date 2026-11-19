-- Serialize path checks and mutations for each user, preserving CAS and existing grants.
create or replace function public.vault_save(p_path text, p_base text, p_sha text, p_size bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text, 0));
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

create or replace function public.vault_delete(p_path text, p_sha text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text, 0));
  delete from public.vault_files where user_id = uid and path = p_path and sha = p_sha;
  if not found then raise exception 'File changed elsewhere' using errcode = 'GR409'; end if;
  perform public.vault_bump(uid);
end $$;

-- Atomic move: fails if the source changed or the target exists.
create or replace function public.vault_rename(p_path text, p_target text, p_sha text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text, 0));
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
