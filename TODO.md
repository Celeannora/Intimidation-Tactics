# TODO

Short, honest list. The previous TODO referenced phases that were either done,
deleted, or quarantined; that content has been dropped.

## Soon

- [ ] Smoke-test `npm run dev` against a real `oracle_cards.json` import end
      to end. Typecheck + lint + build + unit tests are green, but the import
      worker hasn't been exercised in this triage pass.
- [ ] `src/lib/manaBase.ts:42` — add an index signature to `PipCount` so we can
      drop the `as unknown as Record<string, number>` cast.
- [ ] Cover `getPowerSignal` with a unit test that exercises `isThreat(roles)`
      so the behaviour change documented in the CHANGELOG is locked in.
- [ ] Drop the `// Heuristic` magic numbers in `recommendedLandCount` behind a
      named constant and a doc comment that cites where 18 / 27 come from.

## Maybe later

- [ ] Re-evaluate any of the `src/experimental/` modules. Each one needs its
      target API redesigned against the current store + types, not just lint
      fixes.
- [ ] Replace the `ManaCurveChart` plain-Tailwind bars with a real chart
      library if/when the UI calls for it. (The old CHANGELOG claimed
      Chart.js was in use; it never was.)
- [ ] PWA: actually verify offline behaviour and `sw.js` cache invalidation
      rather than trusting the boilerplate.

## Won't do (without an explicit prior agreement)

- Restore rotation tracking.
- Restore deck history / versioning (would also require a `deckVersions`
  Dexie table that has never existed).
- Restore `useManaBaseStore`.
- Add a rule that says "every commit must update the README" — that rule
  produced the README this triage pass had to delete.
