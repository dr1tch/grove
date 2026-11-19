import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createClient } from "@supabase/supabase-js";
import { CloudStore, blobSha } from "./cloud";

afterEach(() => vi.unstubAllGlobals());
describe("cloud binary transport on React Native", () => {
  it("uploads binary bytes without constructing a native Blob from typed arrays", async () => {
    const content = "café 🌳";
    let uploaded: ArrayBuffer | undefined;
    const db = createClient("https://cloud.example", "anon", {
      auth: { persistSession: false },
      global: {
        fetch: async (input, init) => {
          if (
            (input instanceof Request ? input.url : String(input)).includes("/storage/v1/object/")
          ) {
            expect(init?.body).toBeInstanceOf(ArrayBuffer);
            uploaded = init?.body as ArrayBuffer;
            return Response.json({ Key: "test" });
          }
          return Response.json(null);
        },
      },
    });
    vi.stubGlobal(
      "Blob",
      class {
        constructor() {
          throw new Error("React Native cannot create Blob from ArrayBufferView");
        }
      },
    );
    await new CloudStore(db, crypto.randomUUID()).create("Native.md", content);
    expect(new TextDecoder().decode(uploaded)).toBe(content);
  });
  it("reads a storage Blob without requiring Blob.arrayBuffer", async () => {
    const NativeResponse = Response;
    const bytes = new TextEncoder().encode("native download 🌳");
    const hash = await blobSha(bytes);
    const blob = new Blob([bytes]);
    Object.defineProperty(blob, "arrayBuffer", { value: undefined });
    const db = createClient("https://cloud.example", "anon", {
      auth: { persistSession: false },
      global: {
        fetch: async (input) => {
          if (
            (input instanceof Request ? input.url : String(input)).includes("/storage/v1/object/")
          )
            return { blob: async () => blob, ok: true } as Response;
          return NativeResponse.json({ sha: hash, size: bytes.length });
        },
      },
    });
    const document = await new CloudStore(db, crypto.randomUUID()).read("Native.md");
    expect(document.content).toBe("native download 🌳");
  });
});
