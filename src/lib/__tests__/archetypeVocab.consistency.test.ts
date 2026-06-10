import { describe, expect, it } from "vitest";
import {
  MACRO_IDS,
  MACRO_LABELS,
  MACRO_ID_TO_LABEL,
  MACRO_LABEL_TO_ID,
  MACRO_ARCHETYPES,
  THEME_IDS,
  THEMES,
  THEME_ID_TO_LABEL,
  isThemeId,
  isMacroId,
  type ThemeId,
} from "../archetypeVocab";
import type { MechanicAxis } from "../generator/synergyModel";
import { ARCHETYPE_BENCHMARKS } from "../archetype";
import { ROLE_TARGETS } from "../generator/roleTargets";

/**
 * Vocabulary-consistency guard (Wave 1).
 *
 * Asserts the single canonical taxonomy in archetypeVocab.ts stays in lock-step
 * with every downstream consumer: the synergy model's MechanicAxis union, and
 * the exhaustive Record<Archetype, …> tables in the generator/scoring layers.
 * If anyone re-introduces a divergent vocabulary, one of these fails.
 */
describe("archetype vocabulary consistency", () => {
  it("every ThemeId is a MechanicAxis (compile + runtime subset)", () => {
    // Compile-time: assigning each ThemeId to a MechanicAxis fails typecheck if
    // THEME_IDS ever drifts out of the MechanicAxis union.
    const asAxes: MechanicAxis[] = [...THEME_IDS];
    expect(asAxes.length).toBe(THEME_IDS.length);

    // The three internal-only axes (draw, etb, selfMill) must NOT be themes.
    const internalOnly: MechanicAxis[] = ["draw", "etb", "selfMill"];
    for (const axis of internalOnly) {
      expect(isThemeId(axis)).toBe(false);
    }
  });

  it("macro id/label maps round-trip and cover the same set", () => {
    expect(MACRO_IDS.length).toBe(MACRO_LABELS.length);
    for (const id of MACRO_IDS) {
      const label = MACRO_ID_TO_LABEL[id];
      expect(label).toBeDefined();
      expect(MACRO_LABEL_TO_ID[label]).toBe(id);
      expect(isMacroId(id)).toBe(true);
    }
    expect(MACRO_ARCHETYPES.map((m) => m.id).sort()).toEqual([...MACRO_IDS].sort());
  });

  it("THEMES metadata covers exactly THEME_IDS", () => {
    expect(THEMES.map((t) => t.id).sort()).toEqual([...THEME_IDS].sort());
    for (const id of THEME_IDS) {
      expect(THEME_ID_TO_LABEL[id]).toBeTruthy();
      expect(isThemeId(id)).toBe(true);
    }
  });

  it("ARCHETYPE_BENCHMARKS covers every macro label plus Unknown", () => {
    const keys = Object.keys(ARCHETYPE_BENCHMARKS).sort();
    expect(keys).toEqual([...MACRO_LABELS, "Unknown"].sort());
  });

  it("ROLE_TARGETS covers every macro label plus Unknown", () => {
    const keys = Object.keys(ROLE_TARGETS).sort();
    expect(keys).toEqual([...MACRO_LABELS, "Unknown"].sort());
  });

  it("no legacy macro values leak into the canonical vocabulary", () => {
    const legacy: string[] = ["Burn", "Tokens", "Graveyard", "Sacrifice"];
    for (const l of legacy) {
      expect(MACRO_LABELS as readonly string[]).not.toContain(l);
      // Legacy values may still be THEME labels' ids in lowercase, but never macros.
      expect(isMacroId(l.toLowerCase())).toBe(false);
    }
    // The lowercased legacy strategy words ARE valid themes (intentional).
    const asThemes: ThemeId[] = ["burn", "tokens", "graveyard", "sacrifice"];
    for (const t of asThemes) expect(isThemeId(t)).toBe(true);
  });
});
