/**
 * synergyConstraints.ts — Synergy pair hard constraints
 *
 * Implements sonar.md Part 5 — Synergy Pair Constraints.
 *
 * A SynergyPairConstraint declares that, for a deck playing a given archetype,
 * if it includes any payoff card from `payoffPatterns`, it MUST also include
 * a minimum number of source cards matching `sourcePatterns`.
 *
 * `validateSynergyPairs` returns SynergyViolation objects for any unmet
 * constraint so the generator/UI can surface actionable warnings.
 */

import type { DeckEntry } from "../legality";
import type { Archetype } from "../archetype";
import type { SynergyPairConstraint, SynergyViolation } from "./types";

// ── Constraint definitions ────────────────────────────────────────────────────

export const SYNERGY_PAIR_CONSTRAINTS: SynergyPairConstraint[] = [
  // ── Sacrifice / Aristocrats ────────────────────────────────────────────────
  {
    id: "sacrifice-outlets",
    description: "Sacrifice payoffs require sacrifice outlets",
    archetypes: ["Midrange", "Combo", "Unknown"],
    payoffPatterns: [
      /whenever .{0,80}(?:a creature|a permanent) is put into a graveyard/i,
      /whenever .{0,80} sacrifice/i,
      /blood artist|zulaport cutthroat|mayhem devil|cruel celebrant/i,
    ],
    sourcePatterns: [
      /sacrifice (?:a|an|another) (?:creature|permanent|artifact)[^,.]*:/i,
      /\{[0-9WUBRG]\}: sacrifice/i,
      /altar|skullclamp|ashnod|phyrexian altar/i,
    ],
    minSources: 4,
  },

  // ── Graveyard / Reanimator ─────────────────────────────────────────────────
  {
    id: "reanimator-enablers",
    description: "Reanimation payoffs require graveyard enablers",
    archetypes: ["Midrange", "Combo", "Unknown"],
    payoffPatterns: [
      /return .* from (your|a) graveyard to (the battlefield|your hand)/i,
      /reanimate|unearth|encore|encore cost|disturb/i,
      /\{[0-9WUBRG]+\}: return this card from your graveyard/i,
    ],
    sourcePatterns: [
      /discard (a|one|two)|put .* into (your|a) graveyard from (your|a) library/i,
      /mill \d+|surveil \d+|\bself.?mill\b/i,
      /\byou may discard|dredge|flashback enables|\bloot\b|\brummage\b/i,
    ],
    minSources: 6,
  },

  // ── Tokens / Go-Wide ───────────────────────────────────────────────────────
  {
    id: "token-payoffs",
    description: "Token payoffs require token generators",
    archetypes: ["Aggro", "Midrange", "Unknown"],
    payoffPatterns: [
      /creatures you control get \+/i,
      /for each (creature|token) you control/i,
      /intangible virtue|glorious anthem|anthem effect/i,
      /whenever a creature (token )?(enters|attacks|dies)/i,
    ],
    sourcePatterns: [
      /create .* (1\/1|2\/2|soldier|goblin|knight|bird|spirit) (creature )?token/i,
      /populate|convoke|\btoken\b/i,
    ],
    minSources: 8,
  },

  // ── +1/+1 Counters ─────────────────────────────────────────────────────────
  {
    id: "counter-payoffs",
    description: "+1/+1 counter payoffs require counter producers",
    archetypes: ["Midrange", "Unknown"],
    payoffPatterns: [
      /whenever .* \+1\/\+1 counter (is put|enters)/i,
      /if .* has? a \+1\/\+1 counter/i,
      /\bevolve\b|\bproliferate\b when|modular payoff/i,
    ],
    sourcePatterns: [
      /put .* \+1\/\+1 counter/i,
      /\bproliferate\b|\badapt\b|\bevolve\b|\bmodular\b/i,
      /\bboost\b|\bcounters? on (it|them)\b/i,
    ],
    minSources: 6,
  },

  // ── Spellslinger / Magecraft ───────────────────────────────────────────────
  {
    id: "spellslinger-density",
    description: "Spellslinger payoffs need a high density of instants/sorceries",
    archetypes: ["Tempo", "Combo", "Unknown"],
    payoffPatterns: [
      /whenever you cast an instant or sorcery/i,
      /\bprowess\b|magecraft|whenever you cast a (noncreature )?spell/i,
      /replicate|storm count|each instant and sorcery/i,
    ],
    sourcePatterns: [
      // Any instant or sorcery counts as a source
      /instant|sorcery/i,
    ],
    minSources: 12,
  },

  // ── Lifegain payoffs ───────────────────────────────────────────────────────
  {
    id: "lifegain-sources",
    description: "Lifegain payoffs require reliable lifegain sources",
    archetypes: ["Midrange", "Control", "Unknown"],
    payoffPatterns: [
      /whenever you gain life/i,
      /celestial unicorn|ajani's pridemate|speaker of the heavens|heliod/i,
    ],
    sourcePatterns: [
      /\bgain \d+ life\b|\blifelink\b/i,
      /you gain life equal|life total (becomes|goes)/i,
    ],
    minSources: 6,
  },

  // ── Combo / Tutor chains ───────────────────────────────────────────────────
  {
    id: "combo-enablers",
    description: "Combo payoffs need tutors or card selection to assemble",
    archetypes: ["Combo"],
    payoffPatterns: [
      /\bwin the game\b|\byou (win|lose) the game\b/i,
      /infinite (mana|loop|damage|life|tokens)/i,
      /when .* deals? combat damage .* to a player.*draw your library/i,
    ],
    sourcePatterns: [
      /search your library for/i,
      /draw .* card|scry \d+|surveil \d+/i,
    ],
    minSources: 6,
  },
];

// ── Validator ─────────────────────────────────────────────────────────────────

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Validate synergy pair constraints for a generated deck.
 *
 * Returns a list of violations — constraints where payoff cards are present
 * but the required minimum number of source cards is not met.
 *
 * The caller (generator or UI) decides how to surface these.
 */
export function validateSynergyPairs(
  entries: DeckEntry[],
  archetype: Archetype,
): SynergyViolation[] {
  const violations: SynergyViolation[] = [];

  const nonlands = entries.filter(
    (e) => e.board === "main" && !e.card.typeLine.includes("Land"),
  );

  for (const constraint of SYNERGY_PAIR_CONSTRAINTS) {
    // Skip if this constraint doesn't apply to the archetype
    if (!constraint.archetypes?.includes(archetype)) continue;

    // Count payoff cards
    let payoffCount = 0;
    const payoffNames: string[] = [];
    for (const entry of nonlands) {
      const text = [entry.card.oracleText ?? "", entry.card.typeLine, entry.card.keywordsJson ?? ""].join(" ");
      if (matchesAnyPattern(text, constraint.payoffPatterns)) {
        payoffCount += entry.quantity;
        payoffNames.push(entry.card.name);
      }
    }

    // No payoffs = no violation
    if (payoffCount === 0) continue;

    // Count source cards
    let sourceCount = 0;
    for (const entry of nonlands) {
      const text = [entry.card.oracleText ?? "", entry.card.typeLine].join(" ");
      if (matchesAnyPattern(text, constraint.sourcePatterns)) {
        sourceCount += entry.quantity;
      }
    }

    if (sourceCount < constraint.minSources) {
      violations.push({
        constraintId: constraint.id,
        description: constraint.description,
        payoffCards: payoffNames.slice(0, 5), // top 5 for display
        sourceCount,
        requiredSources: constraint.minSources,
        severity: sourceCount === 0 ? "error" : "warning",
      });
    }
  }

  return violations;
}
