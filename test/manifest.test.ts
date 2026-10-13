import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

interface Contribution {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  constraints?: { name: string; properties: { featureId: string } }[];
}

const manifest = JSON.parse(readFileSync(join(__dirname, "..", "azure-devops-extension.json"), "utf8")) as {
  id: string;
  publisher: string;
  contributions: Contribution[];
};

describe("feature flag", () => {
  const feature = manifest.contributions.find((c) => c.type === "ms.vss-web.feature")!;

  it("is declared, on by default, and offered on cloud and Server", () => {
    expect(feature).toBeDefined();
    expect(feature.properties.defaultState).toBe(true);
    expect((feature as unknown as { targets: string[] }).targets).toEqual(["ms.vss-web.managed-features", "ms.vss-web.managed-features-onprem"]);
  });

  it("gates every UI contribution", () => {
    const featureId = `${manifest.publisher}.${manifest.id}.${feature.id}`;
    const gated = manifest.contributions.filter((c) => c !== feature);
    expect(gated.length).toBeGreaterThan(0);
    for (const c of gated) {
      expect(c.constraints, c.id).toEqual([{ name: "Feature", properties: { featureId } }]);
    }
  });
});
