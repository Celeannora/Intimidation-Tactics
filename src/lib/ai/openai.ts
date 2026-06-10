import type { AIProvider, AIGenerationRequest, AISettings } from "./provider";
import { withTimeoutSignal } from "./provider";

export class OpenAIProvider implements AIProvider {
  readonly id = "openai";
  readonly label = "OpenAI";
  private apiKey: string;
  private model: string;

  constructor(settings: AISettings) {
    this.apiKey = settings.openaiApiKey ?? "";
    this.model = settings.openaiModel ?? "gpt-4o-mini";
  }

  async isReady(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async generate(req: AIGenerationRequest): Promise<string> {
    if (!this.apiKey) throw new Error("OpenAI API key not set.");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: withTimeoutSignal(req.signal, req.timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.4,
        max_tokens: req.maxTokens ?? 2400,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 240)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("OpenAI returned no content");
    }
    return content;
  }

  async generateStream(
    req: AIGenerationRequest,
    onToken: (chunk: string) => void
  ): Promise<string> {
    if (!this.apiKey) throw new Error("OpenAI API key not set.");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: withTimeoutSignal(req.signal, req.timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.4,
        max_tokens: req.maxTokens ?? 2400,
        response_format: { type: "json_object" },
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      const txt = res.body ? await res.text() : "";
      throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 240)}`);
    }
    return await readOpenAISSE(res.body, onToken);
  }
}

export async function readOpenAISSE(
  body: ReadableStream<Uint8Array>,
  onToken: (chunk: string) => void
): Promise<string> {
  const reader = body.getReader();
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
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return full;
      try {
        const obj = JSON.parse(payload);
        const delta = obj?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          full += delta;
          onToken(delta);
        }
      } catch {
        /* ignore partial */
      }
    }
  }
  return full;
}
