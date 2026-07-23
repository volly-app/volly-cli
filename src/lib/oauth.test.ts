import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { login, refresh } from "./oauth.js";

/**
 * Just enough of the OAuth server: registration echoes a client_id,
 * "authorize" is driven by the test acting as the browser, and the token
 * endpoint validates PKCE.
 */
interface ProviderState {
  registeredRedirect: string;
  challenge: string;
  issuedCode: string;
}

let server: Server | undefined;

async function fakeProvider(): Promise<{ url: string; state: ProviderState }> {
  const state: ProviderState = {
    registeredRedirect: "",
    challenge: "",
    issuedCode: "",
  };
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/auth/oauth2/register") {
        const redirects = (JSON.parse(body) as { redirect_uris?: string[] }).redirect_uris;
        state.registeredRedirect = redirects?.[0] ?? "";
        res.end(JSON.stringify({ client_id: "test-client" }));
        return;
      }
      if (req.url === "/api/auth/oauth2/token") {
        const form = new URLSearchParams(body);
        if (form.get("grant_type") === "authorization_code") {
          const digest = createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest("base64url");
          if (digest !== state.challenge || form.get("code") !== state.issuedCode) {
            res.writeHead(400).end(JSON.stringify({ error: "invalid_grant" }));
            return;
          }
          res.end(
            JSON.stringify({
              access_token: "access-1",
              refresh_token: "refresh-1",
              expires_in: 3600,
            }),
          );
          return;
        }
        if (form.get("grant_type") === "refresh_token") {
          if (form.get("refresh_token") !== "refresh-1") {
            res.writeHead(400).end(JSON.stringify({ error: "invalid_grant" }));
            return;
          }
          res.end(
            JSON.stringify({
              access_token: "access-2",
              refresh_token: "refresh-2",
              expires_in: 3600,
            }),
          );
          return;
        }
      }
      res.writeHead(400).end("{}");
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, state };
}

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("login", () => {
  it("completes the PKCE round trip through the loopback listener", async () => {
    const { url, state } = await fakeProvider();

    // The "browser": record the PKCE challenge and redirect straight back to
    // the loopback with a code + the same state.
    const browse = (authorizeUrl: string) => {
      const parsed = new URL(authorizeUrl);
      expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
      expect(parsed.searchParams.get("resource")).toBe(`${url}/api`);
      state.challenge = parsed.searchParams.get("code_challenge") ?? "";
      state.issuedCode = "code-123";
      const redirect = `${parsed.searchParams.get("redirect_uri")}?code=code-123&state=${encodeURIComponent(parsed.searchParams.get("state") ?? "")}`;
      void fetch(redirect);
    };

    const tokens = await login(url, browse, 10_000);
    expect(tokens.clientId).toBe("test-client");
    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
    expect(new Date(tokens.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(state.registeredRedirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  });

  it("rejects a forged state", async () => {
    const { url, state } = await fakeProvider();
    const browse = (authorizeUrl: string) => {
      const parsed = new URL(authorizeUrl);
      state.challenge = parsed.searchParams.get("code_challenge") ?? "";
      state.issuedCode = "code-123";
      void fetch(`${parsed.searchParams.get("redirect_uri")}?code=code-123&state=forged`);
    };
    await expect(login(url, browse, 10_000)).rejects.toThrow(/state mismatch/);
  });
});

describe("refresh", () => {
  it("rotates both tokens", async () => {
    const { url } = await fakeProvider();
    const tokens = await refresh(url, "test-client", "refresh-1");
    expect(tokens.accessToken).toBe("access-2");
    expect(tokens.refreshToken).toBe("refresh-2");
  });
});
