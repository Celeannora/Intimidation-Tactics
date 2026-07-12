import type { AIProvider, AIGenerationRequest, AISettings } from "./provider";
import { withTimeoutSignal } from "./provider";
import { normalizeOpenAIBase } from "./models";
import { readOpenAISSE } from "./openai";
import { withRetry } from "./retry";

export class LlamaCppProvider implements AIProvider {
  readonly id = "llamacpp";
  readonly label = "llama.cpp / LM Studio (local)";
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private defaultMaxTokens?: number;
  private defaultTimeoutMs?: number;

  constructor(settings: AISettings) {
    this.baseUrl = normalizeOpenAIBase(settings.llamaCppBaseUrl ?? "http://localhost:8080");
    this.model = settings.llamaCppModel ?? "local";
    this.apiKey = settings.llamaCppApiKey ?? "";
    this.defaultMaxTokens = settings.maxTokens;
    this.defaultTimeoutMs = settings.requestTimeoutMs;
  }

  async isReady(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        method: "GET",
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
      });
      if (res.ok) return true;
      const health = await fetch(`${this.baseUrl}/health`, { method: "GET" });
      return health.ok;
    } catch {
      return false;
    }
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  private buildBody(req: AIGenerationRequest, stream: boolean): string {
    // NOTE: response_format json_object/json_schema is intentionally NOT sent by
    // default. Many LM Studio / llama.cpp model loadouts hang or silently refuse
    // to emit tokens when grammar-constrained JSON mode is requested but the
    // loaded model doesn't support it. We rely on the system prompt to request
    // strict JSON instead. If a schema is explicitly supplied on the request we
    // still avoid sending it here for the same safety reason; callers that know
    // their backend supports it can extend this method.
    return JSON.stringify({
      model: this.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxTokens ?? this.defaultMaxTokens ?? 2400,
      stream,
    });
  }

  async generate(req: AIGenerationRequest): Promise<string> {
    return withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        signal: withTimeoutSignal(req.signal, req.timeoutMs ?? this.defaultTimeoutMs),
        headers: this.headers(),
        body: this.buildBody(req, false),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`llama.cpp ${res.status}: ${txt.slice(0, 240)}`);
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("llama.cpp returned no content");
      return content;
    }, req.retry);
  }

  async generateStream(
    req: AIGenerationRequest,
    onToken: (chunk: string) => void
  ): Promise<string> {
    return withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        signal: withTimeoutSignal(req.signal, req.timeoutMs ?? this.defaultTimeoutMs),
        headers: this.headers(),
        body: this.buildBody(req, true),
      });
      if (!res.ok || !res.body) {
        const txt = res.body ? await res.text() : "";
        throw new Error(`llama.cpp ${res.status}: ${txt.slice(0, 240)}`);
      }
      try {
        return await readOpenAISSE(res.body, onToken);
      } catch (err) {
        if (isStreamAbortError(err)) {
          throw new Error(
            "LM Studio/llama.cpp stream was aborted. The prompt may be too large for the loaded model/context window; try reducing AI Digest Size to 100–250, or load a model with a larger context."
          );
        }
        throw err;
      }
    }, req.retry);
  }
}

function isStreamAbortError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  return /aborted|BodyStreamBuffer/i.test(`${name} ${message}`);
}
