<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# do a full analysis and research of what makes a MTG deck mythic viable in a standard competitive format, identify which synergies and calculations each type of deck uses, and begin drafting a plan to be given to an AI coding model (for use with a MTG deck generator project). any questions before proceeding?

Here's the full report — it covers everything from meta analysis through to the tuning spec for your generator.

The report is structured in **9 parts**:

1. **What "Mythic Viable" Actually Means** — the MMR math, ~55–61% win rate threshold, and the three pillars (consistency, redundancy, meta positioning)
2. **Universal Construction Mathematics** — Rule of 9, Frank Karsten's hypergeometric mana model, curve targets by archetype, hypergeometric draw probability table, sideboard theory
3. **Core Strategic Concepts** — Tempo, card advantage, and threat/interaction ratio by archetype
4. **Archetype-by-Archetype Analysis** — Aggro, Midrange, Control, Combo (with Vivi/Cauldron as the live case study), Delirium/Graveyard, Tempo, and Tokens — each with a breakdown of **why specific cards are chosen**, not just what they are
5. **Card Role Taxonomy** — A full tagging system (Threat, Engine, Enabler, Payoff, Finisher, etc.) plus secondary oracle-text tags (evasive, flexible, two_for_one, graveyard_filling, etc.)
6. **Why Cards Are Chosen Across Rotations** — The 5-axis evaluation model + keyword value matrix by archetype, designed so the generator generalizes to new sets
7. **AI Generator Tuning Spec** — Role-first slot budgets, hard constraint pseudocode, synergy pair scoring heuristics, and a new set onboarding pipeline
8. **Archetype Decision Tree** — Entry-point logic for inferring archetype from user input
9. **Quick Reference Synergy Table** — All archetypes summarized by trigger condition and payoff

The key design principle running through the spec: the generator should learn **archetype structure** (roles, ratios, axes) so it can assign new cards to proven functional slots automatically, rather than depending on historical popularity data that won't exist for future releases.
<span style="display:none">[^1][^10][^100][^101][^102][^103][^104][^105][^106][^107][^108][^109][^11][^110][^111][^112][^113][^114][^115][^116][^117][^118][^119][^12][^120][^121][^122][^123][^124][^125][^126][^127][^128][^129][^13][^130][^131][^132][^133][^134][^135][^136][^137][^138][^139][^14][^140][^141][^142][^143][^144][^145][^15][^16][^17][^18][^19][^2][^20][^21][^22][^23][^24][^25][^26][^27][^28][^29][^3][^30][^31][^32][^33][^34][^35][^36][^37][^38][^39][^4][^40][^41][^42][^43][^44][^45][^46][^47][^48][^49][^5][^50][^51][^52][^53][^54][^55][^56][^57][^58][^59][^6][^60][^61][^62][^63][^64][^65][^66][^67][^68][^69][^7][^70][^71][^72][^73][^74][^75][^76][^77][^78][^79][^8][^80][^81][^82][^83][^84][^85][^86][^87][^88][^89][^9][^90][^91][^92][^93][^94][^95][^96][^97][^98][^99]</span>

<div align="center">⁂</div>

[^1]: https://hareeb.com/2023/12/11/update-to-the-mtg-arena-mythic-ranking-system/

[^2]: https://hareeb.com/2021/05/23/inside-the-mtg-arena-rating-system/

[^3]: https://draftsim.com/mtg-arena-mythic-percentage/

[^4]: https://www.metamages.com/sessions/e5dcfde5-62d2-4bb4-8e6b-4fcb7db6349a

[^5]: https://www.youtube.com/watch?v=NntfDQEoJ_k

[^6]: https://manabuilder.com/how-to-build-a-deck

[^7]: https://www.scribd.com/document/247928941/128633-How-to-Build-Better-Decks

[^8]: https://magicthegatheringauthority.com/deck-archetypes-aggro-control-combo-midrange/

[^9]: https://mtg.fandom.com/wiki/Card_advantage

[^10]: https://www.mtgsalvation.com/userblogs/godofallu-blog/14331-card-advantage-and-engines

[^11]: http://wxhsbl.com/ckfinder/userfiles/files/20250324_182225.pdf

