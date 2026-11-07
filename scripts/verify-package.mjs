import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const project = resolve(process.argv[2] ?? repo);
const temporary = mkdtempSync(join(tmpdir(), "package-verification-"));
const childEnv = { ...process.env, NODE_COMPILE_CACHE: join(temporary, "node-cache") };
function filesUnder(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? filesUnder(join(directory, entry.name), name + "/") : [name];
  });
}
function targets(value) {
  if (typeof value === "string") return value.startsWith("./") ? [value.slice(2)] : [];
  return value && typeof value === "object" ? Object.values(value).flatMap(targets) : [];
}
try {
  const manifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
  const [pack] = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--offline",
        "--pack-destination",
        temporary,
        "--cache",
        join(temporary, "cache"),
      ],
      { cwd: project, encoding: "utf8", env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  const extracted = join(temporary, "extracted");
  mkdirSync(extracted);
  const tarball = join(temporary, pack.filename);
  execFileSync("tar", ["-xzf", tarball, "-C", extracted]);
  const packed = join(extracted, "package");
  const files = new Set(filesUnder(packed));
  for (const file of [
    ...targets(manifest.exports),
    ...targets(manifest.main),
    ...targets(manifest.types),
    "dist/runtime.js",
  ]) {
    if (!files.has(file)) throw Error(`Missing package file: ${file}`);
  }
  const skills = filesUnder(join(project, "skills")).filter(
    (file) => !file.startsWith("_artifacts/") && !file.startsWith("."),
  );
  if (!skills.some((file) => file.endsWith("/SKILL.md"))) throw Error("No source skills found");
  for (const file of [
    ...filesUnder(join(project, "dist")).map((file) => "dist/" + file),
    ...skills.map((file) => "skills/" + file),
  ]) {
    if (!files.has(file)) throw Error(`Missing package file: ${file}`);
  }
  for (const file of files) {
    if (
      /^(?:\.scratch|\.github|src|tests|scripts|node_modules)\//.test(file) ||
      file.startsWith("skills/_artifacts/")
    )
      throw Error(`Unwanted package file: ${file}`);
  }
  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "package-contract-consumer",
      private: true,
      type: "module",
      intent: { skills: [manifest.name] },
    }),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--cache",
      join(temporary, "cache"),
      tarball,
    ],
    { cwd: consumer, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  // Supply the declared peer from the lockfile; the library itself comes only from the tarball.
  symlinkSync(join(repo, "node_modules/vite"), join(consumer, "node_modules/vite"), "dir");
  writeFileSync(
    join(consumer, "imports.mjs"),
    `
import plugin from ${JSON.stringify(manifest.name)};
import Island from ${JSON.stringify(manifest.name + "/island")};
import { onIslandLoad, onIslandError } from ${JSON.stringify(manifest.name + "/events")};
if (![plugin, Island, onIslandLoad, onIslandError].every(value => typeof value === "function")) throw Error("Invalid public JavaScript exports");
`,
  );
  execFileSync(process.execPath, ["imports.mjs"], {
    cwd: consumer,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  writeFileSync(
    join(consumer, "consumer.ts"),
    `
import plugin from ${JSON.stringify(manifest.name)};
import Island from ${JSON.stringify(manifest.name + "/island")};
import { onIslandLoad, onIslandError } from ${JSON.stringify(manifest.name + "/events")};
import { disconnect, scan, observe, unobserve } from ${JSON.stringify(manifest.name + "/revive")};
plugin();
class Example extends Island(HTMLElement) {}
const offLoad: () => void = onIslandLoad(detail => { const tag: string = detail.tag; const duration: number = detail.duration; const attempt: number = detail.attempt; });
const offError: () => void = onIslandError(detail => { const tag: string = detail.tag; const error: unknown = detail.error; const attempt: number = detail.attempt; });
scan(document.body); observe(document.body); unobserve(document.body); disconnect();
`,
  );
  execFileSync(
    process.execPath,
    [
      join(repo, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--target",
      "ES2020",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--lib",
      "ES2020,DOM",
      "consumer.ts",
    ],
    { cwd: consumer, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  const intentRoot = join(repo, "node_modules/@tanstack/intent");
  const intent = JSON.parse(readFileSync(join(intentRoot, "package.json"), "utf8"));
  const intentBin = resolve(
    intentRoot,
    typeof intent.bin === "string" ? intent.bin : intent.bin.intent,
  );
  const discovery = JSON.parse(
    execFileSync(process.execPath, [intentBin, "list", "--json"], {
      cwd: consumer,
      encoding: "utf8",
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const installed = realpathSync(join(consumer, "node_modules", manifest.name));
  const discovered = new Set(
    discovery.skills
      .filter(
        (skill) =>
          skill.packageName === manifest.name && realpathSync(skill.packageRoot) === installed,
      )
      .map((skill) => skill.use),
  );
  const skillNames = skills
    .filter((file) => file.endsWith("/SKILL.md"))
    .map((file) => file.slice(0, -"/SKILL.md".length));
  for (const name of skillNames) {
    if (!discovered.has(`${manifest.name}#${name}`))
      throw Error(`Missing discovered skill: ${name}`);
  }
  console.log(
    JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      files: files.size,
      skills: skillNames,
      checks: ["contents", "imports", "types", "skill-discovery"],
    }),
  );
} catch (error) {
  console.error(`[test:package] ${error.message}`);
  if (error.stdout) console.error(error.stdout.toString());
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
