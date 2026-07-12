export interface AIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Structured-output schema passed to providers that support constrained JSON
 * generation (OpenAI `json_schema`, Ollama `format`, optionally llama.cpp).
 * When present the provider asks the model to emit JSON matching `schema`,
 * which nearly eliminates parse failures and the regex salvage path.
 */
export interface AIJsonSchema {
  /** Schema name (required by OpenAI's json_schema response_format). */
  name: string;
  /** JSON Schema object describing the expected response shape. */
  schema: Record<string, unknown>;
  /** When true, request strict adherence (OpenAI structured outputs). */
  strict?: boolean;
}

/** Retry/backoff tuning for transient provider failures. */
export interface RetryOptions {
  /** Total attempts including the first (default 3). */
  maxAttempts?: number;
  /** Base backoff delay in ms (default 600). */
  baseDelayMs?: number;
  /** Maximum backoff delay in ms (default 8000). */
  maxDelayMs?: number;
  /** Apply full jitter to backoff delays (default true). */
  jitter?: boolean;
}

export interface AIGenerationRequest {
  messages: AIChatMessage[];
  /** Lower = more deterministic. */
  temperature?: number;
  /** Soft cap on output tokens. */
  maxTokens?: number;
  /** Abort signal from the UI, used for cancel buttons and navigation cleanup. */
  signal?: AbortSignal;
  /** Provider-level timeout guard. Defaults are provider-specific. */
  timeoutMs?: number;
  /** Optional structured-output schema for providers that support it. */
  jsonSchema?: AIJsonSchema;
  /** Optional per-request retry override. */
  retry?: RetryOptions;
}


export interface AIProvider {
  readonly id: string;
  readonly label: string;
  /** True if the provider is ready to use (e.g. API key set, server reachable). */
  isReady(): Promise<boolean>;
  generate(req: AIGenerationRequest): Promise<string>;
  /** Optional streaming variant. If absent, the orchestrator falls back to generate(). */
  generateStream?(req: AIGenerationRequest, onToken: (chunk: string) => void): Promise<string>;
}

export interface AISettings {
  providerId: "openai" | "ollama" | "llamacpp" | "none";
  openaiApiKey?: string;
  openaiModel?: string;       // default "gpt-4o-mini"
  ollamaBaseUrl?: string;     // default "http://localhost:11434"
  ollamaModel?: string;       // default "llama3.1:8b"
  llamaCppBaseUrl?: string;   // default "http://localhost:8080"
  llamaCppModel?: string;     // default "local"
  llamaCppApiKey?: string;    // optional bearer for proxied setups
  /**
   * Opt-in: send the structured-output JSON schema to llama.cpp / LM Studio via
   * `response_format: { type: "json_schema" }`. Off by default because many local
   * loadouts hang or refuse to emit tokens under grammar-constrained JSON mode;
   * enable only when the backend is known to support it.
   */
  llamaCppUseJsonSchema?: boolean;
  /**
   * Optional per-provider output-token cap. When a request does not specify
   * `maxTokens`, providers fall back to this value (and then their own default).
   */
  maxTokens?: number;
  /**
   * Optional per-provider request timeout in ms. When a request does not
   * specify `timeoutMs`, providers use this value (and then the 120s default).
   */
  requestTimeoutMs?: number;
}

const STORAGE_KEY = "mtg.ai.settings";

const DEFAULT_SETTINGS: AISettings = {
  providerId: "none",
  openaiModel: "gpt-4o-mini",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3.1:8b",
  llamaCppBaseUrl: "http://localhost:8080",
  llamaCppModel: "local",
};

export function loadAISettings(): AISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AISettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAISettings(settings: AISettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMs = 120_000): AbortSignal {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(new DOMException("AI request timed out", "TimeoutError")), timeoutMs);
  const abort = () => controller.abort(signal?.reason ?? new DOMException("AI request aborted", "AbortError"));
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  controller.signal.addEventListener("abort", () => window.clearTimeout(timeout), { once: true });
  return controller.signal;
}