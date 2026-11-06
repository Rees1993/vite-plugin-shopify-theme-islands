import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function readPreparedBuild(root, variant) {
  if (!["baseline", "candidate"].includes(variant)) throw Error("Unknown build variant");
  const metadata = JSON.parse(readFileSync(join(root, variant, "validation-build.json"), "utf8"));
  if (
    metadata.variant !== variant ||
    typeof metadata.pluginCommit !== "string" ||
    !metadata.pluginCommit ||
    typeof metadata.themeCommit !== "string" ||
    !metadata.themeCommit ||
    typeof metadata.bootstrap?.file !== "string" ||
    !metadata.bootstrap.file ||
    typeof metadata.bootstrap.sha256 !== "string"
  )
    throw Error("Incomplete prepared build metadata");
  const bytes = readFileSync(join(root, variant, "assets", metadata.bootstrap.file));
  if (createHash("sha256").update(bytes).digest("hex") !== metadata.bootstrap.sha256)
    throw Error("Bootstrap changed since build preparation");
  return metadata;
}

export function assertFlowProvenance({ mode, expected, row }) {
  if (mode === "override") {
    if (
      !expected?.file ||
      !expected?.sha256 ||
      !row?.overrides?.some(
        (response) => response.served === expected.file && response.sha256 === expected.sha256,
      )
    )
      throw Error("Expected bootstrap was not served");
    return;
  }
  if (mode !== "local" || !expected?.url || !expected?.sha256)
    throw Error("Missing runtime provenance expectation");
  if (
    !row?.localModuleResponses?.some(
      (response) =>
        response.url === expected.url &&
        response.sha256 === expected.sha256 &&
        response.status === 200,
    )
  )
    throw Error("Expected local runtime was not served");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
    if (request.mode === "build")
      console.log(JSON.stringify(readPreparedBuild(request.root, request.variant)));
    else {
      assertFlowProvenance(request);
      console.log("Runtime provenance verified");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
