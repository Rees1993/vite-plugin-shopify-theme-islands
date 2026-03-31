import type { RetryConfig } from "./contract.js";
import type { InteractionEventName } from "./interaction-events.js";

export interface ResolveTagInput {
  filePath: string;
  defaultTag: string;
}

export type ResolveTagFn = (input: ResolveTagInput) => string | false;

/** Plugin option entry for registering a custom client directive. */
export interface ClientDirectiveDefinition {
  /** HTML attribute name, e.g. `'client:on-click'` */
  name: string;
  /** Path to the directive module (supports Vite aliases) */
  entrypoint: string;
}

/** Shared directive configuration shape used by both the plugin and the runtime. */
export interface DirectivesConfig {
  /** Configuration for the `client:visible` directive (IntersectionObserver). */
  visible?: {
    /** HTML attribute name. Default: `'client:visible'` */
    attribute?: string;
    /** Passed to IntersectionObserver — loads islands before they scroll into view. Default: `'200px'` */
    rootMargin?: string;
    /** Passed to IntersectionObserver — ratio of element that must be visible. Default: `0` */
    threshold?: number;
  };
  /** Configuration for the `client:idle` directive (requestIdleCallback). */
  idle?: {
    /** HTML attribute name. Default: `'client:idle'` */
    attribute?: string;
    /** Deadline (ms) passed to requestIdleCallback; also used as the setTimeout fallback delay. Default: `500` */
    timeout?: number;
  };
  /** Configuration for the `client:media` directive (matchMedia). */
  media?: {
    /** HTML attribute name. Default: `'client:media'` */
    attribute?: string;
  };
  /** Configuration for the `client:defer` directive (fixed setTimeout delay). */
  defer?: {
    /** HTML attribute name. Default: `'client:defer'` */
    attribute?: string;
    /** Fallback delay (ms) when the attribute has no value. Default: `3000` */
    delay?: number;
  };
  /** Configuration for the `client:interaction` directive (mouseenter/touchstart/focusin). */
  interaction?: {
    /** HTML attribute name. Default: `'client:interaction'` */
    attribute?: string;
    /** Curated intent events to listen for. Default: `['mouseenter', 'touchstart', 'focusin']` */
    events?: readonly InteractionEventName[];
  };
  /** Custom client directives to register. Each entry maps an attribute name to a module entrypoint. */
  custom?: ClientDirectiveDefinition[];
}

export interface ShopifyThemeIslandsOptions {
  /** Directories to scan for island files. Accepts paths or Vite aliases. Default: `['/frontend/js/islands/']` */
  directories?: string | string[];
  /**
   * Override file-path-to-tag resolution.
   * Return `defaultTag` to keep default behavior, or `false` to exclude a file.
   */
  resolveTag?: ResolveTagFn;
  /** Log discovered islands and generated virtual module. Default: `false` */
  debug?: boolean;
  /** Per-directive configuration. */
  directives?: DirectivesConfig;
  /** Automatic retry behaviour for failed island loads. */
  retry?: RetryConfig;
  /**
   * Milliseconds before a custom directive that never calls `load()` is considered timed out.
   * When exceeded, `islands:error` is dispatched and the island is abandoned.
   * Default: `0` (disabled).
   */
  directiveTimeout?: number;
}
