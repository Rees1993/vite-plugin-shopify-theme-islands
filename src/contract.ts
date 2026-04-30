/**
 * Plugin ↔ Runtime contract (deep module).
 *
 * Single source of truth for the payload shape, key→tag derivation, and defaults.
 * Plugin and runtime both depend on this module in-process.
 */
import type { InteractionEventName } from "./interaction-events.js";
import { DEFAULT_INTERACTION_EVENTS, validateInteractionEvents } from "./interaction-events.js";

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
  interaction?: { attribute?: string; events?: readonly InteractionEventName[] };
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
  /**
   * Milliseconds before a custom directive that never calls `load()` is considered timed out.
   * When exceeded, `islands:error` is dispatched and the island is abandoned.
   * Default: `0` (disabled).
   */
  directiveTimeout?: number;
}

/** Options passed to a custom client directive function. */
export interface ClientDirectiveOptions {
  /** The matched attribute name, e.g. `'client:on-click'` */
  name: string;
  /** The attribute value; empty string if no value was set */
  value: string;
}

export interface ClientDirectiveContext {
  /** Aborted when the directive should stop waiting and clean up any side effects. */
  signal: AbortSignal;
  /** Registers cleanup work that should run when the directive is aborted or resolves. */
  onCleanup(cleanup: () => void): void;
}

/** Custom directive function at runtime (load, opts, element, ctx). */
export type ClientDirective = (
  load: () => Promise<void>,
  options: ClientDirectiveOptions,
  el: HTMLElement,
  ctx: ClientDirectiveContext,
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
  resolvedTags?: Record<string, string | false>;
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
    interaction: { attribute: string; events: readonly InteractionEventName[] };
  };
  debug: boolean;
  retry: { retries: number; delay: number };
  directiveTimeout: number;
}

/** Default directive config. Single source of truth for plugin merge and runtime normalization. */
export const DEFAULT_DIRECTIVES: NormalizedReviveOptions["directives"] = {
  visible: { attribute: "client:visible", rootMargin: "200px", threshold: 0 },
  idle: { attribute: "client:idle", timeout: 500 },
  media: { attribute: "client:media" },
  defer: { attribute: "client:defer", delay: 3000 },
  interaction: {
    attribute: "client:interaction",
    events: [...DEFAULT_INTERACTION_EVENTS],
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
  validateInteractionEvents(dir?.interaction?.events as readonly string[] | undefined);
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
    directiveTimeout: options?.directiveTimeout ?? 0,
  };
}

// ---------------------------------------------------------------------------
// 3. Key → tag strategy (pluggable)
// ---------------------------------------------------------------------------

export type KeyToTagResult = { tag: string; skip?: boolean };
export type ResolvedTagOverride = string | false;
export type ResolveTagInput = { filePath: string; defaultTag: string };
export type ResolveTagOverrideFn = (input: ResolveTagInput) => ResolvedTagOverride;

/**
 * Maps a glob key (e.g. "/frontend/js/islands/product-form.ts") to a custom element tag.
 * Return { tag, skip: true } to exclude this entry from the island map.
 */
export type KeyToTagFn = (key: string) => KeyToTagResult;

const basename = (key: string) => key.split("/").pop() ?? key;

/** Derives the default tag name from a glob key without warning or skipping. */
export function deriveDefaultTag(key: string): string {
  const filename = basename(key);
  return filename.replace(/\.(ts|js)$/, "");
}

/** Default: last path segment, extension stripped; skip (and warn) when tag has no hyphen. */
export function defaultKeyToTag(key: string): KeyToTagResult {
  const filename = basename(key);
  const tag = deriveDefaultTag(key);
  const skip = !tag.includes("-");
  if (skip && tag)
    console.warn(
      `[islands] Skipping "${filename}" — filename must contain a hyphen to match a valid custom element tag (e.g. rename to "${tag}-island.ts")`,
    );
  return { tag, skip };
}

function duplicateTagOwnershipError(tag: string, filePaths: string[]): Error {
  return new Error(
    `[islands] Multiple island entrypoints resolve to <${tag}>:\n- ${filePaths.join(
      "\n- ",
    )}\nTag ownership must be unique before calling revive(...). Remove one entry or disambiguate the final tag.`,
  );
}

export function compileResolvedTags(
  filePaths: Iterable<string>,
  resolveTag: ResolveTagOverrideFn,
): Record<string, ResolvedTagOverride> | null {
  const entries: Array<[string, ResolvedTagOverride]> = [];
  for (const filePath of filePaths) {
    const defaultTag = deriveDefaultTag(filePath);
    const resolvedTag = resolveTag({ filePath, defaultTag });
    if (resolvedTag === defaultTag) continue;
    entries.push([filePath, resolvedTag]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

// ---------------------------------------------------------------------------
// 4. Build island map (internal complexity hidden by contract consumer)
// ---------------------------------------------------------------------------

/**
 * Builds tag → loader map from payload.
 * Applies the default key→tag derivation and requires unique tag ownership.
 */
export function buildIslandMap(payload: RevivePayload): Map<string, IslandLoader> {
  const map = new Map<string, IslandLoader>();
  const sourceKeys = new Map<string, string>();
  for (const [key, loader] of Object.entries(payload.islands)) {
    const resolvedTag = payload.resolvedTags?.[key];
    const { tag, skip } =
      resolvedTag !== undefined
        ? resolvedTag === false
          ? { tag: "", skip: true }
          : { tag: resolvedTag }
        : defaultKeyToTag(key);
    if (skip) continue;
    if (!map.has(tag)) {
      map.set(tag, loader);
      sourceKeys.set(tag, key);
      continue;
    }
    throw duplicateTagOwnershipError(tag, [sourceKeys.get(tag) ?? key, key]);
  }
  return map;
}
