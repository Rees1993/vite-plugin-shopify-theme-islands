import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
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
import { publint } from "publint";
import { formatMessage } from "publint/utils";

const repo = fileURLToPath(new URL("../", import.meta.url));
const project = resolve(process.argv[2] ?? repo);
const temporary = mkdtempSync(join(tmpdir(), "package-verification-"));
const cache = join(temporary, "cache");
const childEnv = { ...process.env, NODE_COMPILE_CACHE: join(temporary, "node-cache") };

function run(stage, command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
    throw Error(
      `${stage} failed (${error.status ?? error.code ?? error.message})${details ? "\n" + details : ""}`,
    );
  }
}

function filesUnder(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? filesUnder(join(directory, entry.name), name + "/") : [name];
  });
}

function packPackage() {
  const [pack] = JSON.parse(
    run(
      "Pack package",
      "npm",
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--offline",
        "--pack-destination",
        temporary,
        "--cache",
        cache,
      ],
      project,
    ),
  );
  return {
    tarball: join(temporary, pack.filename),
    files: new Set(pack.files.map((file) => file.path)),
  };
}

function verifyContents(files) {
  const skills = filesUnder(join(project, "skills")).filter(
    (file) => !file.startsWith("_artifacts/") && !file.startsWith("."),
  );
  const skillNames = skills
    .filter((file) => file.endsWith("/SKILL.md"))
    .map((file) => file.slice(0, -"/SKILL.md".length));
  if (!skillNames.length) throw Error("No source skills found");
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
  return skillNames;
}

function installConsumer(tarball, name) {
  const consumer = join(temporary, "consumer");
  cpSync(join(repo, "scripts/fixtures/package-consumer"), consumer, { recursive: true });
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "package-contract-consumer",
      private: true,
      type: "module",
      intent: { skills: [name] },
    }),
  );
  run(
    "Install consumer",
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
      cache,
      tarball,
    ],
    consumer,
  );
  // Only the peer uses the checkout; the library comes from the installed tarball.
  symlinkSync(join(repo, "node_modules/vite"), join(consumer, "node_modules/vite"), "dir");
  return consumer;
}

async function verifyMetadata(installed) {
  const { messages, pkg } = await publint({ pkgDir: installed, pack: false, strict: true });
  const errors = messages.filter((message) => message.type === "error");
  if (errors.length)
    throw Error(
      `Package metadata failed\n${errors.map((message) => formatMessage(message, pkg)).join("\n")}`,
    );
}

function verifyConsumer(consumer) {
  run("Import consumer", process.execPath, ["imports.mjs"], consumer);
  run(
    "Typecheck consumer",
    process.execPath,
    [join(repo, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    consumer,
  );
}

function verifySkills(consumer, installed, name, skillNames) {
  const intentRoot = join(repo, "node_modules/@tanstack/intent");
  const intent = JSON.parse(readFileSync(join(intentRoot, "package.json"), "utf8"));
  const intentBin = resolve(
    intentRoot,
    typeof intent.bin === "string" ? intent.bin : intent.bin.intent,
  );
  const discovery = JSON.parse(
    run("Discover skills", process.execPath, [intentBin, "list", "--json"], consumer),
  );
  const discovered = new Set(
    discovery.skills
      .filter(
        (skill) =>
          skill.packageName === name && realpathSync(skill.packageRoot) === realpathSync(installed),
      )
      .map((skill) => skill.use),
  );
  for (const skill of skillNames) {
    if (!discovered.has(`${name}#${skill}`)) throw Error(`Missing discovered skill: ${skill}`);
  }
}

try {
  const manifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
  const { tarball, files } = packPackage();
  const skills = verifyContents(files);
  const consumer = installConsumer(tarball, manifest.name);
  const installed = join(consumer, "node_modules", manifest.name);
  await verifyMetadata(installed);
  verifyConsumer(consumer);
  verifySkills(consumer, installed, manifest.name, skills);
  console.log(
    JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      files: files.size,
      skills,
      checks: ["contents", "imports", "types", "skill-discovery"],
    }),
  );
} catch (error) {
  console.error(`[test:package] ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
