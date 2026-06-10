import type { AIProvider, AIGenerationRequest, AISettings } from "./provider";
import { withTimeoutSignal } from "./provider";

export class OllamaProvider implements AIProvider {
  readonly id = "ollama";
  readonly label = "Ollama (local)";
  private baseUrl: string;
  private model: string;

  constructor(settings: AISettings) {
    this.baseUrl = (settings.ollamaBaseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
    this.model = settings.ollamaModel ?? "llama3.1:8b";
  }

  async isReady(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: AIGenerationRequest): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      signal: withTimeoutSignal(req.signal, req.timeoutMs),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        stream: false,
        format: "json",
        options: { temperature: req.temperature ?? 0.4, num_predict: req.maxTokens ?? 2400 },
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
  }

  async generateStream(
    req: AIGenerationRequest,
    onToken: (chunk: string) => void
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      signal: withTimeoutSignal(req.signal, req.timeoutMs),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        stream: true,
        format: "json",
        options: { temperature: req.temperature ?? 0.4, num_predict: req.maxTokens ?? 2400 },
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


