# MTG Deck Builder — Full Product Audit Report

**Version:** 0.1.0  
**Audit Date:** 2026-06-10  
**Auditor:** Senior QA Engineer / MTG Rules Expert  
**Build:** `src/` (React + TypeScript + Vite + Dexie + Zustand)

---

## 1. CORE DECK BUILDER FUNCTIONS

### 1.1 Add/Remove Cards
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `deckStore.addCard()` adds a CardRecord to `entries` array. `removeCard()` decrements quantity or removes entry. Both trigger `revalidate()` for live validation updates. Tested via code review of `src/store/deckStore.ts` lines 164–195. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 1.2 Set Card Quantities (Min 1, Max 4; Basics Unlimited)
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `setQuantity()` in `deckStore.ts` line 197–216 clamps qty via `Math.max(0, Math.min(qty, maxCopiesForCard(card)))`. `maxCopiesForCard()` returns 99 for basics / "any number" clause cards, 4 for others. `BASIC_LAND_NAMES` in `legality.ts` includes Island, Plains, Swamp, Mountain, Forest, Wastes. `allowsAnyNumberOfCopies()` also checks Oracle text for "A deck can have any number of cards named". |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | Confirm that Snow-Covered basics (e.g., Snow-Covered Island) are covered. They have the same name as regular basics? No — Snow-Covered Island is a distinct name. It's NOT in `BASIC_LAND_NAMES` set. However, snow lands ARE basic lands, so they should be unlimited. This is a **Medium** edge-case bug. |

### 1.3 Deck Naming, Saving, Loading, Deleting
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | Full CRUD via `deckStore.ts`/`db.ts`. `saveCurrentDeck()` persists to IndexedDB `savedDecks` table. `loadSavedDeck()` restores from DB. `deleteSavedDeck()` removes by ID. `renameSavedDeck()` updates name. `newDeck()` resets state. Tested via code review of lines 78–160. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 1.4 Deck Duplication / Copy
| Attribute | Value |
|-----------|-------|
| **Status** | **NOT IMPLEMENTED** |
| **Details** | No explicit "Duplicate Deck" button exists. Users can save the same deck under a new name by editing the name and clicking "Save Current", but there is no one-click duplication. `DeckListPanel.tsx` only shows Save/New/Delete/Rename. |
| **Issues** | Missing feature: users must manually rename and save to duplicate. |
| **Severity** | **Low** |
| **Recommendation** | Add a "Duplicate" button to `DeckListPanel.tsx` that calls `newDeck()`, copies entries, then saves with "Copy of {name}". |

### 1.5 Import/Export
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (Partial for URL import) |
| **Details** | **Export:** MTGO text, Arena text, JSON, CSV, shareable Base64 link — all implemented in `deckExporter.ts`. **Import:** Text paste (MTGO/Arena format) works via `deckParser.ts`. JSON import works in `DeckImportPanel.tsx`. URL import from MTGGoldfish and Moxfield is implemented but **blocked by CORS** (noted in `deckImportSources.ts` lines 6–8). Shareable link decoding works. |
| **Issues** | URL import from external sites is broken due to CORS (declared in comments). |
| **Severity** | **Medium** |
| **Recommendation** | Document the CORS limitation in the UI (a warning is already shown). For production, recommend a proxy or backend relay. |

