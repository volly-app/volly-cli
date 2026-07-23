/**
 * Error taxonomy and the CLI's exit-code contract:
 * 0 ok · 1 generic · 2 usage · 3 authentication · 4 not found.
 */

/** Any non-2xx API response, with enough context for friendly output. */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;

  constructor(status: number, message: string, retryAfter: string | null = null) {
    super(ApiError.friendly(status, message, retryAfter));
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }

  private static friendly(status: number, message: string, retryAfter: string | null): string {
    switch (status) {
      case 401:
        return `authentication failed — run 'volly login' or set VOLLY_TOKEN`;
      case 429:
        return retryAfter
          ? `rate limited — retry in ${retryAfter} seconds`
          : `rate limited — retry shortly`;
      case 413:
        return `upload too large: ${message}`;
    }
    return message || `API error (HTTP ${status})`;
  }
}

/** Caller mistakes (exit 2) that Clipanion's own parsing can't catch — e.g. a
 *  prompt required in a non-interactive run. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function exitCode(error: unknown): number {
  if (error instanceof CliUsageError) return 2;
  if (error instanceof ApiError) {
    if (error.status === 401) return 3;
    if (error.status === 404) return 4;
  }
  return 1;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
