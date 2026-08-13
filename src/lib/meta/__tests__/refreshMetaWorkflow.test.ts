import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

describe("refresh-meta GitHub Actions workflow", () => {
  it("parses as YAML and keeps both scheduled and manual triggers", () => {
    const path = join((globalThis as unknown as { process: { cwd(): string } }).process.cwd(), ".github", "workflows", "refresh-meta.yml");
    const workflow = load(readFileSync(path, "utf8")) as {
      on?: { schedule?: Array<{ cron?: string }>; workflow_dispatch?: unknown };
      jobs?: Record<string, unknown>;
    };
    expect(workflow.on?.schedule?.some((entry) => entry.cron === "0 6 * * *")).toBe(true);
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.jobs).toHaveProperty("refresh-meta");
  });
});
