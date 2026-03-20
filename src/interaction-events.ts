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
const PREFIX = "[vite-plugin-shopify-theme-islands]";

export interface InteractionEventTokenPartition {
  valid: InteractionEventName[];
  invalid: string[];
}

export function isInteractionEventName(value: string): value is InteractionEventName {
  return INTERACTION_EVENT_NAME_SET.has(value);
}

export function validateInteractionEvents(
  events: readonly string[] | undefined,
): asserts events is readonly InteractionEventName[] {
  if (events === undefined) return;
  if (events.length === 0) {
    throw new Error(`${PREFIX} "directives.interaction.events" must not be empty`);
  }
  const invalidEvent = events.find((eventName) => !isInteractionEventName(eventName));
  if (invalidEvent) {
    throw new Error(
      `${PREFIX} "directives.interaction.events" contains unsupported event "${invalidEvent}"`,
    );
  }
}

export function partitionInteractionEventTokens(
  tokens: readonly string[],
): InteractionEventTokenPartition {
  const valid: InteractionEventName[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    if (isInteractionEventName(token)) valid.push(token);
    else invalid.push(token);
  }
  return { valid, invalid };
}
