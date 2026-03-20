import { describe, expect, it } from "bun:test";
import {
  DEFAULT_INTERACTION_EVENTS,
  INTERACTION_EVENT_NAMES,
  isInteractionEventName,
  partitionInteractionEventTokens,
} from "../interaction-events";

describe("interaction-events", () => {
  it("exports the curated narrow interaction event list", () => {
    expect(INTERACTION_EVENT_NAMES).toEqual(["mouseenter", "touchstart", "focusin"]);
    expect(DEFAULT_INTERACTION_EVENTS).toEqual(["mouseenter", "touchstart", "focusin"]);
  });

  it("recognizes only curated interaction event names", () => {
    expect(isInteractionEventName("mouseenter")).toBe(true);
    expect(isInteractionEventName("touchstart")).toBe(true);
    expect(isInteractionEventName("focusin")).toBe(true);
    expect(isInteractionEventName("click")).toBe(false);
    expect(isInteractionEventName("pointerdown")).toBe(false);
  });

  it("partitions runtime tokens into supported and unsupported sets", () => {
    expect(partitionInteractionEventTokens(["mouseenter", "click", "focusin", "submit"])).toEqual({
      valid: ["mouseenter", "focusin"],
      invalid: ["click", "submit"],
    });
  });
});
