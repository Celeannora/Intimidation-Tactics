import { afterEach, describe, expect, it, vi } from "vitest";
import { generated, options } from "../../components/__tests__/generator.worker.fixtures";
import { card } from "../../store/__tests__/generated.fixtures";
import { generateDecks } from "../../lib/generator/generator";

vi.mock("../../lib/generator/generator", () => ({ generateDecks: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

describe("generator worker entry protocol", () => {
  it("echoes request identity on success and generator failure", async () => {
    const context = { onmessage: null as null | ((event: MessageEvent) => Promise<void>), postMessage: vi.fn() };
    vi.stubGlobal("self", context);
    await import("../generatorWorker");
    vi.mocked(generateDecks).mockReturnValue({ variants: [generated()], bestIndex: 0 });
    const data = { type: "generate", requestId: "request-1", options, allCards: [card()] };
    await context.onmessage?.({ data } as MessageEvent);
    expect(context.postMessage).toHaveBeenLastCalledWith({ type: "result", requestId: "request-1", payload: { variants: [generated()], bestIndex: 0 } });
    vi.mocked(generateDecks).mockImplementation(() => { throw new Error("broken"); });
    await context.onmessage?.({ data: { ...data, requestId: "request-2" } } as MessageEvent);
    expect(context.postMessage).toHaveBeenLastCalledWith({ type: "error", requestId: "request-2", message: "broken" });
  });
});
