import { expect, it } from "vite-plus/test";
import { vaultRef } from "./vaults";
it("normalizes saved repository identity and preserves branch case", () => {
  expect(vaultRef({ owner: "Dr1tch", repo: "Notes", branch: "Work/Today" })).toEqual({
    owner: "dr1tch",
    repo: "notes",
    branch: "Work/Today",
  });
});
it("rejects tokens, invalid paths and invalid saved-vault rows", () => {
  for (const value of [
    null,
    { owner: "../no", repo: "x", branch: "main" },
    { owner: "ok", repo: "ok", branch: "../main" },
    { owner: "ok", repo: "ok", branch: "main", token: "secret" },
  ])
    expect(() => vaultRef(value)).toThrow();
});
