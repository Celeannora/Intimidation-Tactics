import { describe, expect, it } from "vitest";
import {
  OFFLINE_GENERATOR_STAGE_ORDER,
  assertOfflineStageOrder,
  type OfflineGeneratorStageId,
} from "../pipeline";

describe("offline generator pipeline contracts", () => {
  it("documents the intended stage order for future refactors", () => {
    expect(OFFLINE_GENERATOR_STAGE_ORDER).toEqual([
      "pool-builder",
      "role-fill",
      "mana-base",
      "optimizer",
      "sideboard",
      "result-assembly",
    ]);
  });

  it("rejects accidental stage reordering", () => {
    const invalidOrder: OfflineGeneratorStageId[] = [
      "pool-builder",
      "mana-base",
      "role-fill",
      "optimizer",
      "sideboard",
      "result-assembly",
    ];

    expect(() => assertOfflineStageOrder(invalidOrder)).toThrow(/must run in order/);
  });
});