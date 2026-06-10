import type { CardRecord } from "./types";

export interface CompanionCheckResult {
  companionName: string;
  satisfied: boolean;
  failureReason?: string;
}

type CompanionChecker = (mainboard: CardRecord[]) => CompanionCheckResult;

function allCardsHaveCmcCondition(
  mainboard: CardRecord[],
  companionName: string,
  predicate: (cmc: number) => boolean,
  reason: string
): CompanionCheckResult {
  const nonlands = mainboard.filter(c => !c.typeLine.includes("Land"));
  const failing = nonlands.filter(c => !predicate(c.cmc)).map(c => c.name);
  return {
    companionName,
    satisfied: failing.length === 0,
    failureReason: failing.length > 0
      ? `${reason}: ${failing.slice(0, 3).join(", ")}${failing.length > 3 ? ` (+${failing.length - 3} more)` : ""}`
      : undefined
  };
}

const COMPANION_CHECKERS: Map<string, CompanionChecker> = new Map([
  [
    "Yorion, Sky Nomad",
    (mainboard) => ({
      companionName: "Yorion, Sky Nomad",
      satisfied: mainboard.length >= 80,
      failureReason: mainboard.length < 80
        ? `Deck has ${mainboard.length} cards — Yorion requires 80+ card mainboard.`
        : undefined
    })
  ],
  [
    "Lurrus of the Dream-Den",
    (mainboard) =>
      allCardsHaveCmcCondition(
        mainboard, "Lurrus of the Dream-Den",
        cmc => cmc <= 2,
        "All non-land permanents must have CMC ≤ 2. Violators"
      )
  ],
  [
    "Kaheera, the Orphanguard",
    (mainboard) => {
      const VALID_TYPES = ["Cat", "Elemental", "Nightmare", "Dinosaur", "Beast"];
      const creatures = mainboard.filter(c => c.typeLine.includes("Creature"));
      const invalid = creatures
        .filter(c => !VALID_TYPES.some(t => c.typeLine.includes(t)))
        .map(c => c.name);
      return {
        companionName: "Kaheera, the Orphanguard",
        satisfied: invalid.length === 0,
        failureReason: invalid.length > 0
          ? `All creatures must be Cat, Elemental, Nightmare, Dinosaur, or Beast. Violators: ${invalid.slice(0, 3).join(", ")}`
          : undefined
      };
    }
  ],
  [
    "Obosh, the Preypiercer",
    (mainboard) =>
      allCardsHaveCmcCondition(
        mainboard, "Obosh, the Preypiercer",
        cmc => cmc % 2 === 1 || cmc === 0,
        "All non-land cards must have odd CMC. Violators"
      )
  ],
  [
    "Umori, the Collector",
    (mainboard) => {
      const nonlands = mainboard.filter(c => !c.typeLine.includes("Land"));
      const types = new Set(
        nonlands.map(c => {
          const tl = c.typeLine;
          if (tl.includes("Creature")) return "Creature";
          if (tl.includes("Instant")) return "Instant";
          if (tl.includes("Sorcery")) return "Sorcery";
          if (tl.includes("Enchantment")) return "Enchantment";
          if (tl.includes("Artifact")) return "Artifact";
          if (tl.includes("Planeswalker")) return "Planeswalker";
          return "Other";
        })
      );
      return {
        companionName: "Umori, the Collector",
        satisfied: types.size <= 1,
        failureReason: types.size > 1
          ? `All non-land cards must share a card type. Found types: ${[...types].join(", ")}`
          : undefined
      };
    }
  ],
  [
    "Gyruda, Doom of Depths",
    (mainboard) =>
      allCardsHaveCmcCondition(
        mainboard, "Gyruda, Doom of Depths",
        cmc => cmc % 2 === 0,
        "All cards must have even CMC. Violators"
      )
  ],
  [
    "Jegantha, the Wellspring",
    (mainboard) => {
      const violators = mainboard.filter(c => {
        if (!c.manaCost) return false;
        const symbols = c.manaCost.match(/\{[WUBRG]\}/g) ?? [];
        const seen = new Set<string>();
        for (const s of symbols) {
          if (seen.has(s)) return true;
          seen.add(s);
        }
        return false;
      }).map(c => c.name);
      return {
        companionName: "Jegantha, the Wellspring",
        satisfied: violators.length === 0,
        failureReason: violators.length > 0
          ? `No card may have repeated mana symbols. Violators: ${violators.slice(0, 3).join(", ")}`
          : undefined
      };
    }
  ],
  [
    "Zirda, the Dawnwaker",
    (mainboard) => {
      const permanents = mainboard.filter(c =>
        c.typeLine.includes("Creature") ||
        c.typeLine.includes("Enchantment") ||
        c.typeLine.includes("Artifact") ||
        c.typeLine.includes("Planeswalker") ||
        c.typeLine.includes("Battle")
      );
      const withoutAbility = permanents
        .filter(c => !c.oracleText?.toLowerCase().includes("{"))
        .map(c => c.name);
      return {
        companionName: "Zirda, the Dawnwaker",
        satisfied: withoutAbility.length === 0,
        failureReason: withoutAbility.length > 0
          ? `All permanents must have activated abilities. Possible violators: ${withoutAbility.slice(0, 3).join(", ")}`
          : undefined
      };
    }
  ]
]);

export function checkCompanionRestriction(
  sideboardCards: CardRecord[],
  mainboardCards: CardRecord[]
): CompanionCheckResult | null {
  for (const card of sideboardCards) {
    const checker = COMPANION_CHECKERS.get(card.name);
    if (checker) return checker(mainboardCards);
  }
  return null;
}
