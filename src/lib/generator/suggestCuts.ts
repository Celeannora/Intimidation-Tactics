import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import type { GenerateOptions } from "./types";
import { assignRoles, type CardRole } from "../roles";
import { cardScoreDetail, curveDeviation, targetAvgCmcFor } from "./weights";
import { blendRoleTargets } from "./roleTargets";

export interface CutCandidate {
  card: CardRecord;
  /** How many copies of this card to cut. */
  cut: number;
  /** Per-copy composite score (lower = weaker, better to cut). */
  perCopyScore: number;
  /** Primary role used for redundancy reasoning. */
  role: CardRole | "Other";
  /** How many copies of cards sharing this role remain after the cut (redundancy signal). */
  roleRedundancy: number;
  /** Human-readable rationale for the suggestion. */
  reason: string;
}

export interface SuggestCutsResult {
  /** Ranked cut suggestions, weakest/most-redundant first, totalling `slotsNeeded` copies. */
  candidates: CutCandidate[];
  /** Total copies the suggestions would remove. */
  totalCut: number;
  /** Curve deviation before applying the suggested cuts (lower = closer to ideal). */
  curveBefore: number;
  /** Projected curve deviation after applying the suggested cuts + the pinned additions. */
  curveAfter: number;
  /** curveAfter − curveBefore. Negative = curve improved. */
  curveDelta: number;
}

/** Lands and pinned cards are never cut. */
function isCuttable(entry: DeckEntry, pinnedIds: Set<string>): boolean {
  if (entry.board !== "main") return false;
  if (entry.card.typeLine.includes("Land")) return false;
  if (pinnedIds.has(entry.card.oracleId)) return false;
  return true;
}

function primaryRole(card: CardRecord): CardRole | "Other" {
  const roles = assignRoles(card);
  return roles[0] ?? "Other";
}

/**
 * Suggest which cards to cut to make room for `slotsNeeded` newly-pinned copies in
 * a deck that is already at or over its target size. Suggestions are surfaced to the
 * user rather than applied silently: we rank non-pinned, non-land mainboard cards by
 * a combination of weak individual score and role redundancy (so we prefer trimming
 * the 4th copy of an over-represented effect over a unique singleton), and report the
 * curve/consistency delta the cuts would produce.
 */
export function suggestCuts(
  entries: DeckEntry[],
  newlyPinned: DeckEntry[],
  slotsNeeded: number,
  options: GenerateOptions
): SuggestCutsResult {
  const target = blendRoleTargets(options.archetype, options.secondaryArchetypes);
  const targetAvgCmc = targetAvgCmcFor(options, target.maxAvgCmc);

  const pinnedIds = new Set(newlyPinned.map((e) => e.card.oracleId));

  // Count role representation across the current mainboard nonlands.
  const roleCounts = new Map<string, number>();
  for (const e of entries) {
    if (e.board !== "main" || e.card.typeLine.includes("Land")) continue;
    const r = primaryRole(e.card);
    roleCounts.set(r, (roleCounts.get(r) ?? 0) + e.quantity);
  }

  const cuttable = entries
    .filter((e) => isCuttable(e, pinnedIds))
    .map((e) => {
      const perCopyScore = cardScoreDetail(e.card, entries, options, targetAvgCmc).total;
      const role = primaryRole(e.card);
      const roleRedundancy = roleCounts.get(role) ?? e.quantity;
      return { entry: e, perCopyScore, role, roleRedundancy };
    })
    // Weakest + most redundant first: low score and high role redundancy are best cuts.
    .sort((a, b) => {
      // Strongly prefer cutting from over-represented roles.
      if (b.roleRedundancy !== a.roleRedundancy) return b.roleRedundancy - a.roleRedundancy;
      return a.perCopyScore - b.perCopyScore;
    });

  const candidates: CutCandidate[] = [];
  let remaining = slotsNeeded;
  for (const c of cuttable) {
    if (remaining <= 0) break;
    const cut = Math.min(c.entry.quantity, remaining);
    remaining -= cut;
    candidates.push({
      card: c.entry.card,
      cut,
      perCopyScore: c.perCopyScore,
      role: c.role,
      roleRedundancy: c.roleRedundancy,
      reason: buildReason(cut, c.role, c.roleRedundancy, c.perCopyScore),
    });
  }

  const totalCut = candidates.reduce((s, c) => s + c.cut, 0);

  const curveBefore = curveDeviation(entries, options.archetype);
  const projected = applyProjection(entries, candidates, newlyPinned);
  const curveAfter = curveDeviation(projected, options.archetype);

  return {
    candidates,
    totalCut,
    curveBefore,
    curveAfter,
    curveDelta: curveAfter - curveBefore,
  };
}

function buildReason(
  cut: number,
  role: CardRole | "Other",
  roleRedundancy: number,
  perCopyScore: number
): string {
  const copyWord = cut === 1 ? "copy" : "copies";
  if (roleRedundancy > 6) {
    return `Cut ${cut} ${copyWord}: ${role} is over-represented (${roleRedundancy} copies); this is among the weakest in that role (score ${perCopyScore.toFixed(1)}).`;
  }
  return `Cut ${cut} ${copyWord}: lowest-scoring ${role.toLowerCase()} card in the deck (score ${perCopyScore.toFixed(1)}).`;
}

/** Apply the suggested cuts and the pinned additions to produce the projected deck. */
function applyProjection(
  entries: DeckEntry[],
  candidates: CutCandidate[],
  newlyPinned: DeckEntry[]
): DeckEntry[] {
  const cutByOracle = new Map(candidates.map((c) => [c.card.oracleId, c.cut]));
  const projected: DeckEntry[] = [];
  for (const e of entries) {
    const cut = cutByOracle.get(e.card.oracleId) ?? 0;
    const qty = e.board === "main" ? e.quantity - cut : e.quantity;
    if (qty > 0) projected.push({ card: e.card, quantity: qty, board: e.board });
  }
  // Add the pinned cards that are not already in the projected mainboard.
  for (const p of newlyPinned) {
    const existing = projected.find((e) => e.card.oracleId === p.card.oracleId && e.board === "main");
    if (existing) existing.quantity += p.quantity;
    else projected.push({ card: p.card, quantity: p.quantity, board: "main" });
  }
  return projected;
}
