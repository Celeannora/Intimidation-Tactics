import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildCompetitiveSnapshot,
  mergeMetaSources,
  parseMtgGoldfishDecklists,
  parseMtgGoldfishMeta,
  parseMtgTop8Meta,
  writeRefreshOutputs,
  type ParsedSource,
} from "../../../../scripts/refreshMetaSnapshot";

const goldfishFixture = `
<div class='archetype-tile' id='1'>
  <div class='archetype-tile-description'><div class='archetype-tile-title'><a href="/archetype/standard-izzet-prowess">Izzet Prowess</a></div>
  <div class='manacost-container'><span aria-label='colors: blue red'></span></div><ul><li>Stormchaser's Talent</li><li>Slickshot Show-Off</li></ul></div>
  <div class='archetype-tile-statistics'><div class='archetype-tile-statistic metagame-percentage'><div class='archetype-tile-statistic-value'>20.0%</div></div></div>
</div><main>`;

const top8Fixture = `
<div class=meta_arch align=center>AGGRO 100%</div>
<div><a href="archetype?a=207&amp;meta=50&amp;f=ST">UR Aggro</a><div>20 %</div></div>
</table>`;

describe("refreshMetaSnapshot source parsers", () => {
  it("parses Goldfish archetype share, colours, key cards, and encoded mainboards", () => {
    const parsed = parseMtgGoldfishMeta(goldfishFixture)!;
    expect(parsed.source).toBe("MTGGoldfish");
    expect(parsed.archetypes[0]).toMatchObject({
      name: "Izzet Prowess",
      colors: ["U", "R"],
      metaShare: 0.2,
      keyCards: ["Stormchaser's Talent", "Slickshot Show-Off"],
    });
    const lists = parseMtgGoldfishDecklists(`initializeDeckComponents('a', 'b', "4%20Opt%0A3%20Slickshot%20Show-Off%0Asideboard%0A2%20Negate", '', false);`);
    expect(lists).toEqual([["Opt", "Slickshot Show-Off"]]);
  });

  it("parses MTGTop8 archetype shares and colour-code names", () => {
    const parsed = parseMtgTop8Meta(top8Fixture)!;
    expect(parsed.archetypes).toHaveLength(1);
    expect(parsed.archetypes[0]).toMatchObject({ name: "UR Aggro", colors: ["U", "R"], metaShare: 0.2 });
  });
});

describe("refreshMetaSnapshot merging", () => {
  const sources: ParsedSource[] = [
    {
      source: "MTGGoldfish",
      archetypes: [{
        name: "Izzet Prowess", colors: ["U", "R"], metaShare: 0.6, keyCards: ["Stormchaser's Talent"],
        decklists: [["Stormchaser's Talent", "Opt", "Opt", "Slickshot Show-Off"]],
      }, {
        name: "Mono-Red Aggro", colors: ["R"], metaShare: 0.4, keyCards: ["Heartfire Hero"], decklists: [["Heartfire Hero"]],
      }],
    },
    {
      source: "MTGTop8",
      archetypes: [{
        name: "UR Aggro", colors: ["U", "R"], metaShare: 0.5, keyCards: [], decklists: [],
      }, {
        name: "Mono Red Aggro", colors: ["R"], metaShare: 0.5, keyCards: [], decklists: [],
      }],
    },
  ];

  it("fuzzy-merges colour-compatible archetype names and includes representative card lists", () => {
    const snapshot = mergeMetaSources(sources, "2026-08-13T00:00:00.000Z");
    expect(snapshot.archetypes).toHaveLength(2);
    const izzet = snapshot.archetypes.find((archetype) => archetype.colors.join("") === "UR")!;
    expect(izzet.metaShare).toBeCloseTo(0.55, 4);
    expect(izzet.keyCards).toContain("Stormchaser's Talent");
    expect(izzet.cardNames).toEqual(expect.arrayContaining(["Opt", "Slickshot Show-Off"]));
    expect(snapshot.source).toContain("degraded: 2/3");
  });

  it("derives real inclusion-frequency records from representative decklists", () => {
    const competitive = buildCompetitiveSnapshot(sources, "2026-08-13T00:00:00.000Z");
    const opt = competitive.cards.find((card) => card.name === "Opt")!;
    expect(opt).toMatchObject({ playRate: 0.5, copiesAvg: 2, topDeckPresence: 0.5 });
  });

  it("aborts before writing either output when validateSnapshot rejects the input", () => {
    const directory = mkdtempSync(join(tmpdir(), "meta-refresh-invalid-"));
    const paths = { metaPath: join(directory, "meta.json"), competitivePath: join(directory, "competitive.json") };
    const valid = mergeMetaSources(sources, "2026-08-13T00:00:00.000Z");
    const invalid = { ...valid, archetypes: [] };
    expect(() => writeRefreshOutputs(invalid, buildCompetitiveSnapshot(sources, valid.updatedAt), paths)).toThrow(/Refusing to write invalid/);
    expect(existsSync(paths.metaPath)).toBe(false);
    expect(existsSync(paths.competitivePath)).toBe(false);
  });

  it("writes both files after validation succeeds", () => {
    const directory = mkdtempSync(join(tmpdir(), "meta-refresh-valid-"));
    const paths = { metaPath: join(directory, "meta.json"), competitivePath: join(directory, "competitive.json") };
    const snapshot = mergeMetaSources(sources, "2026-08-13T00:00:00.000Z");
    writeRefreshOutputs(snapshot, buildCompetitiveSnapshot(sources, snapshot.updatedAt), paths);
    expect(JSON.parse(readFileSync(paths.metaPath, "utf8")).archetypes).toHaveLength(2);
  });
});
