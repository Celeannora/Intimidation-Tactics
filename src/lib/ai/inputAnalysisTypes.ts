import type { Archetype } from "../archetype";
import type { ThemeId } from "../archetypeVocab";
import type { ConstructedFormat } from "../formats";
import type { CardRecord, ManaColor } from "../types";
import type { GenerateOptions, SpeedProfile, SpellRatio } from "../generator/types";
import type { CurveTargets } from "../generator/compositionTypes";
import type { RoleTarget } from "../generator/roleTargets";

export interface InputAnalysisCard {
  card: CardRecord;
  quantity: number;
  required: boolean;
  /** Locked means mandatory at exactly this quantity; recommendations cannot unlock it. */
  quantityLocked: boolean;
}
export interface InputAnalysisRequest {
  inputs: InputAnalysisCard[];
  format: ConstructedFormat;
  mainboardSize: number;
  colors: ManaColor[];
  allowColorExpansion: boolean;
  maxCardPriceUsd?: number;
  totalBudgetUsd?: number;
  datasetVersion: string;
}
export interface CardCastingView {
  name: string;
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  oracleText: string | null;
}
export interface InputCardFacts extends CardCastingView {
  oracleId: string;
  quantity: number;
  required: boolean;
  quantityLocked: boolean;
  colorIdentity: ManaColor[];
  fullOracleText: string | null;
  faces: CardCastingView[];
  legalInFormat: boolean;
  priceUsd: number | null;
}
export type BlueprintRoleTargets = Pick<RoleTarget,
  "threats" | "removal" | "boardWipes" | "counterspells" | "cardDraw" | "ramp" | "enablers" | "payoffs">;
export interface InputCardBlueprint {
  schemaVersion: 1;
  title: string;
  strategy: string;
  rationale: string;
  archetype: Exclude<Archetype, "Unknown">;
  secondaryArchetypes: Exclude<Archetype, "Unknown">[];
  themes: ThemeId[];
  colors: ManaColor[];
  speed: SpeedProfile;
  spellRatio: SpellRatio;
  averageManaValue: number;
  landCountTarget: number;
  curveTargets: CurveTargets;
  roleTargets: BlueprintRoleTargets;
  inputs: { oracleId: string; role: string; recommendedQuantity: number; support: string[]; rationale: string }[];
  interactions: { oracleIds: string[]; explanation: string; conditions: string[] }[];
  alternatives: { title: string; tradeoffs: string }[];
  uncertainties: string[];
}
export interface InputAnalysisResult {
  requestKey: string;
  providerKey: string;
  blueprint: InputCardBlueprint;
  createdAt: number;
  fromCache: boolean;
}
export type InputBlueprintSettings = Partial<Pick<GenerateOptions,
  "archetype" | "secondaryArchetypes" | "themes" | "colors" | "speed" | "spellRatio" |
  "targetAverageManaValue" | "landCountTarget" | "curveTargets" | "roleTargetOverrides">>;