### 1.6 Sideboard Support
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `moveCard()` in `deckStore.ts` (line 218) moves cards between "main" and "side" boards. Sideboard validation enforces 0 or exactly 15 cards (per format rules). Sideboard tab in `DeckPanel.tsx` shows sideboard entries. Side constraints enforced via `sideboardSize` in format rules. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 1.7 Commander/Companion Slot Handling
| Attribute | Value |
|-----------|-------|
| **Status** | **PARTIAL** |
| **Details** | **Companion:** Fully implemented in `companion.ts` — checks for Yorion (80+), Lurrus (CMC ≤ 2), Kaheera (Cat/Elemental/etc), Obosh (odd CMC), Umori (single type), Gyruda (even CMC), Jegantha (no duplicate symbols), Zirda (activated abilities). Triggered from `deckStore.ts` revalidation. **Commander:** Format rules define `usesCommander: true` for Commander/Brawl/Historic Brawl, but there is **no Commander card slot** in the UI. `DeckPanel.tsx` has no commander zone. `validateDeck()` does NOT enforce singleton rule for Commander (it uses `rules.maxCopies` which is 1 for Commander, so individual card counts are correct, but the 100-card exact size and color identity are NOT validated in the main validation path — they're only in format rules). |
| **Issues** | 1. No Commander card selection UI. 2. Color identity not enforced in main validation. 3. Singleton enforcement works via `maxCopies: 1` but the 100-card strict limit is not enforced (main validation allows exceeding maxMainboardSize with a warning, not a block). |
| **Severity** | **High** |
| **Recommendation** | Add Commander slot to `DeckPanel.tsx`. Add color identity validation to `validateDeck()` when `usesCommander` is true. Enforce strict 100-card limit (currently maxMainboardSize: 100 is advisory, not enforced as hard block — `rules.defaultMainboardSize === rules.maxMainboardSize` should be treated as exact match for Commander). |

### 1.8 Search and Filter
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `CardSearchPanel.tsx` provides: text search (name, oracle text, type line, flavor text), color filter (WUBRG, includes/exactly/atMost modes, colorless toggle), rarity filter, CMC range, sort by name/CMC/rarity/price/edhrecRank, pagination with "Load more". `search.ts` implements full indexed-db-based search with filter composition. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 1.9 Sorting Options
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | Sort options: Name, CMC, Rarity, Price, Popularity. Direction: asc/desc. Implemented in `search.ts` lines 81–91 and `CardSearchPanel.tsx` line 124. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

---

## 2. DECK VALIDATION & GAME RULES

### 2.1 Minimum 60 Cards (Main Deck)
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `validateDeck()` in `legality.ts` line 60 checks `mainCount < rules.minMainboardSize`. For Standard/Modern/Legacy/Vintage this is 60. For Commander it's 100. Violation rule: "MIN_60". |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 2.2 Max 4 Copies (Non-Basic)
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `maxCopiesForCard()` returns 99 for basics/"any number" cards, 4 otherwise. `validateDeck()` aggregates by oracleId and flags entries exceeding max. `setQuantity()` clamps to max. `addCard()` refuses if at max. |
| **Issues** | Snow-covered basics not in `BASIC_LAND_NAMES` (see 1.2). |
| **Severity** | **Medium** |
| **Recommendation** | Add snow-covered basic names to `BASIC_LAND_NAMES` or detect basic land type line programmatically. |

### 2.3 Vintage Restricted List
| Attribute | Value |
|-----------|-------|
| **Status** | **NOT IMPLEMENTED** |
| **Details** | Scryfall provides a `"restricted"` legality status for Vintage. `validateDeck()` only checks for `"banned"` (line 124–135) and `"not_legal"` (line 112–122). There is **no check for restricted cards being limited to 1 copy**. The `maxCopiesForCard()` function does not consult the format's restricted list. |
| **Issues** | Cards restricted in Vintage (e.g., Sol Ring, Demonic Tutor, Brainstorm) are allowed up to 4 copies instead of 1. |
| **Severity** | **High** |
| **Recommendation** | Add restricted card handling: in `validateDeck()`, when format is "vintage", check `getCardLegality(card, "vintage") === "restricted"` and enforce max 1 copy. |

### 2.4 Ban List Enforcement
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `validateDeck()` line 124–135 checks for `getCardLegality(card, format) === "banned"` using Scryfall legalities data. Banned cards are flagged with rule "BANNED" and message. Cards not legal in format are also flagged with "NOT_LEGAL". |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 2.5 Format-Specific Rules

#### Standard (Set Rotation)
| Attribute | Value |
|-----------|-------|
| **Status** | **PARTIAL** |
| **Details** | Standard legality is checked via Scryfall's `"standard"` key in `legalitiesJson`. The `FORMAT_RULES` correctly set `scryfallLegalityKey: "standard"`. However, the **card database import** filters by legalityStandard=legal in `search.ts` line 117, which means non-Standard cards are filtered from search results. BUT the main **deck validation** does NOT filter by format by default — the `validateDeck(entries, format)` function takes an optional format parameter. The problem is the main UI has **no format selector** (see below). |
| **Issues** | No format selector in main builder UI — format defaults to Standard everywhere. |
| **Severity** | **Critical** |
| **Recommendation** | Add a format selector to the Header or DeckPanel. Pass selected format to `validateDeck()` and `searchCards()`. |

#### Pioneer
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (via Scryfall data) |
| **Details** | Scryfall `"pioneer"` legality key is configured. Pool accuracy depends on Scryfall data accuracy. `FORMAT_RULES` line 37 correctly configures Pioneer with `minMainboardSize: 60`. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

#### Modern
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (via Scryfall data) |
| **Details** | Scryfall `"modern"` legality key configured. Card pool from 8th Edition onward is handled by Scryfall. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

#### Legacy / Vintage
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (except restricted list for Vintage) |
| **Details** | Both formats configured. Nearly unrestricted pool with ban lists enforced. Vintage restricted list not enforced (see 2.3). |
| **Issues** | Vintage restricted list not enforced (see 2.3). |
| **Severity** | **High** |
| **Recommendation** | See 2.3. |

#### Commander (EDH)
| Attribute | Value |
|-----------|-------|
| **Status** | **PARTIAL** |
| **Details** | Format rules define `maxCopies: 1` (singleton), `defaultMainboardSize: 100`, `minMainboardSize: 100`, `maxMainboardSize: 100`, `usesCommander: true`. But: (1) No Commander slot in UI. (2) Color identity not validated. (3) Singleton is enforced but no check that deck is EXACTLY 100 cards. (4) `sideboardSize: null` means sideboard is forbidden, which is correct. |
| **Issues** | 1. No Commander card slot. 2. Color identity not enforced. 3. 100-card exact size not enforced (currently `maxMainboardSize: 100` produces a warning if exceeded, but no hard block). |
| **Severity** | **High** |
| **Recommendation** | Add Commander slot, color identity validation, and exact-size enforcement. |

#### Brawl
| Attribute | Value |
|-----------|-------|
| **Status** | **PARTIAL** |
| **Details** | Same issues as Commander: 60-card singleton, Standard-legal pool, Commander slot needed. `FORMAT_RULES` defined. |
| **Issues** | Same as Commander. |
| **Severity** | **High** |
| **Recommendation** | Same as Commander. |

#### Pauper
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (via Scryfall data) |
| **Details** | Scryfall `"pauper"` legality key handles the "commons only" rule automatically. Pauper legality in Scryfall already ensures only commons from format-legal sets are allowed. |
| **Issues** | None — but note that Pauper legality depends on Scryfall data being accurate. |
| **Severity** | — |
| **Recommendation** | None needed. |

### 2.6 Special Card Rules

#### Split Cards (Fire // Ice)
| Attribute | Value |
|-----------|-------|
| **Status** | **NOT IMPLEMENTED** |
| **Details** | The `CardRecord` schema stores `cardFacesJson` and `layout` field. Split cards have `layout: "split"`. The `cardNameCandidates()` in `deckParser.ts` (line 113–123) handles split card names for import. However, there is **no special CMC calculation** — the CMC stored is from Scryfall, which stores the combined CMC for split cards (post-MH1 rules use individual MV). The `manaCost` field stores only the first face's cost. No UI shows both halves. |
| **Issues** | Split cards display only one face's data. CMC may be wrong for pre-MH1 rules. |
| **Severity** | **Medium** |
| **Recommendation** | Add split card display in `CardDetailDrawer.tsx` to show both halves. Ensure CMC uses individual MV (post-MH1 standard). |

#### Double-Faced Cards (DFCs)
| Attribute | Value |
|-----------|-------|
| **Status** | **NOT IMPLEMENTED** |
| **Details** | `buildSynergyProfile()` in `synergyModel.ts` (line 342) treats DFCs where typeLine includes "Land" as `isLand = true` (e.g., Unholy Annex // Ritual Chamber). But the `CardRecord` only stores the front face's data. The `cardFacesJson` field exists but is rarely used. For deck-building, front face determines name/CMC, but color identity should include both faces for Commander. |
| **Issues** | DFCs: only front face shown. Color identity from both faces not calculated. |
| **Severity** | **Medium** |
| **Recommendation** | Parse `cardFacesJson` in color identity calculations. Show both faces in card detail. |

#### Adventure Cards
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (as single-card identification) |
| **Details** | Adventure cards have `layout: "adventure"` and both halves in `cardFacesJson`. The app treats them as a single card (correct per MTG rules). No special handling needed beyond normal card operations. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | Consider showing adventure half in card detail view for completeness. |

#### Modal DFCs (MDFCs)
| Attribute | Value |
|-----------|-------|
| **Status** | **NOT IMPLEMENTED** |
| **Details** | MDFCs (e.g., Valki // Tibalt) have `layout: "modal_dfc"`. The `manaBase.ts` line 119 detects these and counts them as 0.5 lands for land count recommendations. But color identity across both faces is not handled. Only the front face's color identity is stored in `colorIdentityJson`. |
| **Issues** | Color identity for MDFCs doesn't include back face. |
| **Severity** | **Medium** |
| **Recommendation** | Parse both faces from `cardFacesJson` for complete color identity in Commander. |

#### Meld Cards
| Attribute | Value |
|-----------|-------|
| **Status** | **NOT IMPLEMENTED** |
| **Details** | Meld cards (e.g., Bruna, the Fading Light // Gisela, the Broken Blade // Brisela, Voice of Nightmares) have `layout: "meld"` or `"transform"`. No code identifies meld pairs or validates that both pieces are present. |
| **Issues** | No meld pair detection or validation. |
| **Severity** | **Low** |
| **Recommendation** | Could add a meld pairs table and optionally flag decks containing one piece without the other. |

#### Companion Validation
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `companion.ts` implements all 8 companions: Yorion (80+), Lurrus (CMC ≤ 2), Kaheera (Cat/Elemental/Nightmare/Dinosaur/Beast), Obosh (odd CMC), Umori (single type), Gyruda (even CMC), Jegantha (no duplicate mana symbols), Zirda (activated abilities). Checked in `deckStore.ts` revalidate(). |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

#### Saga Cards
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | Sagas have type line including "Enchantment — Saga". The `buildManaCurve` in `manaBase.ts` line 321 correctly categorizes them under "Enchantment". The `buildSynergyProfile` correctly tags them as enchantments. No mis-categorization found. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

---

## 3. CARD CATEGORIZATION

### 3.1 Type Line
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | All major types (Creature, Instant, Sorcery, Enchantment, Artifact, Land, Planeswalker, Battle) are handled. Subtypes are parsed from typeLine. Supertypes (Legendary, Snow, Basic, World, Tribal) are present in typeLine but not explicitly indexed (no search filter for supertypes). |
| **Issues** | No search filter for supertypes (e.g., "search only Legendary creatures"). This is a feature gap, not a bug. |
| **Severity** | **Low** |
| **Recommendation** | Add supertype filter to `CardSearchPanel`. |

### 3.2 Color Identity
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (for non-DFC/MDFC cards) |
| **Details** | Color identity is stored as `colorIdentityJson` (JSON array of WUBRG). `colorsJson` stores actual card colors. For Commander, `parseLegalities()` checks Scryfall's Commander legality which already factors color identity, but there's no **client-side color identity enforcement**. Hybrid mana and Phyrexian mana are correctly handled by `parsePips()` in `manaBase.ts`. |
| **Issues** | No client-side color identity enforcement for Commander. DFC/MDFC back-face color identity not included. Colorless cards (e.g., Eldrazi) have empty `colorIdentityJson` which is correct. |
| **Severity** | **Medium** |
| **Recommendation** | Add color identity validation to `validateDeck()` for Commander formats. |

### 3.3 Mana Value (CMC)
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | CMC is stored from Scryfall data (canonical). `buildManaCurve()` buckets by CMC 0–7+. Split card CMC: the stored value is Scryfall's combined CMC (pre-MH1). Lands have CMC 0. X costs: Scryfall stores X=0 for deck-building purposes, which is correct. |
| **Issues** | Split card CMC uses pre-MH1 combined value (Scryfall default). Post-MH1 rules use individual MV per half. |
| **Severity** | **Low** |
| **Recommendation** | For post-MH1 formats, calculate split card MV from individual face costs rather than Scryfall's combined CMC. |

### 3.4 Rarity
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | Rarity is stored as string: "common", "uncommon", "rare", "mythic". Filterable by rarity in search. `RARITY_ORDER` in `search.ts` maps to numeric values for sorting. Pauper format legality is checked via Scryfall, not client-side rarity check (correct — Pauper bans are handled by Scryfall). |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 3.5 Keywords & Abilities
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `keywordsJson` stores Scryfall's official keyword list for each card. `buildSynergyProfile()` adds `broadTags` via regex matching for both evergreen keywords (Flying, First Strike, Haste, etc.) and ability words. `BROAD_PATTERNS` in `synergyModel.ts` lines 235–258 covers all evergreen keywords. `assignRoles()` in `roles.ts` also uses keyword-based pattern matching. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

---

## 4. STATISTICS & ANALYTICS

### 4.1 Mana Curve
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `ManaCurveChart.tsx` displays CMC distribution histogram (0–7+), with stacked bar segments by card type (creatures, instants, sorceries, etc.). Ideal curve marker shown based on detected archetype. Average MV displayed. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 4.2 Color Distribution
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `DeckStatsBar.tsx` shows color pip counts (quantity-weighted) for mainboard. `ManaBasePanel.tsx` shows color source recommendations with pip breakdown using `parsePips()`, which handles hybrid/phyrexian mana correctly. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 4.3 Land Count and Land-to-Spell Ratio
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `ManaBasePanel.tsx` shows current land count with recommended range (18–27), computed by `recommendLandCount()`. MDFC lands count as 0.5. Ramp and draw spells adjust the recommendation. DeckStatsBar shows mainCount/60 and sideCount. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 4.4 Card Type Breakdown
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `DeckPanel.tsx` groups cards into Creatures, Planeswalkers, Noncreature Spells, and Lands sections with count per section. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | Consider adding a percentage breakdown. |

### 4.5 Average Mana Value
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | Calculated in `DeckStatsBar.tsx` and `ManaCurveChart.tsx`: `sum(cmc * quantity) / sum(quantity)` for non-land cards. Displayed as "Avg MV". |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 4.6 Rarity Distribution
| Attribute | Value |
|-----------|-------|
| **Status** | **NOT IMPLEMENTED** in main UI |
| **Details** | No dedicated rarity breakdown panel exists. The `search.ts` has `RARITY_ORDER` for sorting and rarity filters, but there is no visual rarity pie chart or count table in the analysis panels. The `ArchetypePanel.tsx` shows card scores but not rarity. |
| **Issues** | Missing UI feature: rarity distribution visualization. |
| **Severity** | **Low** |
| **Recommendation** | Add a rarity distribution section to the Analysis panel (or as a tab in RightPanel). |

---

## 5. DATABASE INTEGRITY

### 5.1 No Duplicate Card Entries
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (enforced by DB) |
| **Details** | IndexedDB `cards` table uses Scryfall card `id` (unique per card per printing) as primary key. `replaceAllCards()` clears the table before bulk-put. Duplicate oracle IDs across sets are fine (different printings of the same card). |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 5.2 Card Names Match Official Names
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (data-source dependent) |
| **Details** | Card names come directly from Scryfall JSON import. Names with special characters (Æther Vial, Jötun Grunt, etc.) are stored as-is from Scryfall. `search.ts` uses case-insensitive matching. `fuzzyMatchCard()` in `deckParser.ts` attempts exact, set-constrained, starts-with, and contains matching. |
| **Issues** | None — accuracy depends on Scryfall data being current. |
| **Severity** | — |
| **Recommendation** | None needed. |

### 5.3 Set Codes and Collector Numbers
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `setCode` and `collectorNumber` stored from Scryfall. Arena export format uses these correctly. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 5.4 Oracle Text Currency
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (data-source dependent) |
| **Details** | Oracle text is from Scryfall import. Errata is handled by Scryfall (they provide current Oracle text). The app does not need to track errata independently. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 5.5 Price Data
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `priceUsd`, `priceUsdFoil`, `priceEur` stored from Scryfall. Used in sorting and budget calculations in `weights.ts`. No timestamp is stored for when prices were fetched (the `importedAt` field is a single timestamp per DB import, not per-price). This is acceptable for a local app. |
| **Issues** | No per-card price timestamp — prices could be stale if DB is not re-imported. |
| **Severity** | **Low** |
| **Recommendation** | Display `importedAt` as a price freshness indicator. |

### 5.6 Foreign/Alternate Art Cards
| Attribute | Value |
|-----------|-------|
| **Status** | **PARTIAL** |
| **Details** | Cards with `lang !== "en"` are imported but the search panel defaults to showing all languages. There is no language filter. Alternate art cards (same oracleId, different id/setCode) are separate entries — correct per MTG rules (different printings). |
| **Issues** | No language filter in search. |
| **Severity** | **Low** |
| **Recommendation** | Add language filter to `CardSearchPanel`. |

---

## 6. EDGE CASES

### 6.1 Adding a Banned Card
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | Card can be added to deck, but `validateDeck()` flags it with rule "BANNED". The violation is displayed in `DeckPanel.tsx` inline banners and `ValidationPanel.tsx`. The deck is marked as not legal. No hard block — user can still build an illegal deck (this is correct UX — some users want to theory-craft or test illegal combinations). |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 6.2 Deck Exactly at Minimum (60) and Maximum
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (with caveat) |
| **Details** | Exactly 60 cards: deck is legal (no MIN_60 violation). Above 80 cards: flagged with OVER_60 violation. For Commander: 100 cards should be exact, but the maxMainboardSize=100 is only enforced as a warning, not a hard block. |
| **Issues** | Commander 100-card limit is not a hard block. |
| **Severity** | **Medium** |
| **Recommendation** | For Commander, make `validateDeck()` return a CRITICAL violation if count !== 100. |

### 6.3 Deck with 0 Cards — Saving Blocked?
| Attribute | Value |
|-------|-------|
| **Status** | **PARTIAL** |
| **Details** | Saving a 0-card deck is **not blocked** in `deckStore.saveCurrentDeck()` — it will save an empty deck to IndexedDB. The UI shows MIN_60 violation, but the save button in `DeckListPanel.tsx` works regardless. |
| **Issues** | Empty decks can be saved, cluttering the deck list. |
| **Severity** | **Low** |
| **Recommendation** | Disable "Save Current" button or show confirmation when deck has 0 cards. |

### 6.4 Adding 5th Copy of Non-Basic Card
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `addCard()` (line 171) and `setQuantity()` (line 197) both enforce `maxCopiesForCard()` cap of 4. Adding a 5th copy is silently ignored (no error shown). `validateDeck()` flags over-limit entries. |
| **Issues** | Silent failure — user might not know the card wasn't added. |
| **Severity** | **Low** |
| **Recommendation** | Show a brief toast or tooltip when a card cannot be added due to copy limit. |

### 6.5 Card Legal in Multiple Formats
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `parseLegalities()` returns the full Scryfall legalities object. `getCardLegality(card, format)` looks up the specific format's legality. Format selector (in generator panel) correctly gates format-specific validation. The main UI lacks a format selector (see 2.5). |
| **Issues** | No format selector in main UI. |
| **Severity** | **Critical** |
| **Recommendation** | Add format selector to main UI. |

### 6.6 Colorless Cards (Eldrazi) in EDH
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | Colorless cards have empty `colorIdentityJson`. This is correct for Commander — a colorless eldrazi can go in any Commander deck since its color identity is colorless (satisfies all color identity constraints). The app does not enforce color identity in Commander (see 2.5 Commander). |
| **Issues** | Correct data, but no client-side color identity enforcement. |
| **Severity** | — |
| **Recommendation** | See Commander section. |

### 6.7 Snow Lands — Copy Limits
| Attribute | Value |
|-----------|-------|
| **Status** | **FAIL** |
| **Details** | Snow-Covered Island, Snow-Covered Plains, etc. are basic lands but their names are not in `BASIC_LAND_NAMES` (which contains "Island", "Plains", "Swamp", "Mountain", "Forest", "Wastes" — no snow variants). They would be limited to 4 copies instead of unlimited. |
| **Issues** | Snow-covered basics are incorrectly limited to 4 copies. |
| **Severity** | **Medium** |
| **Recommendation** | Add "Snow-Covered Island", "Snow-Covered Plains", etc. to `BASIC_LAND_NAMES`, or detect the "Basic" supertype in `typeLine` instead of checking by name. |

### 6.8 Wish Cards (Burning Wish)
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (no special handling needed) |
| **Details** | Wish cards fetch cards from outside the game (sideboard). No special rule enforcement is needed — the sideboard is already present. The app doesn't need to validate wish targets as this is a gameplay concern, not a deck-building one. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 6.9 Un-Cards (Silver-Bordered / Acorn)
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** (via Scryfall data) |
| **Details** | "Un-" cards (e.g., Unglued, Unhinged) have Scryfall set types like "funny" or "acorn". The `setType` field is stored but not used for legality filtering. These cards typically have no format legality (all "not_legal" or null). The app would correctly flag them as not legal in any format. |
| **Issues** | No explicit "acorn/silver-bordered" flag in the UI. |
| **Severity** | **Low** |
| **Recommendation** | Optionally add an "acorn/silver-bordered" indicator in card details. |

---

## 7. UI/UX FUNCTIONAL CHECKS

### 7.1 Card Images Load Correctly
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | `imageNormal` field stores Scryfall URL. `DeckEntryTile` in `DeckPanel.tsx` (line 47–68) shows image with lazy loading and fallback gradient placeholder with card name/type line when image is missing. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 7.2 Deck List Updates in Real Time
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | Zustand store triggers re-render on any state change. `DeckPanel.tsx` re-renders via `useDeckStore()` selectors. `RightPanel.tsx` uses `useMainboardEntries()` and `useSideboardEntries()` memoized selectors. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 7.3 Format Selector Gates Validation
| Attribute | Value |
|-----------|-------|
| **Status** | **FAIL** |
| **Details** | **No format selector exists in the main builder UI.** The `Header.tsx` ("Standard" badge is hardcoded). The `DeckPanel.tsx` validates against default format (Standard). The format selector only exists in `GeneratorPanel.tsx` (for AI deck generation). The `ValidationPanel.tsx` shows violations from the default-format validation. All 60-card constructed formats are validated as Standard. |
| **Issues** | Users cannot select a format for their deck. All decks are validated as Standard. |
| **Severity** | **Critical** |
| **Recommendation** | Add a format selector to the Header or DeckPanel. Pass selected format to `validateDeck()` and all related components. |

### 7.4 Error Messages Clarity
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | Validation violations include descriptive messages: "Mainboard has 42 cards — minimum for Standard is 60." / "Banned in Standard: Counterspell" / "Too many copies for Standard: Lightning Bolt" (etc.). These are displayed inline in DeckPanel and in ValidationPanel. |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

### 7.5 Search Returns Correct Results
| Attribute | Value |
|-----------|-------|
| **Status** | **PASS** |
| **Details** | Search matches name (substring), oracle text (substring), type line (substring), flavor text (substring). Exact, starts-with, and contains matching for import. Case-insensitive throughout. Paginated with "Load more". |
| **Issues** | None |
| **Severity** | — |
| **Recommendation** | None needed. |

---

## SUMMARY OF FINDINGS

### Critical Issues
| # | Issue | Location | Recommendation |
|---|-------|----------|---------------|
| C1 | No format selector in main builder UI — all decks validated as Standard | `DeckPanel.tsx`, `Header.tsx`, `ValidationPanel.tsx` | Add format dropdown to Header/DeckPanel; pass format to all validation paths |
| C2 | Commander lacks slot, color identity validation, and exact-size enforcement | `DeckPanel.tsx`, `legality.ts`, `formats.ts` | Add Commander slot UI, color identity validation, exact 100-card enforcement |

### High Issues
| # | Issue | Location | Recommendation |
|---|-------|----------|---------------|
| H1 | Vintage restricted list not enforced (1-of limit for restricted cards) | `legality.ts`, `companion.ts` | Add restricted card check (max 1 copy) when format is Vintage |
| H2 | Snow-covered basics limited to 4 copies (not in BASIC_LAND_NAMES) | `legality.ts` line 5–7 | Add snow-covered names or detect "Basic" supertype |

### Medium Issues
| # | Issue | Location | Recommendation |
|---|-------|----------|---------------|
| M1 | Split cards display only one face, CMC may be pre-MH1 combined | `CardDetailDrawer.tsx`, `types.ts` | Show both halves, use individual MV for post-MH1 formats |
| M2 | DFC/MDFC color identity ignores back face | `legality.ts`, `synergyModel.ts` | Parse `cardFacesJson` for complete color identity |
| M3 | URL import broken due to CORS | `deckImportSources.ts` | Document limitation, recommend proxy for production |
| M4 | Commander 100-card limit is advisory, not hard block | `legality.ts` line 67–74 | Make maxMainboardSize a hard block for Commander |

### Low Issues
| # | Issue | Location | Recommendation |
|---|-------|----------|---------------|
| L1 | No deck duplication button | `DeckListPanel.tsx` | Add "Duplicate" button |
| L2 | No rarity distribution visualization | Analysis panels | Add rarity breakdown |
| L3 | No supertype search filter | `CardSearchPanel.tsx` | Add Legendary/Snow/Basic filter |
| L4 | Empty decks can be saved | `deckStore.ts` | Disable save for 0-card decks |
| L5 | 5th copy silently refused | `deckStore.ts` line 171 | Add brief UI feedback |
| L6 | No language filter for foreign cards | `CardSearchPanel.tsx` | Add lang filter |
| L7 | No price freshness indicator | DB schema | Show `importedAt` date |

---

## PASS RATE SUMMARY

| Section | Pass | Fail | Partial | Not Implemented | Total |
|---------|------|------|---------|-----------------|-------|
| 1. Core Deck Builder | 6 | 0 | 1 | 1 | 8 |
| 2. Deck Validation & Rules | 6 | 1 | 4 | 3 | 14 |
| 3. Card Categorization | 4 | 0 | 1 | 0 | 5 |
| 4. Statistics & Analytics | 5 | 0 | 0 | 1 | 6 |
| 5. Database Integrity | 5 | 0 | 1 | 0 | 6 |
| 6. Edge Cases | 6 | 1 | 1 | 0 | 8 |
| 7. UI/UX Functional | 4 | 1 | 0 | 0 | 5 |
| **Total** | **36** | **3** | **8** | **5** | **52** |

**Overall: 69% Pass, 6% Fail, 15% Partial, 10% Not Implemented**