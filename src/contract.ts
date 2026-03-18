/**
 * Plugin ↔ Runtime contract (deep module).
 *
 * Single source of truth for the payload shape, key→tag derivation, validation,
 * and optional serialization. Plugin and runtime both depend on this module in-process.
 */

// ---------------------------------------------------------------------------
// 1. Core payload and options (single source of truth)
// ---------------------------------------------------------------------------

/** Loader function for one island chunk. */
export type IslandLoader = () => Promise<unknown>;

/** Directive config for the runtime (built-in + no plugin-only `custom` entrypoints). */
export interface RuntimeDirectivesConfig {
  visible?: { attribute?: string; rootMargin?: string; threshold?: number };
  idle?: { attribute?: string; timeout?: number };
  media?: { attribute?: string };
  defer?: { attribute?: string; delay?: number };
  interaction?: { attribute?: string; events?: string[] };
}

/** Retry configuration. */
export interface RetryConfig {
  retries?: number;
  delay?: number;
}

/** Options passed from plugin to runtime (subset of plugin options). */
export interface ReviveOptions {
  directives?: RuntimeDirectivesConfig;
  debug?: boolean;
  retry?: RetryConfig;
}

/** Custom directive function at runtime (load, opts, element). */
export type ClientDirective = (
  load: () => Promise<void>,
  options: { name: string; value: string },
  el: HTMLElement,
) => void | Promise<void>;

/** Event detail for the `islands:load` DOM event. */
export interface IslandLoadDetail {
  /** The custom element tag name, e.g. `'product-form'` */
  tag: string;
  /** Milliseconds from directive resolution to successful module load (chunk fetch time). */
  duration: number;
  /** Which attempt succeeded. 1 = first try, 2 = first retry, etc. */
  attempt: number;
}

/** Event detail for the `islands:error` DOM event. */
export interface IslandErrorDetail {
  /** The custom element tag name, e.g. `'product-form'` */
  tag: string;
  /** The error thrown by the loader or custom directive */
  error: unknown;
  /** Which attempt failed. 1 = initial attempt, 2 = first retry, etc. */
  attempt: number;
}

declare global {
  interface DocumentEventMap {
    "islands:load": CustomEvent<IslandLoadDetail>;
    "islands:error": CustomEvent<IslandErrorDetail>;
  }
}

/**
 * Payload the plugin emits and the runtime consumes.
 * Islands: glob key → loader (e.g. "/frontend/js/islands/product-form.ts" → loader).
 * Custom directives: attribute name → directive implementation (resolved at build).
 * Options may be partial; runtime uses normalizeReviveOptions() to fill defaults.
 */
export interface RevivePayload {
  islands: Record<string, IslandLoader>;
  options?: ReviveOptions;
  customDirectives?: Map<string, ClientDirective>;
}

// ---------------------------------------------------------------------------
// 2. Options normalization (single source of defaults)
// ---------------------------------------------------------------------------

/** Fully resolved options; all directive and retry fields have defaults applied. */
export interface NormalizedReviveOptions {
  directives: {
    visible: { attribute: string; rootMargin: string; threshold: number };
    idle: { attribute: string; timeout: number };
    media: { attribute: string };
    defer: { attribute: string; delay: number };
    interaction: { attribute: string; events: string[] };
  };
  debug: boolean;
  retry: { retries: number; delay: number };
}

/** Default directive config. Single source of truth for plugin merge and runtime normalization. */
export const DEFAULT_DIRECTIVES: NormalizedReviveOptions["directives"] = {
  visible: { attribute: "client:visible", rootMargin: "200px", threshold: 0 },
  idle: { attribute: "client:idle", timeout: 500 },
  media: { attribute: "client:media" },
  defer: { attribute: "client:defer", delay: 3000 },
  interaction: {
    attribute: "client:interaction",
    events: ["mouseenter", "touchstart", "focusin"],
  },
};

const DEFAULT_RETRY = { retries: 0, delay: 1000 };

/**
 * Applies default values for all runtime options.
 * Single source of truth so plugin and runtime do not duplicate defaults.
 */
export function normalizeReviveOptions(options?: ReviveOptions): NormalizedReviveOptions {
  const d = DEFAULT_DIRECTIVES;
  const r = DEFAULT_RETRY;
  const dir = options?.directives;
  return {
    directives: {
      visible: { ...d.visible, ...dir?.visible },
      idle: { ...d.idle, ...dir?.idle },
      media: { ...d.media, ...dir?.media },
      defer: { ...d.defer, ...dir?.defer },
      interaction: { ...d.interaction, ...dir?.interaction },
    },
    debug: options?.debug ?? false,
    retry: { ...r, ...options?.retry },
  };
}

