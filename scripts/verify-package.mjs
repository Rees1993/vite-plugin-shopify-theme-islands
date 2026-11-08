import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(process.argv[2] ?? fileURLToPath(new URL("../", import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), "package-inventory-"));

function filesUnder(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? filesUnder(join(directory, entry.name), name + "/") : [name];
  });
}

try {
  const [pack] = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts", "--offline", "--cache", temporary],
      {
        cwd: project,
        encoding: "utf8",
        timeout: 30000,
        env: { ...process.env, NODE_COMPILE_CACHE: join(temporary, "node-cache") },
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  const files = new Set(pack.files.map((file) => file.path));
  const skills = filesUnder(join(project, "skills")).filter(
    (file) => !file.startsWith("_artifacts/") && !file.startsWith("."),
  );
  if (!skills.some((file) => file.endsWith("/SKILL.md"))) throw Error("No source skills found");
  const required = [
    "dist/runtime.js",
    ...filesUnder(join(project, "dist")).map((file) => "dist/" + file),
    ...skills.map((file) => "skills/" + file),
  ];
  for (const file of required) {
    if (!files.has(file)) throw Error(`Missing package file: ${file}`);
  }
  for (const file of files) {
    if (
      /^(?:\.scratch|\.github|src|tests|scripts|node_modules)\//.test(file) ||
      file.startsWith("skills/_artifacts/")
    ) {
      throw Error(`Unwanted package file: ${file}`);
    }
  }
  console.log(`Package inventory passed (${files.size} files).`);
} catch (error) {
  console.error(`[test:package] ${error.message}`);
  if (error.stderr) console.error(error.stderr.toString());
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
