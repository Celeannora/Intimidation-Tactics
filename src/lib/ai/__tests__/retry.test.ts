import { describe, expect, it, vi } from "vitest";
import { withRetry, defaultIsRetryable, isAbortLike } from "../retry";

const noDelay = { baseDelayMs: 0, maxDelayMs: 0, jitter: false };

describe("withRetry", () => {
  it("returns immediately on first success", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await withRetry(fn, noDelay);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable failure then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("OpenAI 429: rate limited");
      return "recovered";
    });
    const result = await withRetry(fn, { ...noDelay, maxAttempts: 3 });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("exhausts max attempts and rethrows the last error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("Ollama 503: unavailable");
    });
    await expect(withRetry(fn, { ...noDelay, maxAttempts: 3 })).rejects.toThrow(/503/);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("OpenAI 400: bad request");
    });
    await expect(withRetry(fn, { ...noDelay, maxAttempts: 4 })).rejects.toThrow(/400/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("never retries an AbortError", async () => {
    const fn = vi.fn(async () => {
      throw new DOMException("AI request aborted", "AbortError");
    });
    await expect(withRetry(fn, { ...noDelay, maxAttempts: 5 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("honors a custom classifier", async () => {
    const fn = vi.fn(async () => {
      throw new Error("weird");
    });
    const always = () => true;
    await expect(withRetry(fn, { ...noDelay, maxAttempts: 2 }, always)).rejects.toThrow(/weird/);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("defaultIsRetryable", () => {
  it("retries transient HTTP status codes", () => {
    expect(defaultIsRetryable(new Error("OpenAI 429: x"))).toBe(true);
    expect(defaultIsRetryable(new Error("Ollama 500: x"))).toBe(true);
    expect(defaultIsRetryable(new Error("llama.cpp 503: x"))).toBe(true);
  });

  it("does not retry client errors", () => {
    expect(defaultIsRetryable(new Error("OpenAI 400: x"))).toBe(false);
    expect(defaultIsRetryable(new Error("OpenAI 401: x"))).toBe(false);
  });

  it("retries network-level failures", () => {
    expect(defaultIsRetryable(new TypeError("Failed to fetch"))).toBe(true);
    expect(defaultIsRetryable(new Error("network error"))).toBe(true);
  });

  it("never retries aborts/timeouts", () => {
    expect(defaultIsRetryable(new DOMException("aborted", "AbortError"))).toBe(false);
    expect(defaultIsRetryable(new DOMException("timed out", "TimeoutError"))).toBe(false);
  });
});

describe("statusFromError structured fields (Fix 7)", () => {
  it("prefers a structured status field over message text", () => {
    expect(defaultIsRetryable({ status: 503 })).toBe(true);
    expect(defaultIsRetryable({ status: 400 })).toBe(false);
    expect(defaultIsRetryable({ statusCode: 429 })).toBe(true);
  });

  it("reads nested response.status and cause.status", () => {
    expect(defaultIsRetryable({ response: { status: 429 } })).toBe(true);
    expect(defaultIsRetryable({ cause: { status: 500 } })).toBe(true);
    expect(defaultIsRetryable({ response: { status: 401 } })).toBe(false);
  });

  it("only treats an anchored '<Provider> <ddd>:' message as a status, not bare numbers", () => {
    // Anchored provider prefix → real status → retryable.
    expect(defaultIsRetryable(new Error("OpenAI 502: upstream"))).toBe(true);
    // A bare 3-digit number inside an error body must NOT be read as a status
    // (the old scraper misclassified these). No network keyword → not retryable.
    expect(defaultIsRetryable(new Error("Card text: deals 500 damage to any target"))).toBe(false);
    expect(defaultIsRetryable(new Error("resolved 429 matches in the index"))).toBe(false);
  });
});

describe("isAbortLike", () => {
  it("detects abort and timeout errors", () => {
    expect(isAbortLike(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortLike(new DOMException("x", "TimeoutError"))).toBe(true);
    expect(isAbortLike(new Error("the request was aborted"))).toBe(true);
    expect(isAbortLike(new Error("boom"))).toBe(false);
  });
});