[^12]: https://www.gameslearningsociety.org/how-many-of-each-type-of-card-should-i-have-in-a-mtg-deck/

[^13]: https://scrollvault.net/guides/mana-bases.html

[^14]: https://scrollvault.net/tools/manabase/

[^15]: https://www.fantasystandard.net/levelups/color-distribution

[^16]: https://mtg.fandom.com/wiki/Mana_curve

[^17]: https://www.youtube.com/watch?v=Bf6MYyOojBw

[^18]: https://mtg.fandom.com/wiki/Tempo

[^19]: https://mtgdecks.net/Standard

[^20]: https://www.mtggrinders.com/blog/KW27_Standard

[^21]: https://mtgrocks.com/untouched-standard-powerhouse-is-becoming-an-unsolvable-problem/

[^22]: https://goatarmor.com/blogs/resources/how-to-build-your-first-magic-the-gathering-deck-beginner-s-guide

[^23]: https://www.pcgamesn.com/magic-the-gathering-arena/keywords-abilities

[^24]: https://boltthebirdmtg.com/how-to-build-a-competitive-mtg-deck-part-three-midrange/

[^25]: https://mtga.untapped.gg/constructed/standard/archetypes/511/dimir-midrange

[^26]: https://www.reddit.com/r/spikes/comments/1ey8naj/standard_what_is_the_current_consensus_on_the/

[^27]: https://mtgdecks.net/Standard/dimir-midrange

[^28]: https://www.youtube.com/watch?v=4gzf3-p0bNM

[^29]: https://cardgamebase.com/mtg-delirium-rules/

[^30]: https://draftsim.com/mtg-delirium/

[^31]: https://mtg.cardsrealm.com/it-it/articles/standard-gruul-delirium-deck-tech-and-sideboard-guide

[^32]: https://tappedout.net/mtg-questions/soi-delirium-mechanic/

[^33]: https://boltthebirdmtg.com/how-to-build-a-competitive-mtg-deck-part-two-tempo/

[^34]: https://mtg.fandom.com/wiki/Flash

[^35]: https://www.magic.gg/news/metagame-mentor-the-top-fifteen-standard-decks-in-february-2026

[^36]: https://mtg.fandom.com/wiki/Lifelink

[^37]: https://github.com/reecevela/cardcognition

[^38]: https://www.cloudfallstudios.com/blog/2019/1/27/the-deck-archetype-spectrum

[^39]: https://www.reddit.com/r/mtgcube/comments/1fkzfhm/balancing_selfcontained_good_cards_vs_synergy/

[^40]: https://github.com/georgejieh/mtg_ai_deck_builder

[^41]: https://www.manatap.ai

[^42]: https://www.youtube.com/watch?v=5AfOoge0Z8I

[^43]: https://draftsim.com/mtg-standard/

[^44]: https://mtgazone.com/standard-bo1-metagame-tier-list/

[^45]: https://www.youtube.com/watch?v=3jised9wdlk

[^46]: https://www.mtgo.com/decklists

[^47]: https://www.youtube.com/watch?v=X8ox9XBv2CQ

[^48]: https://aetherhub.com/MTGA-Decks/Standard-BO1/

[^49]: https://mtga.untapped.gg/constructed/standard/meta

[^50]: https://www.mtgo.com/decklist/standard-league-2026-06-1110660

[^51]: https://www.youtube.com/watch?v=CtVv9-jwqh4

[^52]: https://magic.gg/decklists/traditional-standard-ranked-decklists-april-27-2026

[^53]: https://www.youtube.com/watch?v=Ft05FM0MBZA

[^54]: https://magic.gg/decklists/traditional-standard-ranked-decklists-may-25-2026

[^55]: https://www.youtube.com/watch?v=2pfClVglEwQ

[^56]: https://magicthegatheringauthority.com/deck-building-fundamentals/

[^57]: https://www.answers.com/toys-and-games/What-is-the-standard-mtg-deck-ratio-for-lands-to-spells

[^58]: https://mtgetsy.com/beginner-guide-competitive-mtg-standard-deck/

[^59]: https://www.mtgsalvation.com/forums/the-game/standard-type-2/deck-creation-standard/128633-how-to-build-better-decks

[^60]: https://www.youtube.com/watch?v=xCWlRrd9d-Y

