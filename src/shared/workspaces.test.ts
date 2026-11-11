import { it, expect } from "vite-plus/test";
import { cleanPresets, migratePresets } from "./workspaces";
it("rejects cross-vault or malformed presets and stores references only", () => {
  const raw = [
    {
      id: "1",
      name: "Research",
      vaultRoot: "/vault",
      layout: { panes: [{ tabs: ["note.md"], active: "note.md" }] },
      expandedFolders: ["docs"],
      content: "SECRET",
    },
    null,
    { id: "2", name: "Wrong", vaultRoot: "/other" },
  ];
  const presets = cleanPresets(raw, "/vault");
  expect(presets).toHaveLength(1);
  expect(JSON.stringify(presets)).not.toContain("SECRET");
  expect(migratePresets(presets, "note.md", "renamed.md")[0].layout.panes[0].active).toBe(
    "renamed.md",
  );
});
