import { describe, expect, it } from "vitest";
import { exportCSV, type ExportDeck } from "../deckExporter";
import type { CardRecord } from "../types";

function deck(name: string, setCode = "TST", collectorNumber = "1"): ExportDeck {
  return {
    name: "Test", sideboard: [],
    mainboard: [{ quantity: 4, card: { name, setCode, collectorNumber, priceUsd: 1.25 } as CardRecord }],
  };
}

describe("spreadsheet-safe CSV", () => {
  it.each(["=1+1", "+1+1", "-1+1", "@SUM(1)", " \t=1+1", "\r=1+1", "\n=1+1", "\ttext", "\rtext", "\ntext", "\u0000=1+1"])(
    "neutralizes formula-like text %j in every string field on both boards", (value) => {
      const data = deck(value, value, value);
      data.sideboard = [...data.mainboard];
      const csv = exportCSV(data);
      const safe = `"'${value.replaceAll('"', '""')}"`;
      expect(csv).toContain(`${safe},4,main,${safe},${safe},1.25`);
      expect(csv).toContain(`${safe},4,side,${safe},${safe},1.25`);
      expect(data.mainboard[0].card.name).toBe(value);
    },
  );

  it("escapes quotes, commas and newlines as a single field", () => {
    expect(exportCSV(deck('A "quoted",\ncard', 'a,b', 'x"y'))).toBe(
      'name,quantity,board,setCode,collectorNumber,priceUsd\n"A ""quoted"",\ncard",4,main,"a,b","x""y",1.25',
    );
  });

  it("keeps ordinary values readable and absent metadata empty", () => {
    const data = deck("Island");
    data.mainboard[0].card.collectorNumber = null;
    data.mainboard[0].card.priceUsd = null;
    expect(exportCSV(data)).toBe('name,quantity,board,setCode,collectorNumber,priceUsd\nIsland,4,main,TST,,');
  });
});
