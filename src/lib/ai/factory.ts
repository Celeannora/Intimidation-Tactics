import type { AIProvider, AISettings } from "./provider";
import { OpenAIProvider } from "./openai";
import { OllamaProvider } from "./ollama";
import { LlamaCppProvider } from "./llamacpp";

export function makeProvider(settings: AISettings): AIProvider | null {
  switch (settings.providerId) {
    case "openai":
      return new OpenAIProvider(settings);
    case "ollama":
      return new OllamaProvider(settings);
    case "llamacpp":
      return new LlamaCppProvider(settings);
    case "none":
    default:
      return null;
  }
}
