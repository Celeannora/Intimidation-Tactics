import { useCallback, useEffect, useRef, useState } from "react";
import { searchCards, type CardFilters } from "../lib/search";
import type { CardRecord } from "../lib/types";

interface CardPoolState {
  cards: CardRecord[];
  total: number;
  loading: boolean;
  error: string | null;
  page: number;
  hasMore: boolean;
}

const DEFAULT_PER_PAGE = 50;

export function useCardPool(filters: CardFilters) {
  const [state, setState] = useState<CardPoolState>({
    cards: [],
    total: 0,
    loading: false,
    error: null,
    page: 1,
    hasMore: false,
  });

  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(
    async (page: number, append: boolean) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const { cards, total } = await searchCards({
          ...filters,
          page,
          perPage: DEFAULT_PER_PAGE,
        });

        if (ctrl.signal.aborted) return;

        setState((s) => ({
          cards: append ? [...s.cards, ...cards] : cards,
          total,
          loading: false,
          error: null,
          page,
          hasMore: page * DEFAULT_PER_PAGE < total,
        }));
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Search failed",
        }));
      }
    },
     
    [JSON.stringify(filters)]
  );

  useEffect(() => {
    runSearch(1, false);
  }, [runSearch]);

  const loadMore = useCallback(() => {
    if (!state.loading && state.hasMore) {
      runSearch(state.page + 1, true);
    }
  }, [state.loading, state.hasMore, state.page, runSearch]);

  return { ...state, loadMore };
}
