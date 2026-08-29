import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScenarioCoveragePanel } from "../ScenarioCoveragePanel";
import type { DeckScenarioCoverage } from "../../lib/generator/types";

const coverage: DeckScenarioCoverage = {
  coveredCount: 2,
  totalScenarios: 3,
  consistencyScore: 67,
  scenarios: [
    {
      scenarioId: "wide-board",
      scenarioName: "Wide creature board",
      sourceArchetypeNames: [],
      covered: true,
      answeringCards: ["Temporary Lockdown", "Split Up", "Get Lost", "Fourth answer"],
    },
    {
      scenarioId: "prowess",
      scenarioName: "Early noncreature pressure",
      sourceArchetypeNames: ["Izzet Prowess"],
      covered: true,
      answeringCards: ["Torch the Tower"],
    },
    {
      scenarioId: "graveyard",
      scenarioName: "Graveyard recursion",
      sourceArchetypeNames: [],
      covered: false,
      answeringCards: [],
    },
  ],
};

describe("ScenarioCoveragePanel", () => {
  it("renders coverage, gaps, archetype context, and up to three answering cards", () => {
    const html = renderToStaticMarkup(<ScenarioCoveragePanel coverage={coverage} />);

    expect(html).toContain("Scenario coverage");
    expect(html).toContain("2/3 opponent scenarios covered");
    expect(html).toContain("✓ Covered");
    expect(html).toContain("⚠ Gap");
    expect(html).toContain("vs Izzet Prowess");
    expect(html).toContain("Answered by: Temporary Lockdown, Split Up, Get Lost");
    expect(html).not.toContain("Fourth answer");
  });

  it("does not render a source archetype note for canonical scenarios", () => {
    const canonicalOnly: DeckScenarioCoverage = {
      ...coverage,
      scenarios: [coverage.scenarios[0]],
    };

    const html = renderToStaticMarkup(<ScenarioCoveragePanel coverage={canonicalOnly} />);

    expect(html).not.toContain("vs ");
  });
});
