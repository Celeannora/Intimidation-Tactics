import { useCallback, useEffect, useId, useRef, useState } from "react";
import { searchCards, type CardFilters, type SortField } from "../lib/search";
import type { CardRecord } from "../lib/types";
import { useDeckStore } from "../store/deckStore";
import { computeSynergyScoreV2 } from "../lib/generator/synergyModel";

const COLORS = ["W", "U", "B", "R", "G"];
const COLOR_LABEL: Record<string, string> = {
  W: "White", U: "Blue", B: "Black", R: "Red", G: "Green",
};
const COLOR_EMOJI: Record<string, string> = {
  W: "☀", U: "💧", B: "💀", R: "🔥", G: "🌲",
};
const RARITIES = ["common", "uncommon", "rare", "mythic"];

function ColorBadge({ colors }: { colors: string[] }) {
  if (!colors.length) return <span className="text-zinc-500 text-xs">Colorless</span>;
  return (
    <span className="flex gap-0.5 text-xs" aria-label={colors.map(c => COLOR_LABEL[c] ?? c).join(", ")}>
      {colors.map((c) => (
        <span key={c} aria-hidden="true">{COLOR_EMOJI[c] ?? c}</span>
      ))}
    </span>
  );
}

function CardRow({
  card,
  deckCards,
  onAdd,
  onCardClick,
}: {
  card: CardRecord;
  deckCards: CardRecord[];
  onAdd: (card: CardRecord) => void;
  onCardClick?: (card: CardRecord) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  // Synergy: 0–30 (keyword overlap with deck fingerprint). null when deck is empty.
  const synergy = deckCards.length > 0
    ? computeSynergyScoreV2(card, deckCards.map(c => ({ card: c, quantity: 1, board: "main" as const })))
    : null;
  const colors = JSON.parse(card.colorIdentityJson) as string[];

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 hover:border-zinc-700">
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            if (onCardClick) onCardClick(card);
            else setExpanded((v) => !v);
          }}
          className="flex-1 text-left"
          aria-expanded={onCardClick ? undefined : expanded}
          aria-controls={onCardClick ? undefined : panelId}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-100">{card.name}</span>
            <div className="flex items-center gap-2">
              <ColorBadge colors={colors} />
              {card.cmc > 0 && (
                <span className="text-xs text-zinc-400">{card.cmc} CMC</span>
              )}
              {synergy !== null && synergy > 0 && (
                <span
                  className={`text-xs ${
                    synergy >= 20
                      ? "text-amber-400"
                      : synergy >= 10
                      ? "text-teal-400"
                      : "text-zinc-500"
                  }`}
                  aria-label={`Synergy score: ${synergy} out of 30`}
                >
                  {synergy}
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-zinc-500 truncate">{card.typeLine}</p>
        </button>
        <button
          onClick={() => onAdd(card)}
          className="shrink-0 rounded bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-500"
          aria-label={`Add ${card.name} to deck`}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>

      {expanded && !onCardClick && (
        <div id={panelId} className="mt-1 border-t border-zinc-800 pt-2 text-xs">
          {card.imageNormal && (
            <img
              src={card.imageNormal}
              alt={card.name}
              width={146}
              height={204}
              loading="lazy"
              className="mb-2 rounded-md"
            />
          )}
          <p className="whitespace-pre-wrap text-zinc-400">{card.oracleText}</p>
          {card.priceUsd !== null && card.priceUsd !== undefined && (
            <p className="mt-1 text-zinc-500">${card.priceUsd.toFixed(2)}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function CardSearchPanel({ onCardClick }: { onCardClick?: (card: CardRecord) => void }) {
  const addCard   = useDeckStore((s) => s.addCard);
  const entries   = useDeckStore((s) => s.entries);
  const deckCards = entries.filter((e) => e.board === "main").map((e) => e.card);

  const [query, setQuery]       = useState("");
  const [colors, setColors]     = useState<string[]>([]);
  const [rarities, setRarities] = useState<string[]>([]);
  const [cmcMin, setCmcMin]     = useState<string>("");
  const [cmcMax, setCmcMax]     = useState<string>("");
  const [sortBy, setSortBy]     = useState<SortField>("name");
  const [results, setResults]   = useState<CardRecord[]>([]);
  const [page, setPage]         = useState(1);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PER_PAGE = 30;

  const run = useCallback(
    async (pageNum: number) => {
      setLoading(true);
      const filters: CardFilters = {
        text:     query || undefined,
        colors:   colors.length   ? colors   : undefined,
        rarities: rarities.length ? rarities : undefined,
        cmcMin:   cmcMin !== ""   ? Number(cmcMin) : undefined,
        cmcMax:   cmcMax !== ""   ? Number(cmcMax) : undefined,
        sort:     sortBy,
        direction: "asc",
        page:     pageNum,
        perPage:  PER_PAGE,
      };
      const { cards, total: t } = await searchCards(filters);
      setResults((prev) => (pageNum === 1 ? cards : [...prev, ...cards]));
      setTotal(t);
      setLoading(false);
    },
    [query, colors, rarities, cmcMin, cmcMax, sortBy]
  );

  useEffect(() => {
    setPage(1);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => run(1), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [run]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    run(next);
  };

  const toggleColor  = (c: string) => setColors(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  const toggleRarity = (r: string) => setRarities(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);

  const resultAnnouncement = loading
    ? "Searching…"
    : results.length === 0
    ? "No cards found"
    : `${results.length} of ${total} card${total === 1 ? "" : "s"} shown`;

  const hasMore = results.length < total;

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {/* Search bar */}
      <div>
        <label htmlFor="card-search-input" className="sr-only">Search cards</label>
        <input
          id="card-search-input"
          data-shortcut="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cards…"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-teal-500 focus:outline-none"
        />
      </div>

      {/* Color filters */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by color">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => toggleColor(c)}
            aria-pressed={colors.includes(c)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
              colors.includes(c)
                ? "bg-teal-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            <span aria-hidden="true">{COLOR_EMOJI[c]} </span>{COLOR_LABEL[c]}
          </button>
        ))}
      </div>

      {/* Rarity filters */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by rarity">
        {RARITIES.map((r) => (
          <button
            key={r}
            onClick={() => toggleRarity(r)}
            aria-pressed={rarities.includes(r)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition-colors ${
              rarities.includes(r)
                ? "bg-teal-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* CMC + sort */}
      <div className="flex gap-2">
        <label htmlFor="cmc-min" className="sr-only">Minimum CMC</label>
        <input
          id="cmc-min"
          type="number"
          min={0}
          value={cmcMin}
          onChange={(e) => setCmcMin(e.target.value)}
          placeholder="CMC min"
          aria-label="Minimum converted mana cost"
          className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500"
        />
        <label htmlFor="cmc-max" className="sr-only">Maximum CMC</label>
        <input
          id="cmc-max"
          type="number"
          min={0}
          value={cmcMax}
          onChange={(e) => setCmcMax(e.target.value)}
          placeholder="CMC max"
          aria-label="Maximum converted mana cost"
          className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500"
        />
        <label htmlFor="sort-by" className="sr-only">Sort by</label>
        <select
          id="sort-by"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortField)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
        >
          <option value="name">Name</option>
          <option value="cmc">CMC</option>
          <option value="rarity">Rarity</option>
          <option value="priceUsd">Price</option>
          <option value="edhrecRank">Popularity</option>
        </select>
      </div>

      {/* Live region for result count */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {resultAnnouncement}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1" aria-label="Search results">
        {results.map((card) => (
          <CardRow
            key={card.id}
            card={card}
            deckCards={deckCards}
            onAdd={(c) => addCard(c, "main")}
            onCardClick={onCardClick}
          />
        ))}
        {loading && (
          <p className="text-center text-xs text-zinc-500 py-4" aria-live="polite">Loading…</p>
        )}
        {!loading && hasMore && (
          <button
            onClick={loadMore}
            className="w-full py-2 text-xs text-zinc-400 hover:text-zinc-200"
          >
            Load more
          </button>
        )}
        {!loading && results.length === 0 && (
          <p className="text-center text-xs text-zinc-500 py-8">No cards found</p>
        )}
      </div>
    </div>
  );
}
