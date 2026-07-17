import type { CardRecord } from "./types";

export type ConstructedFormat =
  | "standard"
  | "alchemy"
  | "explorer"
  | "pioneer"
  | "modern"
  | "historic"
  | "timeless"
  | "legacy"
  | "vintage"
  | "commander"
  | "brawl"
  | "historicbrawl"
  | "pauper";

export type PlayEnvironment = "bo1" | "bo3" | "casual";

export interface CommanderZoneSlotSpec {
  role: "commander" | "oathbreaker" | "signatureSpell";
  allowedTypeLineContains: string[];
  countsTowardMainboard: boolean;
}

export interface FormatRules {
  id: ConstructedFormat;
  label: string;
  scryfallLegalityKey: string;
  defaultMainboardSize: number;
  minMainboardSize: number;
  maxMainboardSize: number;
  sideboardSize: number | null;
  maxCopies: number;
  singleton: boolean;
  usesCommander: boolean;

  // NEW — additive, optional fields. Existing rows (incl. Standard) leave these
  // undefined and behave identically; only Commander-family and Vintage rows
  // populate them today. See multi-format expansion plan Section 2.
  commanderZoneSlots?: CommanderZoneSlotSpec[];
  colorIdentitySource?: "none" | "commanderZone";
  restrictedListAware?: boolean;
  startingLife?: number;
}

const COMMANDER_ZONE_SLOTS: CommanderZoneSlotSpec[] = [
  {
    role: "commander",
    allowedTypeLineContains: [
      "Legendary Creature",
      "Legendary Planeswalker",
      "Legendary Vehicle",
      "Legendary Spacecraft",
    ],
    // Commander's 100-card deck size includes the commander itself.
    countsTowardMainboard: true,
  },
];

export const FORMAT_RULES: Record<ConstructedFormat, FormatRules> = {
  standard:      { id: "standard",      label: "Standard",        scryfallLegalityKey: "standard",      defaultMainboardSize: 60, minMainboardSize: 60, maxMainboardSize: 80,  sideboardSize: 15, maxCopies: 4, singleton: false, usesCommander: false },
  alchemy:       { id: "alchemy",       label: "Alchemy",         scryfallLegalityKey: "alchemy",       defaultMainboardSize: 60, minMainboardSize: 60, maxMainboardSize: 80,  sideboardSize: 15, maxCopies: 4, singleton: false, usesCommander: false },
  explorer:      { id: "explorer",      label: "Explorer",        scryfallLegalityKey: "explorer",      defaultMainboardSize: 60, minMainboardSize: 60, maxMainboardSize: 80,  sideboardSize: 15, maxCopies: 4, singleton: false, usesCommander: false },
  pioneer:       { id: "pioneer",       label: "Pioneer",         scryfallLegalityKey: "pioneer",       defaultMainboardSize: 60, minMainboardSize: 60, maxMainboardSize: 80,  sideboardSize: 15, maxCopies: 4, singleton: false, usesCommander: false },
  modern:        { id: "modern",        label: "Modern",          scryfallLegalityKey: "modern",        defaultMainboardSize: 60, minMainboardSize: 60, maxMainboardSize: 80,  sideboardSize: 15, maxCopies: 4, singleton: false, usesCommander: false },
  historic:      { id: "historic",      label: "Historic",        scryfallLegalityKey: "historic",      defaultMainboardSize: 60, minMainboardSize: 60, maxMainboardSize: 80,  sideboardSize: 15, maxCopies: 4, singleton: false, usesCommander: false },
  timeless:      { id: "timeless",      label: "Timeless",        scryfallLegalityKey: "timeless",      defaultMainboardSize: 60, minMainboardSize: 60, maxMainboardSize: 80,  sideboardSize: 15, maxCopies: 4, singleton: false, usesCommander: false },
  legacy:        { id: "legacy",        label: "Legacy",          scryfallLegalityKey: "legacy",        defaultMainboardSize: 60, minMainboardSize: 60, maxMainboardSize: 80,  sideboardSize: 15, maxCopies: 4, singleton: false, usesCommander: false },
  vintage:       { id: "vintage",       label: "Vintage",         scryfallLegalityKey: "vintage",       defaultMainboardSize: 60, minMainboardSize: 60, maxMainboardSize: 80,  sideboardSize: 15, maxCopies: 4, singleton: false, usesCommander: false, restrictedListAware: true },
  commander:     { id: "commander",     label: "Commander",       scryfallLegalityKey: "commander",     defaultMainboardSize: 100, minMainboardSize: 100, maxMainboardSize: 100, sideboardSize: null, maxCopies: 1, singleton: true,  usesCommander: true, colorIdentitySource: "commanderZone", commanderZoneSlots: COMMANDER_ZONE_SLOTS },
  brawl:         { id: "brawl",         label: "Brawl",           scryfallLegalityKey: "brawl",         defaultMainboardSize: 60, minMainboardSize: 60, maxMainboardSize: 60,  sideboardSize: null, maxCopies: 1, singleton: true,  usesCommander: true, colorIdentitySource: "commanderZone", commanderZoneSlots: COMMANDER_ZONE_SLOTS },
  historicbrawl: { id: "historicbrawl", label: "Historic Brawl",  scryfallLegalityKey: "historicbrawl", defaultMainboardSize: 100, minMainboardSize: 100, maxMainboardSize: 100, sideboardSize: null, maxCopies: 1, singleton: true,  usesCommander: true, colorIdentitySource: "commanderZone", commanderZoneSlots: COMMANDER_ZONE_SLOTS },
  pauper:        { id: "pauper",        label: "Pauper",          scryfallLegalityKey: "pauper",        defaultMainboardSize: 60, minMainboardSize: 60, maxMainboardSize: 80,  sideboardSize: 15, maxCopies: 4, singleton: false, usesCommander: false },
};

export const CONSTRUCTED_FORMATS = Object.values(FORMAT_RULES);

export function getFormatRules(format: ConstructedFormat | undefined): FormatRules {
  return FORMAT_RULES[format ?? "standard"];
}

export function parseLegalities(card: CardRecord): Record<string, string | undefined> {
  if (card.legalitiesJson) {
    try {
      const parsed = JSON.parse(card.legalitiesJson) as Record<string, string | undefined>;
      return parsed;
    } catch {
      /* fall through to legacy fields */
    }
  }
  return {
    standard: card.legalityStandard ?? undefined,
    future: card.legalityFuture ?? undefined,
  };
}

export function getCardLegality(card: CardRecord, format: ConstructedFormat | undefined): string | undefined {
  const rules = getFormatRules(format);
  return parseLegalities(card)[rules.scryfallLegalityKey];
}

export function isCardLegalInFormat(card: CardRecord, format: ConstructedFormat | undefined): boolean {
  return getCardLegality(card, format) === "legal";
}