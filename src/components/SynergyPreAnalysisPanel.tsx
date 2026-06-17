/**
 * SynergyPreAnalysisPanel.tsx — Pre-AI synergy recommendations.
 *
 * Allows the user to select up to 5 "seed" cards from the current deck (or
 * search the DB for seeds directly), run a local oracle-text analysis, and
 * review a ranked list of synergy candidates — all before touching the AI
 * deck generator.
 *
 * Accepted candidates can be added directly to the deck with one click, or
 * passed to the Generator tab as additional seeds via the Zustand deck store.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useDeckStore, useMainboardEntries } from "../store/deckStore";
import { db } from "../lib/db";
import {
  recommendSynergyCards,
  type SynergyCandidate,
  type SynergyRecommendation,
} from "../lib/analysis/synergyRecommender";
import type { CardRecord } from "../lib/types";

// ── CMC filter options ────────────────────────────────────────────────────────
const CMC_OPTIONS = [
  { label: "Any MV", value: undefined },
  { label: "≤ 2", value: 2 },
  { label: "≤ 3", value: 3 },
  { label: "≤ 4", value: 4 },
  { label: "≤ 5", value: 5 },
];

const TYPE_OPTIONS = [
  { label: "All types", value: "" },
  { label: "Creatures", value: "Creature" },
  { label: "Instants", value: "Instant" },
  { label: "Sorceries", value: "Sorcery" },
  { label: "Enchantments", value: "Enchantment" },
  { label: "Artifacts", value: "Artifact" },
  { label: "Planeswalkers", value: "Planeswalker" },
];

const LEGALITY_OPTIONS = [
  { label: "Commander", value: "commander" },
  { label: "Any format", value: "any" },
  { label: "Standard", value: "standard" },
  { label: "Pioneer", value: "pioneer" },
  { label: "Modern", value: "modern" },
  { label: "Legacy", value: "legacy" },
  { label: "Pauper", value: "pauper" },
];

// ── Small subcomponent — one candidate row ────────────────────────────────────

function CandidateRow({
  candidate,
  onAdd,
  onViewDetail,
}: {
  candidate: SynergyCandidate;
  onAdd: () => void;
  onViewDetail?: () => void;
}) {
  const { card, score, reasons, connectsTo, primaryAxis } = candidate;
  const manaCostDisplay = card.manaCost ?? (card.typeLine.includes("Land") ? "Land" : "—");

  return (
    <div className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 hover:border-zinc-700 transition-colors">
      {/* Image thumbnail */}
      <button
        onClick={onViewDetail}
        className="shrink-0 w-10 h-14 rounded overflow-hidden bg-zinc-800 border border-zinc-700"
        title={`View ${card.name}`}
      >
        {card.imageNormal ? (
          <img src={card.imageNormal} alt={card.name} className="w-full h-full object-cover object-top" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[8px] text-zinc-500 text-center p-0.5">
            {card.name}
          </div>
        )}
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <button
            onClick={onViewDetail}
            className="text-xs font-semibold text-zinc-100 hover:text-teal-300 text-left leading-tight line-clamp-1"
          >
            {card.name}
          </button>
          <span className="shrink-0 text-[10px] text-zinc-500 font-mono" title="Synergy score">
            {score.toFixed(1)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[10px] text-zinc-500">{manaCostDisplay}</span>
          <span className="text-[10px] text-zinc-600 truncate max-w-[120px]">{card.typeLine}</span>
          {primaryAxis !== "color-support" && (
            <span className="rounded-full bg-teal-900/60 px-1.5 py-0.5 text-[10px] text-teal-300 border border-teal-800/60">
              {primaryAxis}
            </span>
          )}
        </div>
        {/* Reasons */}
        <ul className="mt-1 space-y-0.5">
          {reasons.slice(0, 2).map((r) => (
            <li key={r} className="text-[10px] text-zinc-500 leading-snug">
              • {r}
            </li>
          ))}
        </ul>
        {connectsTo.length > 0 && (
          <p className="mt-0.5 text-[10px] text-zinc-600 italic">
            ↳ connects to: {connectsTo.join(", ")}
          </p>
        )}
      </div>

      {/* Add button */}
      <button
        onClick={onAdd}
        className="shrink-0 rounded-md border border-teal-700 bg-teal-600/10 px-2 py-1 text-[11px] text-teal-200 hover:bg-teal-600/20 transition-colors self-start mt-0.5"
        title={`Add ${card.name} to deck`}
      >
        + Add
      </button>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function SynergyPreAnalysisPanel({
  onCardClick,
}: {
  onCardClick?: (card: CardRecord) => void;
}) {
  const mainEntries = useMainboardEntries();
  const addCard = useDeckStore((s) => s.addCard);

  // Seed selection state
  const [selectedSeedIds, setSelectedSeedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CardRecord[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Analysis state
  const [recommendation, setRecommendation] = useState<SynergyRecommendation | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Filter state
  const [maxCmc, setMaxCmc] = useState<number | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [legalityFormat, setLegalityFormat] = useState<string>("commander");

  // Derive deck cards for seed picker (non-land mainboard)
  const deckNonlands = useMemo(
    () => mainEntries.filter((e) => e.board === "main" && !e.card.typeLine.includes("Land")).map((e) => e.card),
    [mainEntries]
  );

  // Exclude deck cards from recommendations (they're already in the deck)
  const deckOracleIds = useMemo(
    () => new Set(mainEntries.map((e) => e.card.oracleId)),
    [mainEntries]
  );

  // Selected seed CardRecord objects
  const selectedSeeds = useMemo(() => {
    const deckMap = new Map(deckNonlands.map((c) => [c.oracleId, c]));
    const extraMap = new Map(searchResults.map((c) => [c.oracleId, c]));
    return [...selectedSeedIds]
      .map((id) => deckMap.get(id) ?? extraMap.get(id))
      .filter((c): c is CardRecord => c !== undefined);
  }, [selectedSeedIds, deckNonlands, searchResults]);

  // ── Search cards in DB ──────────────────────────────────────────────────────
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) { setSearchResults([]); return; }

    searchDebounceRef.current = setTimeout(async () => {
      setSearchBusy(true);
      try {
        const results = await db.cards
          .where("name")
          .startsWithIgnoreCase(q)
          .limit(20)
          .toArray();
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchBusy(false);
      }
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery]);

  const toggleSeed = (oracleId: string) => {
    setSelectedSeedIds((prev) => {
      const next = new Set(prev);
      if (next.has(oracleId)) next.delete(oracleId);
      else if (next.size < 5) next.add(oracleId);
      return next;
    });
  };

  // ── Run analysis ─────────────────────────────────────────────────────────────
  const runAnalysis = async () => {
    if (selectedSeeds.length === 0) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setAddedIds(new Set());
    try {
      const rec = await recommendSynergyCards(selectedSeeds, {
        maxCmc,
        typeFilter: typeFilter ? [typeFilter] : [],
        limit: 40,
        excludeOracleIds: deckOracleIds,
        legalityFormat: legalityFormat || "any",
      });
      setRecommendation(rec);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAddCard = (card: CardRecord) => {
    addCard(card, "main");
    setAddedIds((prev) => new Set([...prev, card.oracleId]));
  };

  const clearSeeds = () => {
    setSelectedSeedIds(new Set());
    setRecommendation(null);
    setAddedIds(new Set());
  };

  return (
    <div className="space-y-4 text-sm text-zinc-200">
      {/* ── Header ── */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-300">Pre-AI Synergy Analysis</span>
          {selectedSeedIds.size > 0 && (
            <button
              onClick={clearSeeds}
              className="text-[11px] text-zinc-600 hover:text-zinc-400"
            >
              Clear seeds
            </button>
          )}
        </div>
        <p className="text-[11px] leading-snug text-zinc-600">
          Select up to 5 seed cards. The engine scans oracle text, mechanic axes, type lines,
          and keywords in the local database to surface synergy candidates — before any AI
          generation. Accepted cards feed directly into your deck (and into the AI generator
          as locked seeds).
        </p>
      </div>

      {/* ── Seed picker: from current deck ── */}
      {deckNonlands.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Pick seeds from your deck <span className="font-normal text-zinc-700">({selectedSeedIds.size}/5 selected)</span>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/30 p-2">
            {deckNonlands.map((card) => {
              const on = selectedSeedIds.has(card.oracleId);
              return (
                <button
                  key={card.oracleId}
                  onClick={() => toggleSeed(card.oracleId)}
                  disabled={!on && selectedSeedIds.size >= 5}
                  aria-pressed={on}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    on
                      ? "border-teal-400 bg-teal-600/20 text-teal-200"
                      : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  }`}
                >
                  {card.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Seed search: cards not in deck ── */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Or search the card database for seeds
        </div>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Type a card name…"
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
        />
        {searchBusy && <p className="mt-1 text-[11px] text-zinc-600">Searching…</p>}
        {searchResults.length > 0 && (
          <div className="mt-1 max-h-32 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 divide-y divide-zinc-800/60">
            {searchResults.map((card) => {
              const on = selectedSeedIds.has(card.oracleId);
              return (
                <button
                  key={card.oracleId}
                  onClick={() => toggleSeed(card.oracleId)}
                  disabled={!on && selectedSeedIds.size >= 5}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-zinc-800/60 disabled:opacity-40 ${
                    on ? "text-teal-300" : "text-zinc-300"
                  }`}
                >
                  <span className="truncate">{card.name}</span>
                  <span className="shrink-0 ml-2 text-zinc-600 text-[10px]">{card.typeLine.split("—")[0]?.trim()}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Selected seeds list ── */}
      {selectedSeeds.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Active seeds
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedSeeds.map((card) => (
              <span
                key={card.oracleId}
                className="flex items-center gap-1 rounded-full border border-teal-600/60 bg-teal-900/30 px-2 py-0.5 text-[11px] text-teal-200"
              >
                {card.name}
                <button
                  onClick={() => toggleSeed(card.oracleId)}
                  className="text-teal-500 hover:text-red-300 leading-none"
                  aria-label={`Remove ${card.name} from seeds`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="mb-1 block text-[11px] text-zinc-500">Max mana value</label>
          <select
            value={maxCmc ?? ""}
            onChange={(e) => setMaxCmc(e.target.value === "" ? undefined : Number(e.target.value))}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          >
            {CMC_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.value ?? ""}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-zinc-500">Card type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-zinc-500">Format</label>
          <select
            value={legalityFormat}
            onChange={(e) => setLegalityFormat(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          >
            {LEGALITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Analyse button ── */}
      <button
        onClick={runAnalysis}
        disabled={selectedSeeds.length === 0 || analyzing}
        className="w-full rounded-md border border-teal-600 bg-teal-600/10 px-3 py-2 text-xs font-medium text-teal-200 hover:bg-teal-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {analyzing ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Analysing…
          </span>
        ) : (
          `Find synergy cards for ${selectedSeeds.length} seed${selectedSeeds.length !== 1 ? "s" : ""}`
        )}
      </button>

      {analyzeError && (
        <div className="rounded border border-red-800 bg-red-950/30 p-2 text-[11px] text-red-300">
          {analyzeError}
        </div>
      )}

      {/* ── Results ── */}
      {recommendation && !analyzing && (
        <div className="space-y-3">
          {/* Narrative + themes */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
            <p className="text-[11px] leading-snug text-zinc-400">{recommendation.narrative}</p>
            {recommendation.detectedThemes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {recommendation.detectedThemes.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-purple-700/60 bg-purple-900/20 px-2 py-0.5 text-[10px] text-purple-300"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {recommendation.candidates.length === 0 && (
            <p className="text-center text-xs text-zinc-600 py-6">
              No synergy candidates found in the local database for these seeds.
              <br />Try adjusting filters or adding more seed cards.
            </p>
          )}

          {recommendation.candidates.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                {recommendation.candidates.length} suggestions sorted by synergy score
              </div>
              <div className="space-y-1.5">
                {recommendation.candidates.map((candidate) => (
                  <div key={candidate.card.oracleId} className="relative">
                    {addedIds.has(candidate.card.oracleId) && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-emerald-950/70 border border-emerald-800 text-[11px] text-emerald-300 font-medium pointer-events-none">
                        ✓ Added to deck
                      </div>
                    )}
                    <CandidateRow
                      candidate={candidate}
                      onAdd={() => handleAddCard(candidate.card)}
                      onViewDetail={() => onCardClick?.(candidate.card)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-zinc-700 text-center">
            Analysis is local-only — no AI or network required. Results update each time you re-run.
          </p>
        </div>
      )}
    </div>
  );
}
