/**
 * Thin typed client over the Volly REST API (/api/me, /api/orgs/:org/apps/…).
 * Every request carries a bearer token — a personal access token
 * (volly_pat_…) or an OAuth access JWT. Token refresh is the caller's
 * concern: pass a `refresh` hook and the client retries one time after a 401.
 */
import { ApiError } from "./errors.js";

// ---- Response shapes (mirroring the API's zod schemas) ----

export interface Me {
  user: { id: string; email: string; name: string | null };
  org: { slug: string; name: string } | null;
  auth: { method: "session" | "pat" | "oauth"; scopes: string[] };
}

export interface AppSummary {
  slug: string;
  name: string;
  visibility: string;
  created_at: string;
  deployed_at: string | null;
  ownedByMe: boolean;
  author_name: string | null;
  has_draft: boolean;
}

export interface App {
  id: string;
  slug: string;
  name: string;
  url: string;
  visibility: string;
  created_at: string;
  deployed_at: string | null;
  ownedByMe: boolean;
  author_name: string | null;
  readme: string | null;
  has_draft: boolean;
  draft_url: string | null;
  kind: string;
}

export interface CreatedApp {
  slug: string;
  name: string;
  url: string;
}

export type DeployJobStatus = "queued" | "validating" | "uploading" | "ready" | "failed";

/** A non-fatal deploy warning (e.g. a Claude host-runtime dependency). */
export interface DeployWarning {
  kind: string;
  title: string;
  summary: string;
  fixPrompt?: string;
}

/** 202 response from triggering a deploy — a job id to poll, not the finished build. */
export interface DeployTrigger {
  jobId: string;
  deploymentId: string;
  status: DeployJobStatus;
  url: string;
  draft: boolean;
}

/** Poll result for an async deploy job. */
export interface DeployJob {
  jobId: string;
  status: DeployJobStatus;
  draft: boolean;
  warnings: DeployWarning[];
  error: string | null;
  deploymentId: string | null;
  url: string;
}

export interface PromoteResult {
  url: string;
  deploymentId: string;
}

export interface Deployment {
  id: string;
  message: string | null;
  deployed_at: string;
  deployed_by: string | null;
  is_draft: boolean;
}

export interface DeploymentPage {
  deployments: Deployment[];
  total_count: number;
}

export interface CreatedToken {
  id: string;
  name: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
  token: string;
}

export interface TokenSummary {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

// Request bodies are always JSON now. The one binary upload (the deploy bundle)
// PUTs its bytes straight to storage via the presigned/capability URL, outside
// this bearer-authed request path.
type RequestBody = string;

/** A decoded response plus its raw JSON text (the --json contract). */
export interface WithRaw<T> {
  data: T;
  raw: string;
}

export interface ClientOptions {
  baseUrl: string;
  token: string;
  version: string;
  /** Invoked once after a 401 to obtain a fresh token (the OAuth refresh
   *  dance); returning null skips the retry. */
  refresh?: () => Promise<string | null>;
  /** Test seam; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class Client {
  private readonly baseUrl: string;
  private token: string;
  private readonly userAgent: string;
  private refresh: ClientOptions["refresh"];
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl;
    this.token = options.token;
    this.userAgent = `volly-cli/${options.version}`;
    this.refresh = options.refresh;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** One request, retried once through `refresh` on a 401; 2xx body text. */
  private async request(method: string, path: string, body?: () => RequestBody): Promise<string> {
    let response = await this.once(method, path, body);
    if (response.status === 401 && this.refresh) {
      const refresh = this.refresh;
      this.refresh = undefined; // one attempt only
      const fresh = await refresh();
      if (fresh) {
        this.token = fresh;
        response = await this.once(method, path, body);
      }
    }
    const raw = await response.text();
    if (response.ok) return raw;

    let message = "";
    try {
      message = (JSON.parse(raw) as { error?: string }).error ?? "";
    } catch {
      // non-JSON error body — fall through to the status-based message
    }
    throw new ApiError(response.status, message, response.headers.get("Retry-After"));
  }

