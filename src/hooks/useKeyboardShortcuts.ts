/**
 * useKeyboardShortcuts
 *
 * Global keyboard shortcut handler. Ignores keystrokes when focus is inside
 * an <input>, <textarea>, or [contenteditable] element so typing doesn't
 * accidentally trigger actions.
 *
 * Shortcuts:
 *   ?              → toggle shortcut cheatsheet
 *   S              → focus card search input  (data-shortcut="search")
 *   N              → new deck
 *   Ctrl/Cmd + S   → save current deck
 *   B              → builder view
 *   C              → compare view
 *   I              → import view
 *   [              → prev mobile panel
 *   ]              → next mobile panel
 *   Escape         → close open overlays (handled by callers via callbacks)
 */
import { useEffect } from "react";
import type { AppView } from "../App";

export interface ShortcutHandlers {
  onToggleCheatsheet: () => void;
  onViewChange: (v: AppView) => void;
  onNewDeck: () => void;
  onSaveDeck: () => void;
  onEscape: () => void;
  onPrevPanel: () => void;
  onNextPanel: () => void;
  mobilePanelCount: number;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd+S — always intercept to prevent browser save dialog
      if (ctrl && e.key === "s") {
        e.preventDefault();
        handlers.onSaveDeck();
        return;
      }

      // All other shortcuts: ignore when user is typing,
      // or when any modifier is held (so browser Ctrl+C/V/X/A/F/T/W/R etc.
      // are never hijacked by single-letter shortcuts).
      if (isTyping(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case "?":
          e.preventDefault();
          handlers.onToggleCheatsheet();
          break;

        case "s":
        case "S": {
          e.preventDefault();
          // Focus the card search input
          const el = document.querySelector<HTMLElement>('[data-shortcut="search"]');
          el?.focus();
          break;
        }

        case "n":
        case "N":
          e.preventDefault();
          handlers.onNewDeck();
          break;

        case "b":
        case "B":
          e.preventDefault();
          handlers.onViewChange("builder");
          break;

        case "c":
        case "C":
          e.preventDefault();
          handlers.onViewChange("compare");
          break;

        case "i":
        case "I":
          e.preventDefault();
          handlers.onViewChange("import");
          break;

        case "[":
          e.preventDefault();
          handlers.onPrevPanel();
          break;

        case "]":
          e.preventDefault();
          handlers.onNextPanel();
          break;

        case "Escape":
          handlers.onEscape();
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
