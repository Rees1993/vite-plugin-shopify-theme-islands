import { DEFAULT_DIRECTIVES, type ReviveOptions } from "./contract.js";
import type {
  ClientDirectiveDefinition,
  DirectivesConfig,
  ShopifyThemeIslandsOptions,
} from "./options.js";

const PREFIX = "[vite-plugin-shopify-theme-islands]";

export interface ResolvedThemeIslandsPolicy {
  plugin: {
    directives: DirectivesConfig;
    customDirectives: ClientDirectiveDefinition[];
    debug: boolean;
  };
  runtime: ReviveOptions;
}

function mergeDirectives(directives?: DirectivesConfig): DirectivesConfig {
  return {
    visible: { ...DEFAULT_DIRECTIVES.visible, ...directives?.visible },
    idle: { ...DEFAULT_DIRECTIVES.idle, ...directives?.idle },
    media: { ...DEFAULT_DIRECTIVES.media, ...directives?.media },
    defer: { ...DEFAULT_DIRECTIVES.defer, ...directives?.defer },
    interaction: { ...DEFAULT_DIRECTIVES.interaction, ...directives?.interaction },
  };
}

function validateOptions(options: ShopifyThemeIslandsOptions, directives: DirectivesConfig): void {
  const customDefs = options.directives?.custom ?? [];
  if (Array.isArray(options.directories) && options.directories.length === 0) {
    throw new Error(`${PREFIX} "directories" must not be empty`);
  }

  const threshold = options.directives?.visible?.threshold;
  if (threshold !== undefined && (threshold < 0 || threshold > 1)) {
    throw new Error(
      `${PREFIX} "directives.visible.threshold" must be between 0 and 1, got ${threshold}`,
    );
  }

  if (options.retry !== undefined) {
    const { retries, delay } = options.retry;
    if (retries !== undefined && retries < 0) {
      throw new Error(`${PREFIX} "retry.retries" must be >= 0, got ${retries}`);
    }
    if (delay !== undefined && delay < 0) {
      throw new Error(`${PREFIX} "retry.delay" must be >= 0, got ${delay}`);
    }
  }

  const builtinAttributes = new Set([
    directives.visible!.attribute!,
    directives.idle!.attribute!,
    directives.media!.attribute!,
    directives.defer!.attribute!,
    directives.interaction!.attribute!,
  ]);
  const seen = new Set<string>();
  for (const def of customDefs) {
    if (seen.has(def.name)) {
      throw new Error(`${PREFIX} Duplicate custom directive name: "${def.name}"`);
    }
    if (builtinAttributes.has(def.name)) {
      throw new Error(
        `${PREFIX} Custom directive "${def.name}" conflicts with a built-in directive`,
      );
    }
    seen.add(def.name);
  }
}

export function resolveThemeIslandsPolicy(
  options: ShopifyThemeIslandsOptions = {},
): ResolvedThemeIslandsPolicy {
  const directives = mergeDirectives(options.directives);
  validateOptions(options, directives);

  const customDirectives = options.directives?.custom ?? [];
  const debug = options.debug ?? false;
  const runtime: ReviveOptions = {
    directives,
    debug,
    ...(options.retry !== undefined ? { retry: options.retry } : {}),
    ...(options.directiveTimeout !== undefined
      ? { directiveTimeout: options.directiveTimeout }
      : {}),
  };

  return {
    plugin: {
      directives,
      customDirectives,
      debug,
    },
    runtime,
  };
}