  private once(method: string, path: string, body?: () => RequestBody): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "User-Agent": this.userAgent,
    };
    const payload = body?.();
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: payload,
    });
  }

  private async json<T>(
    method: string,
    path: string,
    body?: () => RequestBody,
  ): Promise<WithRaw<T>> {
    const raw = await this.request(method, path, body);
    return { data: (raw ? JSON.parse(raw) : undefined) as T, raw };
  }

  me(): Promise<WithRaw<Me>> {
    return this.json<Me>("GET", "/api/me");
  }

  /** Resolves the caller's org slug, with an actionable error pre-onboarding. */
  async orgSlug(): Promise<string> {
    const { data } = await this.me();
    if (!data.org) {
      throw new Error(
        `your account has no active organization yet — finish onboarding at ${this.baseUrl} first`,
      );
    }
    return data.org.slug;
  }

  listApps(org: string, search?: string): Promise<WithRaw<AppSummary[]>> {
    const query = search ? `?q=${encodeURIComponent(search)}` : "";
    return this.json<AppSummary[]>("GET", `/api/orgs/${encodeURIComponent(org)}/apps${query}`);
  }

  getApp(org: string, app: string): Promise<WithRaw<App>> {
    return this.json<App>(
      "GET",
      `/api/orgs/${encodeURIComponent(org)}/apps/${encodeURIComponent(app)}`,
    );
  }

  createApp(
    org: string,
    slug: string,
    name: string,
    visibility?: string,
  ): Promise<WithRaw<CreatedApp>> {
    const payload: Record<string, string> = { name, slug };
    if (visibility) payload.visibility = visibility;
    return this.json<CreatedApp>("POST", `/api/orgs/${encodeURIComponent(org)}/apps`, () =>
      JSON.stringify(payload),
    );
  }

  async deleteApp(org: string, app: string): Promise<void> {
    await this.request(
      "DELETE",
      `/api/orgs/${encodeURIComponent(org)}/apps/${encodeURIComponent(app)}`,
    );
  }

  /**
   * Start an async deploy: request an upload URL, PUT the bundle straight to
   * storage, then trigger the deploy. Returns the trigger response (a job id to
   * poll via `getDeployJob`) — the build validates and publishes in a background
   * Workflow. The two authed JSON calls keep their retry-on-401 body thunks; the
   * PUT itself is authorized by the upload URL, not the bearer token.
   */
  async deploy(
    org: string,
    app: string,
    filename: string,
    content: Uint8Array,
    message: string,
    draft: boolean,
  ): Promise<WithRaw<DeployTrigger>> {
    const base = `/api/orgs/${encodeURIComponent(org)}/apps/${encodeURIComponent(app)}`;
    const { data: upload } = await this.json<{ uploadId: string; uploadUrl: string }>(
      "POST",
      `${base}/deploy-uploads`,
      () => JSON.stringify({ filename }),
    );
    const put = await this.fetchImpl(upload.uploadUrl, {
      method: "PUT",
      body: content as Uint8Array<ArrayBuffer>,
    });
    if (!put.ok) {
      throw new ApiError(put.status, "upload failed", put.headers.get("Retry-After"));
    }
    return this.json<DeployTrigger>("POST", `${base}/deploy`, () =>
      JSON.stringify({ uploadId: upload.uploadId, message: message || undefined, draft }),
    );
  }

  /** Poll a deploy job's status (the async deploy's completion signal). */
  getDeployJob(org: string, app: string, jobId: string): Promise<WithRaw<DeployJob>> {
    return this.json<DeployJob>(
      "GET",
      `/api/orgs/${encodeURIComponent(org)}/apps/${encodeURIComponent(app)}/deploy-jobs/${encodeURIComponent(jobId)}`,
    );
  }

  publishDraft(org: string, app: string): Promise<WithRaw<PromoteResult>> {
    return this.json<PromoteResult>(
      "POST",
      `/api/orgs/${encodeURIComponent(org)}/apps/${encodeURIComponent(app)}/promote`,
    );
  }

  async discardDraft(org: string, app: string): Promise<void> {
    await this.request(
      "DELETE",
      `/api/orgs/${encodeURIComponent(org)}/apps/${encodeURIComponent(app)}/draft`,
    );
  }

  listDeployments(org: string, app: string, limit: number): Promise<WithRaw<DeploymentPage>> {
    return this.json<DeploymentPage>(
      "GET",
      `/api/orgs/${encodeURIComponent(org)}/apps/${encodeURIComponent(app)}/deployments?limit=${limit}`,
    );
  }

  createToken(
    name: string,
    scopes: string[],
    expiresInDays: number,
  ): Promise<WithRaw<CreatedToken>> {
    const payload: Record<string, unknown> = { name };
    if (scopes.length > 0) payload.scopes = scopes;
    if (expiresInDays > 0) payload.expiresInDays = expiresInDays;
    return this.json<CreatedToken>("POST", "/api/me/tokens", () => JSON.stringify(payload));
  }

  async listTokens(): Promise<WithRaw<TokenSummary[]>> {
    const page = await this.json<{ tokens: TokenSummary[] }>("GET", "/api/me/tokens");
    return { data: page.data.tokens, raw: page.raw };
  }

  async revokeToken(id: string): Promise<void> {
    await this.request("DELETE", `/api/me/tokens/${encodeURIComponent(id)}`);
  }
}
