// Writes the dev manifest: azure-devops-extension.json with azure-devops-extension.dev.json applied on top.
// tfx's --overrides-file appends contributions instead of replacing them, so it cannot rewrite the feature flag's
// featureId ("publisher.extension.contribution"), which changes with the dev extension id. This script does both.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const base = read("azure-devops-extension.json");
const overrides = read("azure-devops-extension.dev.json");
const manifest = { ...base, ...overrides };

const from = `${base.publisher}.${base.id}.`;
const to = `${manifest.publisher}.${manifest.id}.`;
for (const contribution of manifest.contributions) {
  for (const constraint of contribution.constraints ?? []) {
    const id = constraint.properties?.featureId;
    if (id?.startsWith(from)) constraint.properties.featureId = to + id.slice(from.length);
  }
}

const out = path.join(root, "azure-devops-extension.dev.generated.json");
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`dev manifest written to ${path.relative(root, out)}`);
