import type { AISettings } from "./provider";

function explainFetchError(e: unknown, label: string): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return new Error(
      `${label}: network/CORS blocked. If using LM Studio, open Developer → Server and enable "CORS" (and confirm the server is running on the URL/port above).`
    );
  }
  return new Error(`${label}: ${msg}`);
}

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/tags`;
  let res: Response;
  try { res = await fetch(url); } catch (e) { throw explainFetchError(e, "Ollama"); }
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = await res.json();
  const arr = Array.isArray(data?.models) ? data.models : [];
  return arr
    .map((m: { name?: string; model?: string }) => m.name ?? m.model ?? "")
    .filter((n: string) => n.length > 0)
    .sort();
}

export function normalizeOpenAIBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/api\/v0$/, "");
}

export async function listLlamaCppModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const root = normalizeOpenAIBase(baseUrl);
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  const candidates = [`${root}/v1/models`, `${root}/api/v0/models`];
  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) { lastErr = new Error(`${url} → HTTP ${res.status}`); continue; }
      const data = await res.json();
      const arr = Array.isArray(data?.data) ? data.data : [];
      const names = arr
        .map((m: { id?: string }) => m.id ?? "")
        .filter((n: string) => n.length > 0)
        .sort();
      if (names.length > 0) return names;
      lastErr = new Error(`${url} returned no models`);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr instanceof TypeError || (lastErr instanceof Error && /failed to fetch|networkerror|load failed/i.test(lastErr.message))) {
    throw explainFetchError(lastErr, "llama.cpp / LM Studio");
  }
  throw new Error(`llama.cpp / LM Studio: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export async function listOpenAIModels(apiKey: string): Promise<string[]> {
  if (!apiKey) throw new Error("OpenAI API key not set.");
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (e) {
    throw explainFetchError(e, "OpenAI");
  }
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  const arr = Array.isArray(data?.data) ? data.data : [];
  return arr
    .map((m: { id?: string }) => m.id ?? "")
    .filter((id: string) => id && /^(gpt|o\d|chatgpt)/i.test(id))
    .sort();
}

export async function listModelsFor(settings: AISettings): Promise<string[]> {
  switch (settings.providerId) {
    case "ollama":
      return listOllamaModels(settings.ollamaBaseUrl ?? "http://localhost:11434");
    case "llamacpp":
      return listLlamaCppModels(settings.llamaCppBaseUrl ?? "http://localhost:8080", settings.llamaCppApiKey);
    case "openai":
      return listOpenAIModels(settings.openaiApiKey ?? "");
    default:
      return [];
  }
}
