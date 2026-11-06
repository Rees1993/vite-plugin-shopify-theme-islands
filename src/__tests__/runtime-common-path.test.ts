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
