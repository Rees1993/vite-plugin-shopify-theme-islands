/// <reference lib="dom" />
import { afterEach, describe, expect, it, mock } from "bun:test";
import { createCancellableWatchers } from "../cancellable-watchers";

describe("cancellable-watchers", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("watch returns a dispose that removes only the registered callback", () => {
    const watchers = createCancellableWatchers();
    const el = document.createElement("a-island");
    document.body.appendChild(el);

    const cancelOne = mock(() => {});
    const cancelTwo = mock(() => {});
    const disposeOne = watchers.watch(el, cancelOne);
    watchers.watch(el, cancelTwo);

    document.body.removeChild(el);
    disposeOne();
    watchers.cancelDetached();

    expect(cancelOne).not.toHaveBeenCalled();
    expect(cancelTwo).toHaveBeenCalledTimes(1);
  });

  it("cancelDetached fires callbacks for elements no longer in the DOM", () => {
    const watchers = createCancellableWatchers();
    const live = document.createElement("live-island");
    const gone = document.createElement("gone-island");
    document.body.append(live, gone);

    const liveCancel = mock(() => {});
    const goneCancel = mock(() => {});
    watchers.watch(live, liveCancel);
    watchers.watch(gone, goneCancel);

    document.body.removeChild(gone);
    watchers.cancelDetached();

    expect(goneCancel).toHaveBeenCalledTimes(1);
    expect(liveCancel).not.toHaveBeenCalled();
  });

  it("cancelDetached is idempotent — running twice does not double-fire", () => {
    const watchers = createCancellableWatchers();
    const el = document.createElement("once-island");
    document.body.appendChild(el);
    const cancel = mock(() => {});
    watchers.watch(el, cancel);

    document.body.removeChild(el);
    watchers.cancelDetached();
    watchers.cancelDetached();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancelInRoot fires callbacks for the root and any descendants", () => {
    const watchers = createCancellableWatchers();
    const root = document.createElement("section-root");
    const inner = document.createElement("inner-island");
    const sibling = document.createElement("sibling-island");
    root.appendChild(inner);
    document.body.append(root, sibling);

    const innerCancel = mock(() => {});
    const siblingCancel = mock(() => {});
    const rootCancel = mock(() => {});
    watchers.watch(root, rootCancel);
    watchers.watch(inner, innerCancel);
    watchers.watch(sibling, siblingCancel);

    watchers.cancelInRoot(root);

    expect(rootCancel).toHaveBeenCalledTimes(1);
    expect(innerCancel).toHaveBeenCalledTimes(1);
    expect(siblingCancel).not.toHaveBeenCalled();
  });

  it("multiple callbacks per element all fire on cancellation", () => {
    const watchers = createCancellableWatchers();
    const el = document.createElement("multi-island");
    document.body.appendChild(el);

    const a = mock(() => {});
    const b = mock(() => {});
    const c = mock(() => {});
    watchers.watch(el, a);
    watchers.watch(el, b);
    watchers.watch(el, c);

    document.body.removeChild(el);
    watchers.cancelDetached();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("dispose returned by watch is safe to call after cancellation has fired", () => {
    const watchers = createCancellableWatchers();
    const el = document.createElement("safe-island");
    document.body.appendChild(el);
    const cancel = mock(() => {});
    const dispose = watchers.watch(el, cancel);

    document.body.removeChild(el);
    watchers.cancelDetached();
    expect(() => dispose()).not.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
