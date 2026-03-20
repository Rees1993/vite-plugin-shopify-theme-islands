/**
 * Curated interaction events accepted by `client:interaction`.
 *
 * The list is intentionally narrow: these are the user-intent signals the
 * plugin supports for now, and they are exposed as a package-owned union so
 * config can be type-checked without relying on the DOM lib surface.
 */
export const INTERACTION_EVENT_NAMES = ["mouseenter", "touchstart", "focusin"] as const;

export type InteractionEventName = (typeof INTERACTION_EVENT_NAMES)[number];

export const DEFAULT_INTERACTION_EVENTS = [...INTERACTION_EVENT_NAMES] as const;

const INTERACTION_EVENT_NAME_SET = new Set<string>(INTERACTION_EVENT_NAMES);

export function isInteractionEventName(value: string): value is InteractionEventName {
  return INTERACTION_EVENT_NAME_SET.has(value);
}
