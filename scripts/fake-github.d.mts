export type FixtureRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: { sha?: string; message?: string; content?: string };
  redirect?: RequestRedirect;
  credentials?: RequestCredentials;
  cache?: RequestCache;
};
export function createFakeGitHub(seed?: Record<string, string | Uint8Array>): {
  requests: FixtureRequest[];
  faults: { status: number; headers?: Record<string, string> }[];
  offline: boolean;
  protected: boolean;
  truncated: boolean;
  truncatedDirectories: boolean;
  beforeWrite?: (path: string, method: string) => Promise<void> | void;
  afterWrite?: (path: string, method: string) => Promise<void> | void;
  set(path: string, content: string | Uint8Array): void;
  delete(path: string): void;
  text(path: string): string | undefined;
  fetch: typeof fetch;
};
