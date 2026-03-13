import { readFileSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  let version;
  let writeGithubOutput = false;

  for (const arg of argv) {
    if (arg === "--github-output") {
      writeGithubOutput = true;
      continue;
    }
    if (version !== undefined) {
      throw new Error("Only one release version can be provided.");
    }
    version = arg;
  }

  if (!version) {
    throw new Error(
      "Usage: node scripts/update-release-package-version.mjs <version> [--github-output]",
    );
  }

  return { version, writeGithubOutput };
}

function writeOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  writeFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, { flag: "a" });
}

const { version, writeGithubOutput } = parseArgs(process.argv.slice(2));
const packageJsonPath = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const changed = packageJson.version !== version;

if (changed) {
  packageJson.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

if (writeGithubOutput) {
  writeOutputs({ changed: String(changed), version });
}

if (changed) {
  console.log(`Updated package.json to version ${version}.`);
} else {
  console.log("package.json already matches release version.");
}
