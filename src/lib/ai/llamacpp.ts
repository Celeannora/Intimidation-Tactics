import type { AIProvider, AIGenerationRequest, AISettings } from "./provider";
import { withTimeoutSignal } from "./provider";
import { normalizeOpenAIBase } from "./models";
import { readOpenAISSE } from "./openai";

export class LlamaCppProvider implements AIProvider {
  readonly id = "llamacpp";
  readonly label = "llama.cpp / LM Studio (local)";
  private baseUrl: string;
  private model: string;
  private apiKey: string;

  constructor(settings: AISettings) {
    this.baseUrl = normalizeOpenAIBase(settings.llamaCppBaseUrl ?? "http://localhost:8080");
    this.model = settings.llamaCppModel ?? "local";
    this.apiKey = settings.llamaCppApiKey ?? "";
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

  async generate(req: AIGenerationRequest): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      signal: withTimeoutSignal(req.signal, req.timeoutMs),
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.4,
        max_tokens: req.maxTokens ?? 2400,
        stream: false,
        // NOTE: response_format json_object is intentionally NOT sent here.
        // Many LM Studio / llama.cpp model loadouts hang or silently refuse to
        // emit tokens when grammar-constrained JSON mode is requested but the
        // loaded model doesn't support it. We rely on the system prompt to
        // request strict JSON instead.
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`llama.cpp ${res.status}: ${txt.slice(0, 240)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("llama.cpp returned no content");
    return content;
  }

  async generateStream(
    req: AIGenerationRequest,
    onToken: (chunk: string) => void
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      signal: withTimeoutSignal(req.signal, req.timeoutMs),
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.4,
        max_tokens: req.maxTokens ?? 2400,
        stream: true,
        // See note above re: response_format json_object.
      }),
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
  }
}

function isStreamAbortError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  return /aborted|BodyStreamBuffer/i.test(`${name} ${message}`);
}
