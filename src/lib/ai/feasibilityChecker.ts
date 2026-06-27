/**
 * feasibilityChecker.ts — Pre-acceptance structural validation for LLM-proposed decks.
 *
 * Prevents "reward hacking" where the LLM proposes a deck that scores well by coincidence
 * but violates construction rules. Run before accepting any LLM-proposed card list.
 *
 * Hard violations (severity: "hard") cause the deck to be rejected and re-prompted.
 * Soft violations (severity: "soft") are logged as warnings but do not trigger re-prompting.
 *
 * Six hard constraints enforced per sonar.md TASK C spec:
 *  1. Land count between 20–27 (60-card deck)
 *  2. At least 3 total removal / interaction spells
 *  3. At least 6 total threat/payoff cards
 *  4. Color identity must include all colors needed by seed cards
 *  5. No more than 4 copies of any non-basic-land card
 *  6. All cards Standard-legal (legalityStandard === 'legal' and bannedInStandard !== true)
 */

import type { CardRecord, ManaColor } from "../types";
import { assignRoles, isThreat } from "../roles";
import { BASIC_LAND_NAMES } from "../legality";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FeasibilityViolation {
  rule: string;
  detail: string;
  severity: "hard" | "soft";
}

export interface FeasibilityResult {
  violations: FeasibilityViolation[];
  /** True only when no hard violations are present. */
  isAcceptable: boolean;
  /** Summary string suitable for injecting into a re-prompt. */
  rejectionSummary?: string;
}

