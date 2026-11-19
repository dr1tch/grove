import { createClient } from "@supabase/supabase-js";
import { env } from "node:process";
import { describe, expect, it } from "vite-plus/test";
import { forgetVault, savedVaults, saveVault } from "./vaults";
const url = env.SUPABASE_URL,
  key = env.SUPABASE_ANON_KEY;
describe.skipIf(!url || !key)("saved vault RLS on local Supabase", () => {
  it("isolates users, deduplicates repositories, preserves branches and deletes only shortcuts", async () => {
    const account = async () => {
      const client = createClient(url!, key!, { auth: { persistSession: false } });
      const { data, error } = await client.auth.signUp({
        email: `vault-${crypto.randomUUID()}@grove.test`,
        password: crypto.randomUUID(),
        options: { captchaToken: "XXXX.DUMMY.TOKEN.XXXX" },
      });
      if (error || !data.user) throw error ?? new Error("No user");
      return { client, id: data.user.id };
    };
    const a = await account(),
      b = await account();
    const ref = { owner: "Owner", repo: "Notes", branch: "main" };
    await saveVault(a.client, a.id, ref);
    await saveVault(a.client, a.id, { ...ref, owner: "owner" });
    await saveVault(a.client, a.id, { ...ref, branch: "Work" });
    const rows = await savedVaults(a.client, a.id);
    expect(rows).toHaveLength(2);
    expect(await savedVaults(b.client, a.id)).toEqual([]);
    await expect(saveVault(b.client, a.id, ref)).rejects.toThrow();
    await forgetVault(b.client, a.id, rows[0].id);
    expect(await savedVaults(a.client, a.id)).toHaveLength(2);
    const anonymous = createClient(url!, key!, { auth: { persistSession: false } });
    expect((await anonymous.from("user_vaults").select()).error).toBeTruthy();
    await forgetVault(a.client, a.id, rows[0].id);
    expect(await savedVaults(a.client, a.id)).toHaveLength(1);
    expect(
      (
        await a.client
          .from("user_vaults")
          .insert({ user_id: a.id, owner: "owner", repo: "notes", branch: "../bad" })
      ).error,
    ).toBeTruthy();
    await a.client.auth.signOut();
    await b.client.auth.signOut();
  });
});
