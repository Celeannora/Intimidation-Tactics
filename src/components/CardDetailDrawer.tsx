import { useEffect, useRef, useMemo } from "react";
import type { CardRecord } from "../lib/types";
import { useDeckStore } from "../store/deckStore";
import { assignRoles } from "../lib/roles";
import { maxCopiesForCard } from "../lib/legality";
import { computeCompositeScore } from "../lib/scoreEngine";

interface Props {
  card: CardRecord;
  onClose: () => void;
}

const MANA_COLORS: Record<string, string> = {
  W: "bg-yellow-100 text-yellow-900",
  U: "bg-blue-700 text-white",
  B: "bg-zinc-900 text-zinc-100 border border-zinc-600",
  R: "bg-red-700 text-white",
  G: "bg-green-700 text-white",
  C: "bg-zinc-500 text-white",
};

function ManaSymbol({ symbol }: { symbol: string }) {
  const cleaned = symbol.replace(/[{}]/g, "");
  const cls = MANA_COLORS[cleaned] ?? "bg-zinc-700 text-zinc-200";
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${cls}`}
      aria-label={`Mana symbol ${cleaned}`}
    >
      {cleaned}
    </span>
  );
}

function parseManaSymbols(cost: string) {
  return cost.match(/\{[^}]+\}/g) ?? [];
}

export function CardDetailDrawer({ card, onClose }: Props) {
  const { entries, addCard, removeCard } = useDeckStore();

  const roles   = useMemo(() => assignRoles(card), [card]);
  // Synergy & signal from V2 composite scoring
  const cs = useMemo(() => computeCompositeScore(card, entries, { archetype: "Unknown" }), [card, entries]);
  const synergy = Math.min(30, Math.round(cs.directionalScore * 0.75)); // map 0-40 to 0-30
  const signal  = Math.min(30, Math.round((cs.directionalScore + cs.compositionBonus) * 0.5)); // map combined to 0-30

  // Focus management: move focus into drawer on open, restore on close
  const closeBtnRef   = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    closeBtnRef.current?.focus();
    return () => {
      previousFocus.current?.focus();
    };
  }, []);

  const mainCopies = entries
    .filter((e) => e.card.id === card.id && e.board === "main")
    .reduce((s, e) => s + e.quantity, 0);
  const sideCopies = entries
    .filter((e) => e.card.id === card.id && e.board === "side")
    .reduce((s, e) => s + e.quantity, 0);

  const maxCopies = maxCopiesForCard(card);

  const rotationLabel =
    card.legalityStandard === "legal"  ? "Standard Legal" :
    card.legalityFuture   === "legal"  ? "Coming Soon"    :
    card.legalityStandard === "banned" ? "BANNED"         : "Not Legal";

  const rotationColor =
    rotationLabel === "Standard Legal" ? "text-emerald-400" :
    rotationLabel === "BANNED"          ? "text-red-400"     :
    rotationLabel === "Coming Soon"     ? "text-yellow-400"  : "text-zinc-500";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-drawer-title"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />

      <aside className="relative z-10 flex h-full w-[420px] flex-col overflow-y-auto border-l border-zinc-700 bg-zinc-950 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="card-drawer-title" className="truncate font-semibold text-zinc-100">{card.name}</h2>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Close card detail"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-5 p-4">
          {card.imageNormal ? (
            <img src={card.imageNormal} alt={card.name} width={280} height={390}
              loading="lazy" className="rounded-xl self-center shadow-lg" />
          ) : (
            <div
              className="h-[390px] w-[280px] self-center rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-600 text-sm"
              role="img"
              aria-label={`No image available for ${card.name}`}
            >
              No image
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {card.manaCost && (
              <div className="flex items-center gap-1 flex-wrap" aria-label={`Mana cost: ${card.manaCost}`}>
                {parseManaSymbols(card.manaCost).map((s, i) => <ManaSymbol key={i} symbol={s} />)}
                <span className="ml-1 text-xs text-zinc-500">MV {card.cmc}</span>
              </div>
            )}
            <div className="text-sm text-zinc-300">{card.typeLine}</div>
            <div className={`text-xs font-medium ${rotationColor}`}>{rotationLabel}</div>
          </div>

          {card.oracleText && (
            <div className="rounded-lg bg-zinc-900 px-3 py-2 text-sm leading-relaxed text-zinc-300 whitespace-pre-line">
              {card.oracleText}
            </div>
          )}

          {(card.power || card.toughness || card.loyalty) && (
            <div className="flex gap-3 text-sm">
              {(card.power || card.toughness) && (
                <span className="rounded bg-zinc-800 px-2 py-1 font-mono text-zinc-200"
                  aria-label={`Power ${card.power}, Toughness ${card.toughness}`}>
                  {card.power}/{card.toughness}
                </span>
              )}
              {card.loyalty && (
                <span className="rounded bg-zinc-800 px-2 py-1 font-mono text-zinc-200">Loyalty: {card.loyalty}</span>
              )}
            </div>
          )}

          {roles.length > 0 && (
            <div className="flex flex-wrap gap-1" aria-label="Card roles">
              {roles.map((r) => (
                <span key={r} className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{r}</span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <ScoreTile label="Synergy" value={String(synergy)} sub="/30" />
            <ScoreTile label="Signal"  value={String(signal)}  sub="/30" />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            {card.priceUsd     != null && <span aria-label={`Price ${card.priceUsd.toFixed(2)} USD`}>${card.priceUsd.toFixed(2)} USD</span>}
            {card.priceUsdFoil != null && <span aria-label={`Foil price ${card.priceUsdFoil.toFixed(2)} USD`}>${card.priceUsdFoil.toFixed(2)} foil</span>}
            <span>{card.setName}</span>
            {card.rarity       && <span className="capitalize">{card.rarity}</span>}
            {card.edhrecRank   != null && <span>EDHREC #{card.edhrecRank}</span>}
          </div>

          <div className="flex flex-col gap-2">
            <DeckQtyRow label="Mainboard" copies={mainCopies} max={maxCopies}
              onAdd={() => addCard(card, "main")} onRemove={() => removeCard(card.id, "main")} />
            <DeckQtyRow label="Sideboard" copies={sideCopies} max={15}
              onAdd={() => addCard(card, "side")} onRemove={() => removeCard(card.id, "side")} />
          </div>
        </div>
      </aside>
    </div>
  );
}

function ScoreTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-zinc-900 py-2" aria-label={`${label}: ${value} ${sub}`}>
      <span className="text-base font-bold text-zinc-100" aria-hidden="true">{value}</span>
      <span className="text-xs text-zinc-500" aria-hidden="true">{sub}</span>
      <span className="text-xs text-zinc-600" aria-hidden="true">{label}</span>
    </div>
  );
}

function DeckQtyRow({
  label, copies, max, onAdd, onRemove
}: { label: string; copies: number; max: number; onAdd: () => void; onRemove: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-2">
      <span className="text-sm text-zinc-400" id={`qty-label-${label.toLowerCase()}`}>{label}</span>
      <div className="flex items-center gap-3" role="group" aria-labelledby={`qty-label-${label.toLowerCase()}`}>
        <button onClick={onRemove} disabled={copies === 0}
          className="h-7 w-7 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 text-sm font-bold"
          aria-label={`Remove one copy from ${label}`}>−</button>
        <span className="w-4 text-center font-mono text-sm text-zinc-200" aria-label={`${copies} copies`}>{copies}</span>
        <button onClick={onAdd} disabled={copies >= max}
          className="h-7 w-7 rounded bg-teal-700 text-white hover:bg-teal-600 disabled:opacity-30 text-sm font-bold"
          aria-label={`Add one copy to ${label}`}>+</button>
      </div>
    </div>
  );
}
