/**
 * retry.ts — Generic async retry with exponential backoff + jitter.
 *
 * AI provider calls fail transiently (rate limits, brief network blips,
 * upstream 5xx). Previously a single failure aborted the whole generation
 * pass. This helper retries retryable failures while immediately rethrowing
 * user-initiated aborts and timeouts (which must NOT be retried).
 */

import type { RetryOptions } from "./provider";

export type RetryableErrorClassifier = (err: unknown) => boolean;

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 600;
const DEFAULT_MAX_DELAY_MS = 8000;

/** HTTP status codes that are worth retrying (transient / server-side). */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Best-effort extraction of an error's `name` (works for Error and DOMException). */
function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null && "name" in err) {
    const n = (err as { name?: unknown }).name;
    return typeof n === "string" ? n : "";
  }
  return "";
}

/** Best-effort extraction of an error's message string. */
function errorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}

/**
 * Extract an HTTP status code from an Error message shaped like
 * `"OpenAI 429: ..."` / `"Ollama 503: ..."` / `"llama.cpp 500: ..."`, which is
 * how the provider classes surface non-ok responses.
 */
function statusFromError(err: unknown): number | null {
  const m = /\b(408|425|429|500|502|503|504)\b/.exec(errorMessage(err));
  return m ? Number(m[1]) : null;
}

/** True when the error represents a user/timeout abort that must not be retried. */
export function isAbortLike(err: unknown): boolean {
  const name = errorName(err);
  const msg = errorMessage(err);
  return name === "AbortError" || name === "TimeoutError" || /\baborted\b|timed out/i.test(msg);
}

/**
 * Default classifier: retry on network-level failures and retryable HTTP
 * status codes, but never on aborts/timeouts.
 */
export function defaultIsRetryable(err: unknown): boolean {
  if (isAbortLike(err)) return false;
  const status = statusFromError(err);
  if (status != null) return RETRYABLE_STATUS.has(status);
  // Fetch network failures surface as TypeError ("Failed to fetch") in browsers.
  if (err instanceof TypeError) return true;
  const msg = errorMessage(err);
  return /network|failed to fetch|econnreset|econnrefused|socket hang up|fetch failed/i.test(msg);
}

function computeDelay(attempt: number, opts: Required<Omit<RetryOptions, "jitter">> & { jitter: boolean }): number {
  const exp = opts.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(opts.maxDelayMs, exp);
  if (!opts.jitter) return capped;
  // Full jitter: random between 0 and capped.
  return Math.round(Math.random() * capped);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` with retry. `fn` receives the 1-based attempt number.
 *
 * @param fn         Operation to run/retry.
 * @param opts       Retry tuning (defaults: 3 attempts, 600ms base, 8s cap, jitter on).
 * @param isRetryable Classifier deciding whether a given error should be retried.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
  isRetryable: RetryableErrorClassifier = defaultIsRetryable,
): Promise<T> {
  const resolved = {
    maxAttempts: Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    baseDelayMs: Math.max(0, opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS),
    maxDelayMs: Math.max(0, opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS),
    jitter: opts.jitter ?? true,
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= resolved.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const canRetry = attempt < resolved.maxAttempts && isRetryable(err);
      if (!canRetry) throw err;
      await sleep(computeDelay(attempt, resolved));
    }
  }
  // Unreachable in practice (loop either returns or throws), but satisfies types.
  throw lastErr;
}
