import type { ClientDirective, NormalizedReviveOptions } from "./contract.js";
import { partitionInteractionEventTokens } from "./interaction-events.js";

export interface BuiltInLoadGateState {
  visible: string | null;
  media: string | null;
  idle: number | null;
  idleInvalid: boolean;
  defer: number | null;
  deferInvalid: boolean;
  interaction: string[] | null;
}

function parseStrictIntegerAttribute(
  value: string | null,
  fallback: number,
): { value: number | null; invalid: boolean } {
  if (value === null) return { value: null, invalid: false };
  if (value === "") return { value: fallback, invalid: false };

  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return { value: fallback, invalid: true };

  return { value: Number.parseInt(trimmed, 10), invalid: false };
}

export function getBuiltInLoadGateState(
  el: HTMLElement,
  directives: NormalizedReviveOptions["directives"],
): BuiltInLoadGateState {
  const visibleAttr = el.getAttribute(directives.visible.attribute);
  const mediaAttr = el.getAttribute(directives.media.attribute);
  const idleAttr = el.getAttribute(directives.idle.attribute);
  const deferAttr = el.getAttribute(directives.defer.attribute);
  const interactionAttr = el.getAttribute(directives.interaction.attribute);

  let interactionEvents: string[] | null = null;
  if (interactionAttr !== null) {
    interactionEvents = [...directives.interaction.events];
    if (interactionAttr) {
      const tokens = interactionAttr.split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        const { valid } = partitionInteractionEventTokens(tokens);
        if (valid.length > 0) interactionEvents = valid;
      }
    }
  }

  const idle = parseStrictIntegerAttribute(idleAttr, directives.idle.timeout);
  const defer = parseStrictIntegerAttribute(deferAttr, directives.defer.delay);

  return {
    visible: visibleAttr !== null ? visibleAttr || directives.visible.rootMargin : null,
    media: mediaAttr || null,
    idle: idle.value,
    idleInvalid: idle.invalid,
    defer: defer.value,
    deferInvalid: defer.invalid,
    interaction: interactionEvents,
  };
}

export function describeEffectiveLoadGate(
  el: HTMLElement,
  directives: NormalizedReviveOptions["directives"],
  customDirectives?: Map<string, ClientDirective>,
): string {
  const parts: string[] = [];
  const builtIns = getBuiltInLoadGateState(el, directives);
  const pushGate = (attr: string, value: string | number | null) => {
    if (value === null) return;
    parts.push(value === "" ? attr : `${attr}="${String(value)}"`);
  };

  pushGate(directives.visible.attribute, builtIns.visible);
  pushGate(directives.media.attribute, builtIns.media);
  pushGate(directives.idle.attribute, builtIns.idle);
  pushGate(directives.defer.attribute, builtIns.defer);
  if (builtIns.interaction !== null) {
    pushGate(directives.interaction.attribute, builtIns.interaction.join(" "));
  }

  if (customDirectives?.size) {
    for (const attrName of customDirectives.keys()) {
      const value = el.getAttribute(attrName);
      if (value !== null) pushGate(attrName, value);
    }
  }

  return parts.join(", ") || "immediate";
}
