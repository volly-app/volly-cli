import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { Client } from "./api.js";
import { ApiError, exitCode } from "./errors.js";

type Handler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => void;

let server: Server | undefined;

let baseUrl = "";

async function testClient(handler: Handler): Promise<Client> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => handler(req, res, Buffer.concat(chunks)));
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  return new Client({
    baseUrl,
    token: "volly_pat_test_token",
    version: "test",
  });
}

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("headers", () => {
  it("sends the bearer token and user agent", async () => {
    let auth = "";
    let agent = "";
    const client = await testClient((req, res) => {
      auth = req.headers.authorization ?? "";
      agent = req.headers["user-agent"] ?? "";
      res.end(
        JSON.stringify({
          user: { id: "u1", email: "a@b.c", name: "A" },
          org: { slug: "acme", name: "Acme" },
          auth: { method: "pat", scopes: ["apps:read"] },
        }),
      );
    });
    const { data: me } = await client.me();
    expect(auth).toBe("Bearer volly_pat_test_token");
    expect(agent).toBe("volly-cli/test");
    expect(me.org?.slug).toBe("acme");
    expect(me.auth.method).toBe("pat");
  });
});

describe("error mapping", () => {
  it.each([
    [401, '{"error":"unauthorized"}', 3, "volly login"],
    [404, '{"error":"app not found"}', 4, "app not found"],
    [409, '{"error":"an app with this slug already exists"}', 1, "already exists"],
    [413, '{"error":"upload too large"}', 1, "too large"],
    [429, '{"error":"rate limited"}', 1, "retry"],
  ])("maps HTTP %d to exit %d", async (status, body, wantExit, wantMessage) => {
    const client = await testClient((_req, res) => {
      if (status === 429) res.setHeader("Retry-After", "60");
      res.writeHead(status).end(body);
    });
    const error = await client.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(exitCode(error)).toBe(wantExit);
    expect((error as Error).message).toContain(wantMessage);
  });
});

describe("refresh", () => {
  it("retries once after a 401 with the refreshed token", async () => {
    let calls = 0;
    await testClient((req, res) => {
      calls++;
      if (req.headers.authorization === "Bearer fresh") {
        res.end(
          JSON.stringify({
            user: { id: "u1", email: "a@b.c" },
            auth: { method: "oauth" },
          }),
        );
        return;
      }
      res.writeHead(401).end('{"error":"unauthorized"}');
    });
    // Simulate a stale stored access token with a working refresh hook.
    const stale = new Client({
      baseUrl,
      token: "stale",
      version: "test",
      refresh: async () => "fresh",
    });
    const { data: me } = await stale.me();
    expect(me.user.id).toBe("u1");
    expect(calls).toBe(2);
  });
});

describe("deploy", () => {
  it("posts a rebuilt multipart body with file, message, and draft fields", async () => {
    const client = await testClient((req, res, body) => {
      expect(req.url).toBe("/api/orgs/acme/apps/site/deploy");
      const text = body.toString("latin1");
      expect(req.headers["content-type"]).toContain("multipart/form-data");
      expect(text).toContain('name="file"');
      expect(text).toContain("zip-bytes");
      expect(text).toContain('name="message"');
      expect(text).toContain("hello");
      expect(text).toContain('name="draft"');
      expect(text).toContain("true");
      res.end(
        JSON.stringify({
          url: "https://acme-site.volly.so",
          deploymentId: "d1",
          fileCount: 3,
          totalBytes: 9,
          draft: true,
        }),
      );
    });
    const { data: result } = await client.deploy(
      "acme",
      "site",
      "bundle.zip",
      new TextEncoder().encode("zip-bytes"),
      "hello",
      true,
    );
    expect(result.url).toBe("https://acme-site.volly.so");
    expect(result.draft).toBe(true);
  });
});

describe("queries and no-content responses", () => {
  it("encodes the search query", async () => {
    let url = "";
    const client = await testClient((req, res) => {
      url = req.url ?? "";
      res.end("[]");
    });
    await client.listApps("acme", "my tracker");
    expect(url).toBe("/api/orgs/acme/apps?q=my%20tracker");
  });

  it("accepts 204s from delete endpoints", async () => {
    const client = await testClient((req, res) => {
      expect(req.method).toBe("DELETE");
      res.writeHead(204).end();
    });
    await expect(client.deleteApp("acme", "site")).resolves.toBeUndefined();
    await expect(client.revokeToken("tok-1")).resolves.toBeUndefined();
  });
});
