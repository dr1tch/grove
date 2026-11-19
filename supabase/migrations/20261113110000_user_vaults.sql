-- Synced shortcuts only. Tokens and file contents never enter this table.
create table public.user_vaults (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  owner text not null check (owner ~ '^[a-z0-9-]{1,100}$'),
  repo text not null check (repo ~ '^[a-z0-9_.-]{1,100}$' and repo not in ('.', '..')),
  branch text not null check (
    char_length(branch) between 1 and 255
    and branch !~ '[[:cntrl:][:space:]~^:?*\[\\]'
    and branch !~ '(^/|/$|//|\.\.|\.lock$)'
  ),
  created_at timestamptz not null default now(),
  unique (user_id, owner, repo, branch)
);
alter table public.user_vaults enable row level security;
revoke all on public.user_vaults from anon, authenticated;
grant select, insert, delete on public.user_vaults to authenticated;
create policy "read own saved vaults" on public.user_vaults for select to authenticated
  using (user_id = (select auth.uid()));
create policy "save own vaults" on public.user_vaults for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "forget own vault shortcuts" on public.user_vaults for delete to authenticated
  using (user_id = (select auth.uid()));
