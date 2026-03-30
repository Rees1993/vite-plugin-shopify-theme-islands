import {
  DEFAULT_DIRECTIVES,
  type ClientDirective,
  type NormalizedReviveOptions,
} from "./contract.js";
import { partitionInteractionEventTokens } from "./interaction-events.js";

export type GateResult =
  | {
      kind: "visible";
      attribute: string;
      rawValue: string;
      rootMargin: string;
      threshold: number;
    }
  | {
      kind: "media";
      attribute: string;
      rawValue: string;
      query: string | null;
    }
  | {
      kind: "custom";
      attribute: string;
      value: string;
      directive: ClientDirective;
    }
  | {
      kind: "idle";
      attribute: string;
      timeout: number;
      invalid: boolean;
      rawValue: string;
    }
  | {
      kind: "defer";
      attribute: string;
      delay: number;
      invalid: boolean;
      rawValue: string;
    }
  | {
      kind: "interaction";
      attribute: string;
      rawValue: string;
      events: string[];
      invalidTokens: string[];
      emptyTokens: boolean;
      usedDefaultEvents: boolean;
    };

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

export interface DirectiveSpine {
  readGates(el: HTMLElement): GateResult[];
  describe(el: HTMLElement): string;
  attributeNames: ReadonlySet<string>;
}

function formatEffectiveGate(gate: GateResult): string | null {
  switch (gate.kind) {
    case "visible":
      return `${gate.attribute}="${gate.rootMargin}"`;
    case "media":
      return gate.query ? `${gate.attribute}="${gate.query}"` : null;
    case "idle":
      return `${gate.attribute}="${gate.timeout}"`;
    case "defer":
      return `${gate.attribute}="${gate.delay}"`;
    case "interaction":
      return `${gate.attribute}="${gate.events.join(" ")}"`;
    case "custom":
      return gate.value ? `${gate.attribute}="${gate.value}"` : gate.attribute;
  }
}

function describeGates(gates: GateResult[]): string {
  if (gates.length === 0) return "immediate";
  return gates
    .map(formatEffectiveGate)
    .filter((part): part is string => part !== null)
    .join(", ");
}

export function createDirectiveSpine(
  directives: NormalizedReviveOptions["directives"] = DEFAULT_DIRECTIVES,
): DirectiveSpine {
  const attributeNames = new Set([
    directives.visible.attribute,
    directives.idle.attribute,
    directives.media.attribute,
    directives.defer.attribute,
    directives.interaction.attribute,
  ]);

  return {
    readGates(el) {
      const gates: GateResult[] = [];

      const visible = el.getAttribute(directives.visible.attribute);
      if (visible !== null) {
        gates.push({
          kind: "visible",
          attribute: directives.visible.attribute,
          rawValue: visible,
          rootMargin: visible || directives.visible.rootMargin,
          threshold: directives.visible.threshold,
        });
      }

      const media = el.getAttribute(directives.media.attribute);
      if (media !== null) {
        gates.push({
          kind: "media",
          attribute: directives.media.attribute,
          rawValue: media,
          query: media || null,
        });
      }

      const idle = parseStrictIntegerAttribute(
        el.getAttribute(directives.idle.attribute),
        directives.idle.timeout,
      );
      if (idle.value !== null) {
        gates.push({
          kind: "idle",
          attribute: directives.idle.attribute,
          timeout: idle.value,
          invalid: idle.invalid,
          rawValue: el.getAttribute(directives.idle.attribute) ?? "",
        });
      }

      const defer = parseStrictIntegerAttribute(
        el.getAttribute(directives.defer.attribute),
        directives.defer.delay,
      );
      if (defer.value !== null) {
        gates.push({
          kind: "defer",
          attribute: directives.defer.attribute,
          delay: defer.value,
          invalid: defer.invalid,
          rawValue: el.getAttribute(directives.defer.attribute) ?? "",
        });
      }

      const interaction = el.getAttribute(directives.interaction.attribute);
      if (interaction !== null) {
        let events = [...directives.interaction.events];
        let invalidTokens: string[] = [];
        let emptyTokens = false;
        let usedDefaultEvents = interaction === "";

        if (interaction) {
          const tokens = interaction.split(/\s+/).filter(Boolean);
          if (tokens.length === 0) {
            emptyTokens = true;
            usedDefaultEvents = true;
          } else {
            const partition = partitionInteractionEventTokens(tokens);
            invalidTokens = partition.invalid;
            if (partition.valid.length > 0) {
              events = partition.valid;
              usedDefaultEvents = false;
            } else {
              usedDefaultEvents = true;
            }
          }
        }

        gates.push({
          kind: "interaction",
          attribute: directives.interaction.attribute,
          rawValue: interaction,
          events,
          invalidTokens,
          emptyTokens,
          usedDefaultEvents,
        });
      }

      return gates;
    },
    describe(el) {
      return describeGates(this.readGates(el));
    },
    attributeNames,
  };
}

export function extendDirectiveSpine(
  base: DirectiveSpine,
  customDirectives?: Map<string, ClientDirective>,
): DirectiveSpine {
  if (!customDirectives?.size) return base;

  const attributeNames = new Set(base.attributeNames);
  for (const attrName of customDirectives.keys()) attributeNames.add(attrName);

  return {
    readGates(el) {
      const gates = [...base.readGates(el)];
      for (const [attribute, directive] of customDirectives) {
        const value = el.getAttribute(attribute);
        if (value !== null) {
          gates.push({
            kind: "custom",
            attribute,
            value,
            directive,
          });
        }
      }
      return gates;
    },
    describe(el) {
      return describeGates(this.readGates(el));
    },
    attributeNames,
  };
}

export const DEFAULT_DIRECTIVE_SPINE = createDirectiveSpine();