[^61]: https://www.facebook.com/groups/magicarenamtg/posts/941487513160584/

[^62]: https://www.tcgplayer.com/content/article/Dimir-Midrange-Standard-MTG-Deck-Guide-Card-Choices-Sideboarding-and-More/8eec2696-c570-4792-9366-0d6ccad96e73/

[^63]: https://www.youtube.com/watch?v=-icO7UQ4fKA

[^64]: https://www.usmtgproxy.com/2026/03/02/dimir-midrange-standard-mtg-deck-guide-card-choices-sideboarding-and-more/

[^65]: https://mtgdecks.net/guides/standard-izzet-cauldron-ultimate-guide-post-bans-mtg-367

[^66]: https://riwhobbies.com/dimiir-midrange-in-standard/

[^67]: https://www.youtube.com/watch?v=8RHhpPhLUx8

[^68]: https://www.reddit.com/r/spikes/comments/1mjeg68/standard_izzet_cauldron_postrotation_guide_by_ale/

[^69]: https://www.youtube.com/watch?v=6lvlUe8bgKM

[^70]: https://www.youtube.com/watch?v=zTYzEJlNmX8

[^71]: https://www.youtube.com/watch?v=CO03M-tyLx4

[^72]: https://mtgdecks.net/guides/standard-dimir-midrange-deck-tech-sideboard-guide-mtg-387

[^73]: https://www.youtube.com/watch?v=dO_DQ-WDxyA

[^74]: https://magicthegatheringauthority.com/card-advantage-and-tempo/

[^75]: https://app.deckbrain.io

[^76]: https://magic.gg/news/the-standard-win-rates-and-spiciest-decks-at-mythic-championship-vi

[^77]: https://www.youtube.com/watch?v=DzuhDnRP9EE

[^78]: https://spellweave.app

[^79]: https://savecraft.gg/magic

[^80]: https://www.mtgnexus.com/viewtopic.php?t=141676

[^81]: http://mtgcube.blogspot.com/2018/04/why-is-tempo-so-crucial.html

[^82]: https://www.youtube.com/watch?v=pPjTbYGZLgI

[^83]: https://www.metamages.com/mana

[^84]: https://www.facebook.com/groups/magicarenamtg/posts/1403367543639243/

[^85]: https://www.gopathtomillions.com/p/magic-gathering-mana-curve-calculator.html?m=1

[^86]: https://mtg-agents.com/ai-deck-builder

[^87]: https://bonney.github.io/MTG-Land-Calculator/

[^88]: https://manabuilder.com

[^89]: https://www.youtube.com/watch?v=-oHXgHZpbGU

[^90]: https://www.instagram.com/reel/DMc_7vfRkdy/

[^91]: https://mtgazone.com/historic-rakdos-delirium/

[^92]: https://medium.com/data-science/finding-magic-the-gathering-archetypes-with-latent-dirichlet-allocation-729112d324a6

[^93]: https://mtga.untapped.gg/it/codex/mechanics/delirium

[^94]: https://www.hipstersofthecoast.com/2022/07/delirium-pioneerens/

[^95]: https://www.youtube.com/watch?v=sFrPkmrdEjU

[^96]: https://www.mtgsalvation.com/forums/the-game/limited-sealed-draft/686236-delirium-primer

[^97]: https://www.magic.gg/news/metagame-mentor-izzet-cauldron-in-edge-of-eternities-standard

[^98]: https://www.fanfinity.gg/blog/cracking-the-cauldron-taking-down-the-boogeyman-of-standard/

[^99]: https://www.reddit.com/r/spikes/comments/1mu61bi/standard_izzet_vivi_cauldron_best_build_for_an/

[^100]: https://www.youtube.com/watch?v=0eKdMv5xw4Q

[^101]: https://www.reddit.com/r/magicTCG/comments/1msa4ql/metagame_mentor_izzet_cauldron_in_edge_of/

[^102]: https://www.mtggoldfish.com/archetype/standard-izzet-cauldron-combo-mid/decks

[^103]: https://mtg.cardsrealm.com/en-us/articles/standard-updating-the-decks-that-survive-rotation

[^104]: https://www.youtube.com/watch?v=1Mv6ct6_1ew

