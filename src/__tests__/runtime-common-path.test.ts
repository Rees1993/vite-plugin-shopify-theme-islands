import { afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { createRuntimeSuite, flush, installVisibilityDriver } from "./utils/harness";

const suite = createRuntimeSuite();
beforeEach(() => suite.reset());
afterEach(() => suite.cleanup());

it("avoids diagnostic attribute reads on a parked Island when debug is disabled", async () => {
  const visibility = installVisibilityDriver(suite.cleanups);
  document.body.innerHTML =
    "<quiet-island client:visible></quiet-island><quiet-island client:visible></quiet-island>";
  const [owner, parked] = document.querySelectorAll<HTMLElement>("quiet-island");
  const reads = spyOn(parked!, "getAttribute");
  suite.cleanups.track(() => reads.mockRestore());
  const loader = mock(async () => {});
  suite.runtime.start(suite.runtime.payload({ "/quiet-island.ts": loader }));
  expect(reads.mock.calls.filter(([name]) => name.startsWith("client:")).length).toBe(0);
  expect(loader).not.toHaveBeenCalled();
  visibility.trigger(owner!);
  await flush(0);
  expect(loader).toHaveBeenCalledTimes(1);
});

it("avoids ancestor policy reads for unrelated descendants until a root is excluded", () => {
  document.body.innerHTML = '<section><div><span id="unrelated-leaf"></span></div></section>';
  const leaf = document.getElementById("unrelated-leaf")!;
  const parent = leaf.parentElement;
  let ancestorReads = 0;
  Object.defineProperty(leaf, "parentElement", {
    configurable: true,
    get() {
      ancestorReads++;
      return parent;
    },
  });
  suite.cleanups.track(() => {
    Reflect.deleteProperty(leaf, "parentElement");
  });
  const runtime = suite.runtime.start(suite.runtime.payload({}));
  expect(ancestorReads).toBe(0);
  runtime.unobserve(parent!);
  runtime.scan(document.body);
  expect(ancestorReads).toBeGreaterThan(0);
});
