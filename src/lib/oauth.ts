/**
 * The interactive `volly login` flow against Volly's own OAuth 2.1 provider:
 * anonymous dynamic client registration (RFC 7591), authorization-code + PKCE
 * with a loopback redirect (RFC 8252), an RFC 8707 resource indicator for the
 * REST audience, and refresh-token rotation for long-lived CLI sessions.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** Scopes the CLI requests: the app surface plus a refresh token. */
const SCOPE = "offline_access apps:read apps:write";

export interface Tokens {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp; empty when the server sent no expiry. */
  expiresAt: string;
}

/** RFC 8707 indicator: tokens are minted for the REST surface. */
const resource = (apiUrl: string): string => `${apiUrl}/api`;

const base64url = (buf: Buffer): string => buf.toString("base64url");

/**
 * Registers a public client for this login's exact loopback redirect.
 * Registration is anonymous and cheap; a fresh client per login sidesteps
 * redirect-URI/port mismatches entirely.
 */
async function register(apiUrl: string, redirectUri: string): Promise<string> {
  const response = await fetch(`${apiUrl}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Volly CLI",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`client registration failed (HTTP ${response.status}): ${raw}`);
  }
  const clientId = (JSON.parse(raw) as { client_id?: string }).client_id;
  if (!clientId) throw new Error("client registration returned no client_id");
  return clientId;
}

/**
 * Drives the full browser flow. `openBrowser` receives the authorize URL
 * (also printed by the caller as a fallback); the loopback listener waits up
 * to timeoutMs for the redirect.
 */
export async function login(
  apiUrl: string,
  openBrowser: (url: string) => void,
  timeoutMs: number,
): Promise<Tokens> {
  const { promise: callback, resolve, reject } = withResolvers<string>();
  const state = base64url(randomBytes(24));

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const fail = (status: number, message: string, error: Error) => {
      res.writeHead(status, { "Content-Type": "text/plain" }).end(message);
      reject(error);
    };
    if (url.searchParams.get("state") !== state) {
      fail(400, "state mismatch", new Error("authorization response state mismatch"));
    } else if (url.searchParams.get("error")) {
      fail(
        400,
        "authorization failed",
        new Error(`authorization failed: ${url.searchParams.get("error")}`),
      );
    } else if (!url.searchParams.get("code")) {
      fail(400, "missing code", new Error("authorization response carried no code"));
    } else {
      res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(
          `<!doctype html><title>Volly CLI</title><body style="font-family:system-ui;padding:3rem"><h2>Signed in.</h2><p>You can close this tab and return to your terminal.</p></body>`,
        );
      resolve(url.searchParams.get("code") as string);
    }
  });

  await new Promise<void>((ready, failed) => {
    server.once("error", failed);
    server.listen(0, "127.0.0.1", ready);
  });
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    const clientId = await register(apiUrl, redirectUri);

    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash("sha256").update(verifier).digest());

    const authorize =
      `${apiUrl}/api/auth/oauth2/authorize?` +
      new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: SCOPE,
        resource: resource(apiUrl),
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();

    openBrowser(authorize);

    const timeout = setTimeout(() => {
      reject(
        new Error(
          `timed out waiting for the browser sign-in — run 'volly login --with-token' to paste a token instead`,
        ),
      );
    }, timeoutMs);
    let code: string;
    try {
      code = await callback;
    } finally {
      clearTimeout(timeout);
    }

    const tokens = await exchange(apiUrl, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: resource(apiUrl),
    });
    return { ...tokens, clientId };
  } finally {
    server.close();
  }
}

/**
 * Trades a refresh token for a fresh access token (and, with rotation, a new
 * refresh token — callers must persist the result).
 */
export async function refresh(
  apiUrl: string,
  clientId: string,
  refreshToken: string,
): Promise<Tokens> {
  const tokens = await exchange(apiUrl, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    resource: resource(apiUrl),
  });
  return {
    ...tokens,
    clientId,
    refreshToken: tokens.refreshToken || refreshToken,
  };
}

async function exchange(
  apiUrl: string,
  form: Record<string, string>,
): Promise<Omit<Tokens, "clientId">> {
  const response = await fetch(`${apiUrl}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const raw = await response.text();
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(raw) as {
        error?: string;
        error_description?: string;
      };
      if (parsed.error) {
        detail = parsed.error_description
          ? `${parsed.error} (${parsed.error_description})`
          : parsed.error;
      }
    } catch {
      // keep the status-based detail
    }
    throw new Error(`token request failed: ${detail}`);
  }
  const body = JSON.parse(raw) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) throw new Error("token response carried no access token");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? "",
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : "",
  };
}

function withResolvers<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
