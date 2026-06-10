import type { AppView } from "../App";

interface Props {
  view: AppView;
  onViewChange: (v: AppView) => void;
}

const NAV: { id: AppView; label: string }[] = [
  { id: "builder",  label: "Deck Builder" },
  { id: "compare",  label: "Compare" },
  { id: "import",   label: "Import Data" },
];

export function Header({ view, onViewChange }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4">
      <div className="flex items-center gap-2">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-label="MTG Deck Builder" className="text-teal-400">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 4 L15 10 L12 8 L9 10 Z" fill="currentColor" />
          <path d="M12 8 L12 20" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 14 Q12 12 17 14" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
        <span className="hidden sm:inline text-sm font-semibold tracking-tight text-zinc-100">MTG Deck Builder</span>
        <span className="ml-1 rounded bg-teal-900/60 px-1.5 py-0.5 text-xs text-teal-300">Standard</span>
      </div>

      <nav className="flex items-center gap-1" aria-label="Main navigation">
        {NAV.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onViewChange(id)}
            aria-current={view === id ? "page" : undefined}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              view === id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="hidden md:block text-xs text-zinc-600">
        Card data &amp; images by{" "}
        <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer"
          className="text-zinc-500 underline hover:text-zinc-300">Scryfall</a>
        {" "}· © Wizards of the Coast
      </div>
    </header>
  );
}
