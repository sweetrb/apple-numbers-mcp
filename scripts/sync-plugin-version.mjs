import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageJson = readJson("package.json");
const version = packageJson.version;

// --check: verify every manifest version this script would write already
// matches package.json's version. Writes nothing; exit 0 silent when all
// match, exit 1 listing mismatches. Used by CI ("Verify plugin manifests
// match package.json version").
const checkMode = process.argv.includes("--check");
const mismatches = [];

updateJson(".claude-plugin/plugin.json", (data) => {
  data.version = version;
});

updateJson("codex/.codex-plugin/plugin.json", (data) => {
  data.version = version;
});

updateJson(".claude-plugin/marketplace.json", (data) => {
  data.version = version;
  for (const plugin of data.plugins ?? []) {
    if (plugin.name === "apple-numbers") {
      plugin.version = version;
    }
  }
});

updateJson(".agents/plugins/marketplace.json", (data) => {
  for (const plugin of data.plugins ?? []) {
    if (plugin.name === "apple-numbers") {
      plugin.version = version;
    }
  }
});

updateJson(".antigravity-plugin/plugin.json", (data) => {
  data.version = version;
});

updateJson(".antigravity-plugin/marketplace.json", (data) => {
  for (const plugin of data.plugins ?? []) {
    if (plugin.name === "apple-numbers") {
      plugin.version = version;
    }
  }
});

if (checkMode && mismatches.length > 0) {
  console.error(`Plugin manifest version mismatch (package.json is ${version}):`);
  for (const mismatch of mismatches) {
    console.error(`  ${mismatch}`);
  }
  console.error("Fix with: node scripts/sync-plugin-version.mjs");
  process.exit(1);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function updateJson(relativePath, update) {
  const fullPath = path.join(root, relativePath);
  const data = readJson(relativePath);
  if (checkMode) {
    const updated = structuredClone(data);
    update(updated);
    if (JSON.stringify(updated) !== JSON.stringify(data)) {
      const found =
        data.version ?? (data.plugins ?? []).map((p) => p.version).join(", ");
      mismatches.push(`${relativePath}: has ${found}, expected ${version}`);
    }
    return;
  }
  update(data);
  fs.writeFileSync(fullPath, `${JSON.stringify(data, null, 2)}\n`);
}
