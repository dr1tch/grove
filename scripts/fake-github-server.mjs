// Test-only HTTP wrapper; never point this at a real repository or use real credentials.
import { createServer } from "node:http";
import { createFakeGitHub } from "./fake-github.mjs";
const fake = createFakeGitHub({ "Welcome.md": "# Fixture vault\n" });
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept, X-GitHub-Api-Version",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 75 * 1024 * 1024) throw new Error("Fixture request too large");
      chunks.push(chunk);
    }
    const result = await fake.fetch(`https://api.github.com${request.url}`, {
      method: request.method,
      headers: request.headers,
      ...(chunks.length ? { body: Buffer.concat(chunks).toString() } : {}),
    });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.writeHead(500).end("Fixture failure");
  }
});
server.listen(Number(process.env.PORT) || 4070, "127.0.0.1", () =>
  console.log("Fake GitHub fixture ready", server.address()),
);
