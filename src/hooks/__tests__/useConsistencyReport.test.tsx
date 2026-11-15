import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DeckEntry } from '../../lib/legality';
import type { CardRecord } from '../../lib/types';

const mock = vi.hoisted(() => ({ entries: [] as DeckEntry[], build: vi.fn(() => ({})) }));
vi.mock('../../store/deckStore', () => ({ useMainboardEntries: () => mock.entries }));
vi.mock('../../lib/consistencyReport', () => ({ buildConsistencyReport: mock.build }));
import { useConsistencyReport } from '../useConsistencyReport';

function Probe() { useConsistencyReport(); return null; }
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined; container?.remove(); container = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals(); mock.build.mockClear();
});
function mount() {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const card = { oracleId: 'mdfc', name: 'Spell // Land', cmc: 2, manaCost: '{1}{U}', typeLine: 'Instant // Land',
    producedManaJson: '', colorIdentityJson: '["U"]', oracleText: 'Land enters tapped.',
    cardFacesJson: '[{"type_line":"Instant"},{"type_line":"Land","oracle_text":"This land enters tapped.","produced_mana":["U"]}]' } as CardRecord;
  mock.entries = [{ card, quantity: 4, board: 'main' }];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root?.render(createElement(Probe)));
  act(() => vi.runOnlyPendingTimers());
  return card;
}

describe('live consistency metadata', () => {
  it('recomputes when relevant card metadata changes without identity or quantity changes', () => {
    const card = mount();
    expect(mock.build).toHaveBeenCalledTimes(1);
    mock.entries = [{ ...mock.entries[0], card: { ...card, cardFacesJson: '[{"type_line":"Instant"},{"type_line":"Land","oracle_text":"Untapped land.","produced_mana":["R"]}]' } }];
    act(() => root?.render(createElement(Probe)));
    act(() => vi.runOnlyPendingTimers());
    expect(mock.build).toHaveBeenCalledTimes(2);
  });
  it('passes land face, color identity and oracle text through to the report model', () => {
    const card = mount();
    expect(mock.build).toHaveBeenLastCalledWith([expect.objectContaining({
      colorIdentityJson: card.colorIdentityJson, cardFacesJson: card.cardFacesJson, oracleText: card.oracleText,
    })], 10000, true);
  });
});