// ---------------------------------------------------------------------------
// 3. Key → tag strategy (pluggable)
// ---------------------------------------------------------------------------

export type KeyToTagResult = { tag: string; skip?: boolean };

/**
 * Maps a glob key (e.g. "/frontend/js/islands/product-form.ts") to a custom element tag.
 * Return { tag, skip: true } to exclude this entry from the island map.
 */
export type KeyToTagFn = (key: string) => KeyToTagResult;

/** Default: last path segment, extension stripped; skip (and warn) when tag has no hyphen. */
export function defaultKeyToTag(key: string): KeyToTagResult {
  const filename = key.split("/").pop() ?? key;
  const tag = filename.replace(/\.(ts|js)$/, "");
  const skip = !tag.includes("-");
  if (skip && tag)
    console.warn(
      `[islands] Skipping "${filename}" — filename must contain a hyphen to match a valid custom element tag (e.g. rename to "${tag}-island.ts")`,
    );
  return { tag, skip };
}

// ---------------------------------------------------------------------------
// 4. Optional validation
// ---------------------------------------------------------------------------

export type ValidateTagFn = (tag: string, key: string) => void | never;

/** No-op validator (no throw). */
export const noValidateTag: ValidateTagFn = () => {};

/** Optional strict validator: throws if tag has no hyphen (keyToTag skip already handles warn+skip). */
export function defaultValidateTag(tag: string, key: string): void {
  if (tag.includes("-")) return;
  const filename = key.split("/").pop() ?? key;
  throw new Error(
    `[islands] Invalid tag from "${filename}" — filename must contain a hyphen for a valid custom element tag (e.g. rename to "${tag}-island.ts")`,
  );
}

// ---------------------------------------------------------------------------
// 5. Strategies bundle (optional extension point)
// ---------------------------------------------------------------------------

export interface ReviveStrategies {
  keyToTag?: KeyToTagFn;
  validateTag?: ValidateTagFn;
}

const DEFAULT_STRATEGIES: Required<ReviveStrategies> = {
  keyToTag: defaultKeyToTag,
  validateTag: noValidateTag,
};

export function resolveStrategies(overrides?: ReviveStrategies): Required<ReviveStrategies> {
  return {
    keyToTag: overrides?.keyToTag ?? DEFAULT_STRATEGIES.keyToTag,
    validateTag: overrides?.validateTag ?? DEFAULT_STRATEGIES.validateTag,
  };
}

// ---------------------------------------------------------------------------
// 6. Build island map (internal complexity hidden by contract consumer)
// ---------------------------------------------------------------------------

/**
 * Builds tag → loader map from payload using the given strategies.
 * Handles keyToTag (and skip) and validateTag; deduplicates by tag (first wins).
 */
export function buildIslandMap(
  payload: RevivePayload,
  strategies: Required<ReviveStrategies>,
): Map<string, IslandLoader> {
  const map = new Map<string, IslandLoader>();
  for (const [key, loader] of Object.entries(payload.islands)) {
    const { tag, skip } = strategies.keyToTag(key);
    if (skip) continue;
    try {
      strategies.validateTag(tag, key);
    } catch {
      continue;
    }
    if (!map.has(tag)) map.set(tag, loader);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 7. Runtime entrypoint signature (contract surface)
// ---------------------------------------------------------------------------

export interface ReviveResult {
  disconnect: () => void;
}

/**
 * Runtime entrypoint type. Implementations (e.g. default DOM runtime, or a
 * custom/headless runtime) accept the same payload and optional strategies.
 */
export type ReviveFn = (payload: RevivePayload, strategies?: ReviveStrategies) => ReviveResult;

// ---------------------------------------------------------------------------
// 8. Serialization helpers (optional; for different runtimes / SSR)
// ---------------------------------------------------------------------------

/** Serializable subset of RevivePayload (e.g. for worker or SSR runtime). */
export interface SerializableRevivePayload {
  tagToUrl: Record<string, string>;
  options: ReviveOptions;
  customDirectiveNames?: string[];
}

/**
 * Build a serializable payload from tag→url (e.g. from manifest).
 * Runtime that consumes this would fetch(url) and eval/import to get the loader.
 */
export function makeSerializablePayload(
  tagToUrl: Record<string, string>,
  options: ReviveOptions,
  customDirectiveNames?: string[],
): SerializableRevivePayload {
  return { tagToUrl, options, customDirectiveNames };
}
