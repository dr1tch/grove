// In-memory GitHub REST fixture. Uses Web APIs so the same server faults work in browser QA.
export function createFakeGitHub(seed = {}) {
  let counter = 0;
  const newHash = () => (++counter).toString(16).padStart(40, "0");
  const blobs = new Map(),
    encoded = new Map(),
    snapshots = [],
    trees = new Map();
  const files = new Map();
  const bytesOf = (value) =>
    typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  const blob = (value) => {
    const bytes = bytesOf(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const key = btoa(binary);
    if (!encoded.has(key)) {
      const id = newHash();
      encoded.set(key, id);
      blobs.set(id, bytes);
    }
    return encoded.get(key);
  };
  for (const [path, value] of Object.entries(seed)) files.set(path, blob(value));
  const snapshot = (changed) => {
    const id = newHash();
    const item = { id, files: new Map(files), changed, tree: newHash() };
    snapshots.unshift(item);
    trees.set(item.tree, { snapshot: item, prefix: "" });
    return item;
  };
  snapshot(Object.keys(seed));
  const json = (body, status = 200, headers = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  const fake = {
    requests: [],
    faults: [],
    offline: false,
    protected: false,
    truncated: false,
    truncatedDirectories: false,
    beforeWrite: undefined,
    afterWrite: undefined,
    set(path, content) {
      files.set(path, blob(content));
      snapshot([path]);
    },
    delete(path) {
      files.delete(path);
      snapshot([path]);
    },
    text(path) {
      const id = files.get(path);
      return id ? new TextDecoder().decode(blobs.get(id)) : undefined;
    },
    async fetch(input, init = {}) {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      const method = init.method ?? "GET",
        headers = new Headers(init.headers);
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      fake.requests.push({
        url: url.href,
        method,
        headers: Object.fromEntries(headers),
        body,
        redirect: init.redirect,
        credentials: init.credentials,
        cache: init.cache,
      });
      if (fake.offline) throw new TypeError("Fixture network unavailable");
      const fault = fake.faults.shift();
      if (fault) return json({ message: "Fixture rejection" }, fault.status, fault.headers);
      if (url.origin !== "https://api.github.com") throw new Error("Credential origin escaped");
      const route = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, "");
      if (route.startsWith("/git/blobs/")) {
        const bytes = blobs.get(decodeURIComponent(route.slice(11)));
        return bytes
          ? new Response(bytes, { headers: { "content-length": String(bytes.length) } })
          : json({}, 404);
      }
      if (route.startsWith("/git/trees/")) {
        const tree = trees.get(decodeURIComponent(route.slice(11)));
        if (!tree) return json({}, 404);
        const recursive = url.searchParams.has("recursive");
        const entries = new Map();
        for (const [fullPath, id] of tree.snapshot.files) {
          if (!fullPath.startsWith(tree.prefix)) continue;
          const relative = fullPath.slice(tree.prefix.length),
            parts = relative.split("/");
          for (let index = 1; index < parts.length; index++) {
            if (!recursive && index > 1) break;
            const path = parts.slice(0, index).join("/");
            if (!entries.has(path)) {
              const treeId = newHash();
              trees.set(treeId, { snapshot: tree.snapshot, prefix: tree.prefix + path + "/" });
              entries.set(path, { path, mode: "040000", type: "tree", sha: treeId });
            }
          }
          if (recursive || parts.length === 1)
            entries.set(relative, {
              path: relative,
              mode: "100644",
              type: "blob",
              sha: id,
              size: blobs.get(id).length,
            });
        }
        return json({
          tree: [...entries.values()],
          truncated: recursive ? fake.truncated : fake.truncatedDirectories,
        });
      }
      if (route.startsWith("/commits/")) {
        return json({ sha: snapshots[0].id, commit: { tree: { sha: snapshots[0].tree } } });
      }
      if (route === "/commits") {
        const path = url.searchParams.get("path");
        return json(
          snapshots
            .filter((item) => item.changed.includes(path))
            .slice(0, 30)
            .map((item) => ({
              sha: item.id,
              commit: { author: { name: "Fixture", date: "2026-11-12T10:00:00Z" } },
            })),
        );
      }
      if (route.startsWith("/contents/")) {
        const path = route.slice(10).split("/").map(decodeURIComponent).join("/");
        if (method === "GET") {
          const ref = url.searchParams.get("ref");
          const source = /^[a-f\d]{40}$/.test(ref ?? "")
            ? snapshots.find((item) => item.id === ref)?.files
            : files;
          const id = source?.get(path);
          if (id) return json({ type: "file", sha: id, size: blobs.get(id).length });
          if ([...(source?.keys() ?? [])].some((item) => item.startsWith(path + "/")))
            return json([]);
          return json({}, 404);
        }
        if (fake.protected) return json({ message: "Protected branch" }, 403);
        await fake.beforeWrite?.(path, method);
        const existing = files.get(path);
        if (method === "PUT") {
          if (existing ? body.sha !== existing : Boolean(body.sha))
            return json({ message: "SHA conflict" }, existing && !body.sha ? 422 : 409);
          const binary = atob(body.content),
            bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
          const id = blob(bytes);
          files.set(path, id);
          snapshot([path]);
          await fake.afterWrite?.(path, method);
          return json({ content: { sha: id } }, existing ? 200 : 201);
        }
        if (method === "DELETE") {
          if (!existing) return json({}, 404);
          if (body.sha !== existing) return json({}, 409);
          files.delete(path);
          snapshot([path]);
          return json({ content: null });
        }
      }
      return json({}, 404);
    },
  };
  return fake;
}