/** A proposed card with its quantity. */
export interface ProposedEntry {
  card: CardRecord;
  quantity: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_LANDS = 20;
const MAX_LANDS = 27;
const MIN_REMOVAL = 3;
const MIN_THREATS = 6;
const MAX_COPIES_NON_BASIC = 4;
const STANDARD_LEGAL_STATUS = "legal";

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Check a proposed deck for structural feasibility violations.
 *
 * @param proposedEntries - Array of {card, quantity} pairs the LLM proposed.
 * @param seedCards - The seed cards the user originally specified (used for color-identity check).
 * @returns A FeasibilityResult with all violations found.
 *
 * @example
 * ```typescript
 * const result = checkFeasibility(proposedEntries, seedCards);
 * if (!result.isAcceptable) {
 *   const repromptContext = result.rejectionSummary;
 *   // ... build reprompt
 * }
 * ```
 */
export function checkFeasibility(
  proposedEntries: ProposedEntry[],
  seedCards: CardRecord[],
): FeasibilityResult {
  const violations: FeasibilityViolation[] = [];

  // ── Rule 1: Land count 20–27 ─────────────────────────────────────────────
  const landEntries = proposedEntries.filter((e) => e.card.typeLine.includes("Land"));
  const landCount = landEntries.reduce((sum, e) => sum + e.quantity, 0);
  if (landCount < MIN_LANDS) {
    violations.push({
      rule: "land-count-minimum",
      detail: `Deck has only ${landCount} land(s) — minimum is ${MIN_LANDS}. Add ${MIN_LANDS - landCount} more land(s).`,
      severity: "hard",
    });
  } else if (landCount > MAX_LANDS) {
    violations.push({
      rule: "land-count-maximum",
      detail: `Deck has ${landCount} land(s) — maximum is ${MAX_LANDS}. Remove ${landCount - MAX_LANDS} land(s).`,
      severity: "hard",
    });
  }

  // ── Rule 2: At least MIN_REMOVAL removal / interaction spells ────────────
  const removalCount = proposedEntries
    .filter((e) => !e.card.typeLine.includes("Land"))
    .reduce((sum, e) => {
      const roles = assignRoles(e.card);
      return roles.includes("Removal") || roles.includes("Counterspell") || roles.includes("BoardWipe")
        ? sum + e.quantity
        : sum;
    }, 0);
  if (removalCount < MIN_REMOVAL) {
    violations.push({
      rule: "removal-minimum",
      detail: `Deck has only ${removalCount} removal/interaction spell(s) — minimum is ${MIN_REMOVAL}. Add interaction spells (removal, counterspells, or board wipes).`,
      severity: "hard",
    });
  }

  // ── Rule 3: At least MIN_THREATS threat/payoff cards ─────────────────────
  const threatCount = proposedEntries
    .filter((e) => !e.card.typeLine.includes("Land"))
    .reduce((sum, e) => {
      const roles = assignRoles(e.card);
      return isThreat(roles) ? sum + e.quantity : sum;
    }, 0);
  if (threatCount < MIN_THREATS) {
    violations.push({
      rule: "threats-minimum",
      detail: `Deck has only ${threatCount} threat/payoff card(s) — minimum is ${MIN_THREATS}. Add creatures or win conditions.`,
      severity: "hard",
    });
  }

  // ── Rule 4: Color identity covers all seed card requirements ─────────────
  const deckColorIdentity = new Set<ManaColor>(
    proposedEntries.flatMap((e) => parseColorIdentity(e.card))
  );
  const seedColorViolations: string[] = [];
  for (const seed of seedCards) {
    const seedColors = parseColorIdentity(seed);
    const missing = seedColors.filter((c) => !deckColorIdentity.has(c));
    if (missing.length > 0) {
      seedColorViolations.push(
        `"${seed.name}" requires {${missing.join("}{")}} but deck has no ${missing.join("/")} sources`
      );
    }
  }
  if (seedColorViolations.length > 0) {
    violations.push({
      rule: "seed-color-identity",
      detail: `Color identity mismatch: ${seedColorViolations.join("; ")}.`,
      severity: "hard",
    });
  }

  // ── Rule 5: No more than 4 copies of any non-basic-land card ─────────────
  const copyCountByOracle = new Map<string, { name: string; count: number }>();
  for (const entry of proposedEntries) {
    if (!entry.card.typeLine.includes("Land") || !BASIC_LAND_NAMES.has(entry.card.name)) {
      const existing = copyCountByOracle.get(entry.card.oracleId);
      if (existing) {
        existing.count += entry.quantity;
      } else {
        copyCountByOracle.set(entry.card.oracleId, { name: entry.card.name, count: entry.quantity });
      }
    }
  }
  for (const { name, count } of copyCountByOracle.values()) {
    if (count > MAX_COPIES_NON_BASIC) {
      violations.push({
        rule: "max-copies",
        detail: `"${name}" appears ${count} time(s) — maximum is ${MAX_COPIES_NON_BASIC} copies of any non-basic-land card.`,
        severity: "hard",
      });
    }
  }

  // ── Rule 6: All cards Standard-legal ─────────────────────────────────────
  const illegalCards: string[] = [];
  for (const entry of proposedEntries) {
    const card = entry.card;
    const isLegal =
      card.legalityStandard === STANDARD_LEGAL_STATUS &&
      !card.bannedInStandard;
    if (!isLegal) {
      illegalCards.push(
        `"${card.name}" (legalityStandard=${card.legalityStandard ?? "unknown"}, banned=${!!card.bannedInStandard})`
      );
    }
  }
  if (illegalCards.length > 0) {
    violations.push({
      rule: "standard-legality",
      detail: `${illegalCards.length} card(s) are not Standard-legal: ${illegalCards.slice(0, 5).join(", ")}${illegalCards.length > 5 ? ` ... and ${illegalCards.length - 5} more` : ""}. Replace them with legal alternatives.`,
      severity: "hard",
    });
  }

  // ── Soft check: total card count ─────────────────────────────────────────
  const totalCards = proposedEntries.reduce((sum, e) => sum + e.quantity, 0);
  if (totalCards !== 60) {
    violations.push({
      rule: "deck-size",
      detail: `Deck has ${totalCards} card(s) — expected exactly 60. ${totalCards < 60 ? "Add" : "Remove"} ${Math.abs(60 - totalCards)} card(s).`,
      severity: totalCards < 55 || totalCards > 65 ? "hard" : "soft",
    });
  }

  const hardViolations = violations.filter((v) => v.severity === "hard");
  const isAcceptable = hardViolations.length === 0;

  let rejectionSummary: string | undefined;
  if (!isAcceptable) {
    rejectionSummary = buildRejectionSummary(hardViolations);
  }

  return { violations, isAcceptable, rejectionSummary };
}

// ── Helper: build re-prompt rejection text ────────────────────────────────────

function buildRejectionSummary(hardViolations: FeasibilityViolation[]): string {
  const lines = [
    "⚠️ DECK REJECTED — The proposed deck violates these construction rules:",
    ...hardViolations.map((v, i) => `  ${i + 1}. [${v.rule}] ${v.detail}`),
    "",
    "Please revise the deck to fix all of the above issues before re-submitting.",
    "Rules reminder: 20–27 lands, ≥3 interaction spells, ≥6 threats, no color-identity issues,",
    "max 4 copies of any non-basic-land card, all cards must be Standard-legal.",
  ];
  return lines.join("\n");
}

// ── Helper: parse color identity from a CardRecord ───────────────────────────

function parseColorIdentity(card: CardRecord): ManaColor[] {
  try {
    return JSON.parse(card.colorIdentityJson) as ManaColor[];
  } catch {
    return [];
  }
}
