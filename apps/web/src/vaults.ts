import type { SupabaseClient } from "@supabase/supabase-js";
import { rootOf } from "@grove/github-vault/types";
import type { RepoRef } from "@grove/github-vault/types";
export type SavedVault = RepoRef & { id: string };
export function vaultRef(value: unknown): RepoRef {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved vault");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) => !["owner", "repo", "branch", "id", "created_at", "user_id"].includes(key),
    )
  )
    throw new Error("Saved vaults contain repository metadata only");
  const ref = { owner: row.owner, repo: row.repo, branch: row.branch } as RepoRef;
  rootOf(ref);
  if (ref.owner.length > 100 || ref.repo.length > 100 || ref.branch.length > 255)
    throw new Error("Repository details are too long");
  return { owner: ref.owner.toLowerCase(), repo: ref.repo.toLowerCase(), branch: ref.branch };
}
export async function savedVaults(client: SupabaseClient, userId: string): Promise<SavedVault[]> {
  const { data, error } = await client
    .from("user_vaults")
    .select("id,owner,repo,branch")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw new Error("Could not load saved vaults. Try again when connected.");
  return (data ?? []).map((row) => {
    if (typeof row.id !== "string") throw new Error("Invalid saved vault");
    return { ...vaultRef(row), id: row.id };
  });
}
export async function saveVault(
  client: SupabaseClient,
  userId: string,
  ref: RepoRef,
): Promise<void> {
  const { error } = await client
    .from("user_vaults")
    .upsert(
      { user_id: userId, ...vaultRef(ref) },
      { onConflict: "user_id,owner,repo,branch", ignoreDuplicates: true },
    );
  if (error)
    throw new Error(
      "The repository opened, but its shortcut could not be saved. Try again from Account.",
    );
}
export async function forgetVault(
  client: SupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await client.from("user_vaults").delete().eq("user_id", userId).eq("id", id);
  if (error) throw new Error("Could not remove the vault shortcut. No files were changed.");
}