[^105]: https://mtg.cardsrealm.com/en-us/articles/metagame-standard-beyond-izzet-cauldron

[^106]: https://aetherhub.com/Article/MTG-Arena-ranking-system-and-how-it-works

[^107]: https://mtgazone.com/metagame/standard/

[^108]: https://hareeb.com/2022/07/08/the-five-mtg-arena-rankings/

[^109]: https://www.youtube.com/watch?v=CQL_w_sgAhc

[^110]: https://mtg-arena.work/best-standard-decks-meta-review-june-2026-sos-week-6-mtg-arena/

[^111]: https://www.reddit.com/r/spikes/comments/1o7a1mu/how_good_is_getting_to_mythic_on_arena_standard/

[^112]: https://magic.gg/news/metagame-mentor-top-standard-decks-for-spotlight-planetary-rotation

[^113]: https://www.reddit.com/r/MagicArena/comments/ajhemq/what_does_the_mythic_rank_percentage_mean/

[^114]: https://danfelder.net/2017/03/13/push-the-enablers-not-the-threats/

[^115]: https://www.mtgsalvation.com/articles/15289-cube-design-philosophy

[^116]: https://arcmind.cards

[^117]: https://sites.google.com/view/mtglimitedtoolbox/whats-the-pick

[^118]: https://mtg.cardsrealm.com/en-au/articles/limited-guide-draft-how-it-works-and-how-to-build-decks-archetypes

[^119]: https://spelltrace.app

[^120]: https://www.mtgsalvation.com/articles/16162-magic-theory-from-the-ground-up-part-vii

[^121]: https://www.mtgsalvation.com/forums/magic-fundamentals/custom-card-creation/515963-theory-set-design-for-draft-archetypes

[^122]: https://tappedout.net/mtg-articles/2014/mar/18/pandoras-deckbox-efficiency-and-deck-strength/

[^123]: https://brainstormbrewery.com/unified-theory-of-commander-threats/

[^124]: https://ia902307.us.archive.org/31/items/magic-deck-archetypes-and-strategies-2021/Magic Deck Archetypes and Strategies 2021.pdf

[^125]: https://www.reddit.com/r/EDH/comments/15bpqc4/find_out_the_power_level_of_your_deck_using_this/

[^126]: https://mtg.cardsrealm.com/en-us/articles/commander-deckbuilding-how-to-evaluate-a-card

[^127]: https://www.youtube.com/watch?v=y-5pLvmx6no

[^128]: https://production.matthewmarks.com/deck-power-level-calculator/

[^129]: https://mtgedh.com/how-to-build-a-commander-deck-in-mtg-without-cutting-lands-first/

[^130]: https://grand-screen.com/tcg/mtg/magic-arena-deck-builder-guide/

[^131]: https://spellweave.app/guides

[^132]: https://www.facebook.com/groups/magicthegatheringcommander/posts/3222515464589222/

[^133]: https://magicthegatheringauthority.com/mtg-deck-building-recreational-creativity/

[^134]: https://www.reddit.com/r/EDH/comments/1kh3gco/command_zone_deck_template_category_help_enablers/

[^135]: https://grimdeck.com/blog/how-to-organize-mtg-collection-for-deck-building

[^136]: https://www.reddit.com/r/magicTCG/comments/11f9nb7/competitive_deck_building_guide_how_to_build/

[^137]: https://www.youtube.com/watch?v=PqO3o-yQL5w

[^138]: https://www.reddit.com/r/magicTCG/comments/gfilmp/four_tenets_of_competitive_deckbuilding_an_how/

[^139]: https://www.reddit.com/r/lrcast/comments/2hf9jz/what_counts_as_a_card_that_affects_the_board/

[^140]: https://www.youtube.com/watch?v=y4e3Gqpzmlg

[^141]: https://www.youtube.com/watch?v=n4PF8iR602g

[^142]: https://riptidelab.com/forum/threads/decks-not-cards-synergy-and-power-design.1741/

[^143]: https://mtg.fandom.com/wiki/Keyword_ability

[^144]: https://www.youtube.com/watch?v=PaCfmOTPzS8

[^145]: https://magic.gg/news/metagame-mentor-the-top-fifteen-standard-decks-in-february-2026

