import type { AIProvider, AIGenerationRequest, AISettings } from "./provider";
import { withTimeoutSignal } from "./provider";
import { withRetry } from "./retry";

export class OllamaProvider implements AIProvider {
  readonly id = "ollama";
  readonly label = "Ollama (local)";
  private baseUrl: string;
  private model: string;
  private defaultMaxTokens?: number;
  private defaultTimeoutMs?: number;

  constructor(settings: AISettings) {
    this.baseUrl = (settings.ollamaBaseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
    this.model = settings.ollamaModel ?? "llama3.1:8b";
    this.defaultMaxTokens = settings.maxTokens;
    this.defaultTimeoutMs = settings.requestTimeoutMs;
  }

  private numPredict(req: AIGenerationRequest): number {
    return req.maxTokens ?? this.defaultMaxTokens ?? 2400;
  }

  async isReady(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Ollama structured outputs: when a JSON schema is provided, pass it directly
   * as `format` so the model is constrained to the deck shape. Otherwise fall
   * back to the generic `"json"` format string.
   */
  private formatValue(req: AIGenerationRequest): unknown {
    return req.jsonSchema ? req.jsonSchema.schema : "json";
  }

  async generate(req: AIGenerationRequest): Promise<string> {
    return withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        signal: withTimeoutSignal(req.signal, req.timeoutMs ?? this.defaultTimeoutMs),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: req.messages,
          stream: false,
          format: this.formatValue(req),
          options: { temperature: req.temperature ?? 0.4, num_predict: this.numPredict(req) },
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Ollama ${res.status}: ${txt.slice(0, 240)}`);
      }
      const data = await res.json();
      const content = data?.message?.content;
      if (typeof content !== "string") throw new Error("Ollama returned no content");
      return content;
    }, req.retry);
  }

  async generateStream(
    req: AIGenerationRequest,
    onToken: (chunk: string) => void
  ): Promise<string> {
    return withRetry(() => this.streamOnce(req, onToken), req.retry);
  }

  private async streamOnce(
    req: AIGenerationRequest,
    onToken: (chunk: string) => void
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      signal: withTimeoutSignal(req.signal, req.timeoutMs ?? this.defaultTimeoutMs),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        stream: true,
        format: this.formatValue(req),
        options: { temperature: req.temperature ?? 0.4, num_predict: this.numPredict(req) },
      }),
    });
    if (!res.ok || !res.body) {
      const txt = res.body ? await res.text() : "";
      throw new Error(`Ollama ${res.status}: ${txt.slice(0, 240)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          const chunk = obj?.message?.content;
          if (typeof chunk === "string" && chunk.length > 0) {
            full += chunk;
            onToken(chunk);
          }
        } catch {
          /* ignore partial */
        }
      }
    }
    return full;
  }
}


