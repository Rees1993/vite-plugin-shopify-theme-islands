import { describe, expect, it } from "bun:test";

import { DEFAULT_DIRECTIVES } from "../contract";
import { createDirectiveSpine, DEFAULT_DIRECTIVE_SPINE, extendDirectiveSpine } from "../directive-spine";

describe("directive-spine", () => {
  it("reads no gates for an element with no directive attributes", () => {
    const el = document.createElement("plain-island");

    expect(DEFAULT_DIRECTIVE_SPINE.readGates(el)).toEqual([]);
    expect(DEFAULT_DIRECTIVE_SPINE.describe(el)).toBe("immediate");
    expect([...DEFAULT_DIRECTIVE_SPINE.attributeNames]).toEqual([
      "client:visible",
      "client:idle",
      "client:media",
      "client:defer",
      "client:interaction",
    ]);
  });

  it("reads a visible gate with the default rootMargin when the attribute is empty", () => {
    const el = document.createElement("visible-island");
    el.setAttribute("client:visible", "");

    expect(DEFAULT_DIRECTIVE_SPINE.readGates(el)).toEqual([
      {
        kind: "visible",
        attribute: "client:visible",
        rawValue: "",
        rootMargin: "200px",
        threshold: 0,
      },
    ]);
    expect(DEFAULT_DIRECTIVE_SPINE.describe(el)).toBe('client:visible="200px"');
  });

  it("reads built-in gates from custom attribute names", () => {
    const spine = createDirectiveSpine({
      ...DEFAULT_DIRECTIVES,
      visible: { ...DEFAULT_DIRECTIVES.visible, attribute: "client:show", rootMargin: "0px" },
    });
    const el = document.createElement("custom-visible");
    el.setAttribute("client:show", "");

    expect(spine.readGates(el)).toEqual([
      {
        kind: "visible",
        attribute: "client:show",
        rawValue: "",
        rootMargin: "0px",
        threshold: 0,
      },
    ]);
    expect([...spine.attributeNames]).toContain("client:show");
  });

  it("layers matching custom directives into the resolved gate list", () => {
    const customDirective = () => {};
    const spine = extendDirectiveSpine(
      DEFAULT_DIRECTIVE_SPINE,
      new Map([["client:on-click", customDirective]]),
    );
    const el = document.createElement("custom-directive");
    el.setAttribute("client:on-click", "cta");

    expect(spine.readGates(el)).toEqual([
      {
        kind: "custom",
        attribute: "client:on-click",
        value: "cta",
        directive: customDirective,
      },
    ]);
    expect(spine.describe(el)).toBe('client:on-click="cta"');
    expect([...spine.attributeNames]).toContain("client:on-click");
  });

  it("marks idle gates as fallen back when the attribute value is not a strict integer", () => {
    const el = document.createElement("idle-invalid");
    el.setAttribute("client:idle", "20ms");

    expect(DEFAULT_DIRECTIVE_SPINE.readGates(el)).toEqual([
      {
        kind: "idle",
        attribute: "client:idle",
        timeout: 500,
        invalid: true,
        rawValue: "20ms",
      },
    ]);
    expect(DEFAULT_DIRECTIVE_SPINE.describe(el)).toBe('client:idle="500"');
  });

  it("resolves media, defer, and interaction gates from one element", () => {
    const el = document.createElement("mixed-gates");
    el.setAttribute("client:media", "(min-width: 40rem)");
    el.setAttribute("client:defer", "");
    el.setAttribute("client:interaction", "mouseenter unknown");

    expect(DEFAULT_DIRECTIVE_SPINE.readGates(el)).toEqual([
      {
        kind: "media",
        attribute: "client:media",
        rawValue: "(min-width: 40rem)",
        query: "(min-width: 40rem)",
      },
      {
        kind: "defer",
        attribute: "client:defer",
        delay: 3000,
        invalid: false,
        rawValue: "",
      },
      {
        kind: "interaction",
        attribute: "client:interaction",
        rawValue: "mouseenter unknown",
        events: ["mouseenter"],
        invalidTokens: ["unknown"],
        emptyTokens: false,
        usedDefaultEvents: false,
      },
    ]);
    expect(DEFAULT_DIRECTIVE_SPINE.describe(el)).toBe(
      'client:media="(min-width: 40rem)", client:defer="3000", client:interaction="mouseenter"',
    );
  });
});
