// Prepare isolated matching Golfballs builds; does not edit the original theme.
import { cp, mkdir, readFile, writeFile, symlink, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
const repo = process.cwd();
const theme = process.env.THEME_ROOT ?? "/Users/alexrees/Documents/Lazer/Golfballs/golfballs-theme";
const root = process.env.GOLFBALLS_BUILD_ROOT ?? "/tmp/golfballs-validation";
const baseline = process.env.GOLFBALLS_BASELINE_REF ?? "50331f0";
async function sourceHash(root) {
  const hash = createHash("sha256");
  async function walk(dir, prefix = "") {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name),
        name = prefix + entry.name;
      if (entry.isDirectory()) await walk(path, name + "/");
      else if (entry.isFile()) {
        hash.update(name + "\0");
        hash.update(await readFile(path));
      }
    }
  }
  await walk(root);
  return hash.digest("hex");
}
const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const baselineCommit = execFileSync("git", ["rev-parse", baseline], { encoding: "utf8" }).trim();
const themeCommit = execFileSync("git", ["-C", theme, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const candidateDirty = Boolean(
  execFileSync("git", ["status", "--porcelain", "--", "src"], { encoding: "utf8" }).trim(),
);
const themeDirty = Boolean(
  execFileSync("git", ["-C", theme, "status", "--porcelain"], { encoding: "utf8" }).trim(),
);
for (const variant of ["baseline", "candidate"]) {
  const plugin = join(root, variant + "-plugin"),
    checkout = join(root, variant);
  await mkdir(plugin, { recursive: true });
  if (variant === "baseline")
    execFileSync("tar", ["-xf", "-", "-C", plugin], {
      input: execFileSync("git", ["archive", baseline, "src"]),
    });
  else await cp(join(repo, "src"), join(plugin, "src"), { recursive: true });
  await symlink(join(repo, "node_modules"), join(plugin, "node_modules"), "dir").catch((e) => {
    if (e.code !== "EEXIST") throw e;
  });
  const pluginSourceSha256 = await sourceHash(join(plugin, "src"));
  const source = join(plugin, "src/runtime.ts");
  let code = await readFile(source, "utf8");
  code = code.replace(
    "export function revive(payload: RevivePayload): ReviveRuntime {",
    `export function revive(payload: RevivePayload): ReviveRuntime {
  const start = performance.now();
  try { return measuredRevive(payload); }
  finally { (globalThis as any).__golfballsValidation = { setupMs: performance.now() - start, debug: payload.options?.debug ?? false }; }
}
function measuredRevive(payload: RevivePayload): ReviveRuntime {`,
  );
  await writeFile(source, code);
  execFileSync(
    "bun",
    [
      "build",
      join(plugin, "src/index.ts"),
      source,
      "--outdir",
      join(plugin, "dist"),
      "--format",
      "esm",
      "--target",
      "node",
    ],
    { stdio: "pipe" },
  );
  await cp(theme, checkout, {
    recursive: true,
    filter: (path) =>
      ![
        ".git",
        ".cursor",
        ".agents",
        ".claude",
        ".codex",
        "node_modules",
        "coverage",
        "assets",
      ].includes(path.slice(theme.length + 1).split("/")[0]),
  });
  await mkdir(join(checkout, "assets"), { recursive: true });
  await symlink(join(theme, "node_modules"), join(checkout, "node_modules"), "dir").catch((e) => {
    if (e.code !== "EEXIST") throw e;
  });
  const config = join(checkout, "vite.config.js");
  await writeFile(
    config,
    (await readFile(config, "utf8")).replace(
      "from 'vite-plugin-shopify-theme-islands'",
      `from '${resolve(plugin, "dist/index.js")}'`,
    ),
  );
  const build = execFileSync(
    "node",
    ["node_modules/vite/bin/vite.js", "build", "--configLoader", "runner"],
    { cwd: checkout, encoding: "utf8" },
  );
  await writeFile(join(root, variant + "-build.log"), build);
  const manifest = JSON.parse(await readFile(join(checkout, "assets/.vite/manifest.json"), "utf8"));
  const file = manifest["src/entrypoints/theme.ts"].file;
  const metadata = {
    variant,
    pluginCommit: variant === "baseline" ? baselineCommit : candidateCommit,
    themeCommit,
    pluginDirty: variant === "candidate" && candidateDirty,
    themeDirty,
    pluginSourceSha256,
    themeSourceSha256: await sourceHash(join(checkout, "src")),
    bootstrap: {
      file,
      sha256: createHash("sha256")
        .update(await readFile(join(checkout, "assets", file)))
        .digest("hex"),
    },
  };
  await writeFile(join(checkout, "validation-build.json"), JSON.stringify(metadata, null, 2));
  console.log(`${variant}: build complete`);
}
