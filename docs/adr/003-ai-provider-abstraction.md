# ADR-003: AI Provider Abstraction Layer

**Status:** Accepted  
**Date:** 2026-06-15  
**Deciders:** Core team

---

## Context and Problem Statement

The deck builder uses LLM-assisted generation to propose cards from natural-language seed descriptions. Multiple AI backends exist and users may want to switch between them based on privacy preferences, hardware, or budget:

- **OpenAI API** — cloud, paid, highest quality
- **Ollama** — local HTTP server, free, model-dependent quality
- **llama.cpp** — embedded local inference, fully air-gapped

Additionally, AI output must be sanitised against the actual card pool before being presented to the user — LLMs hallucinate card names, propose illegal cards, or violate format rules.

How should the AI integration be structured to support multiple backends and safe output validation?

---

## Decision Drivers

- Swap backends (OpenAI → Ollama → llama.cpp) with zero changes to deck generation logic
- Validate all AI proposals against authoritative card pool data before acceptance
- Graceful degradation: if all AI passes fail, fall back to the offline generator
- Provider configuration (API keys, base URL, model name) stored in user preferences, not in code
- Testable: mock providers in unit tests without network calls

---

## Considered Options

### Option A: AIProvider interface + provider implementations ✓ chosen

### Option B: Direct fetch calls to OpenAI in deck generator

### Option C: External backend microservice that normalises AI responses

---

## Decision Outcome

**Chosen option: AIProvider interface abstraction**

The deck generator (`src/lib/ai/aiGenerator.ts`) depends on an `AIProvider` interface, not on any specific AI SDK. Concrete providers implement this interface and are injected at call time.

### AIProvider Interface

```ts
interface AIProvider {
  complete(prompt: string, options: AICompleteOptions): Promise<string>;
}
```

Each provider (OpenAI, Ollama, llama.cpp) implements `complete()` with the same contract. The generator builds the prompt, calls `provider.complete()`, then parses and validates the result — entirely independent of which backend answered.

### Validation Layer

`validateAIProposal` (exported from `aiGenerator.ts`, ~65 lines) runs after every AI response before the deck is accepted:

```ts
export function validateAIProposal(
  lines: string[],
  resolvedCards: Map<string, CardRecord>,
  pool: CardRecord[],
): AIProposalValidationResult
```

Checks performed:
1. **Unresolved card names** — card name not found in `resolveLines()` result
2. **Out-of-pool cards** — resolved but not in the provided card pool
3. **Illegal cards** — `legalityStandard !== "legal"` (or banned)
4. `MAINBOARD_LAND_IGNORED` — AI placed a basic land in mainboard slot (handled separately)
5. `QUANTITY_CLAMPED` — AI requested more than the legal max copies
6. `FINAL_DECK_VIOLATION` — resulting deck doesn't meet format requirements

### Offline Fallback

If all AI provider attempts raise, `generateOffline()` runs automatically (line 369 of `aiGenerator.ts`). This guarantees deck generation always completes, even with no AI configured.

---

## Consequences

### Positive

- Adding a new provider (e.g. Anthropic Claude, Google Gemini) requires only implementing `AIProvider` — zero changes to generation logic
- `validateAIProposal` is pure and synchronous — 100% testable without a live LLM
- Offline fallback means the feature never hard-fails; users without API keys still get decks
- Mock providers in tests are trivial: `{ complete: async () => mockJsonString }`

### Negative

- Each provider implementation must handle its own authentication, retry logic, and streaming normalisation
- The interface is deliberately narrow — providers that support structured output (function calling, JSON mode) need to normalise to the same string format before returning

### Neutral

- The raw LLM output string is parsed by `salvageDeckJSON` which applies heuristic repair to malformed JSON — this is a separate concern from provider selection

---

## Validation Issue Types

| Code | Meaning | Severity |
|------|---------|----------|
| `UNRESOLVED_CARD` | Card name not in card database | Error |
| `OUT_OF_POOL` | Card not in provided generation pool | Error |
| `NOT_LEGAL` | Card not legal in the target format | Error |
| `MAINBOARD_LAND_IGNORED` | Basic land in AI mainboard proposal | Warning |
| `QUANTITY_CLAMPED` | AI requested illegal copy count | Warning |
| `FINAL_DECK_VIOLATION` | Output deck violates format rules | Error |

Proposals with any Error-severity issue are rejected and trigger either a retry or the offline fallback.

---

## Pros and Cons of Rejected Options

### Option B — Direct fetch calls in generator

- ✓ Simplest initial implementation
- ✗ Couples generation logic to a single provider — swapping backends requires rewrites
- ✗ Cannot be unit-tested without network interception (msw or similar)
- ✗ No clean separation between "call AI" and "validate AI output"

### Option C — External normalisation microservice

- ✓ Provider details fully hidden from the client
- ✗ Requires deploying and maintaining a server
- ✗ Violates the offline-first requirement — if the microservice is down, generation fails
- ✗ Adds network latency to every generation request

---

## More Information

- Implementation: `src/lib/ai/aiGenerator.ts` (lines 683–748 for `validateAIProposal`)
- Tests: `src/lib/ai/__tests__/aiGenerator.test.ts`
- Related: [ADR-001](./001-offline-first-dexie.md) (offline-first constraint driving offline fallback)
