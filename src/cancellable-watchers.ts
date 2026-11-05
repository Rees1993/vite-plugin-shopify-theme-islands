/**
 * A registry of element-scoped cancellation callbacks.
 *
 * The runtime registers a cancel callback per Island element that has pending
 * Gate work (e.g. a `client:visible` IntersectionObserver subscription). When
 * the element is removed from the DOM, or its containing Subtree is excluded,
 * those callbacks fire so the pending work doesn't leak.
 */
export interface CancellableWatchers {
  /**
   * Register a cancel callback for an element. Returns a dispose function that
   * removes just this callback (other callbacks for the same element stay).
   */
  watch(el: Element, cancel: () => void): () => void;
  /** Cancel detached elements and elements excluded by the current root policy. */
  cancelDetached(shouldCancel?: (el: Element) => boolean): void;
  /** Cancel the entire session, including explicitly included descendants. */
  cancelAll(): void;
  /** Cancel callbacks inside `root` that match the optional policy. */
  cancelInRoot(root: Element, shouldCancel?: (el: Element) => boolean): void;
}

export function createCancellableWatchers(): CancellableWatchers {
  const cancellableElements = new Map<Element, Set<() => void>>();

  return {
    watch(el, cancel) {
      const cancels = cancellableElements.get(el) ?? new Set<() => void>();
      cancels.add(cancel);
      cancellableElements.set(el, cancels);
      return () => {
        const activeCancels = cancellableElements.get(el);
        if (!activeCancels) return;
        activeCancels.delete(cancel);
        if (activeCancels.size === 0) cancellableElements.delete(el);
      };
    },

    cancelDetached(shouldCancel = () => false) {
      if (cancellableElements.size === 0) return;
      for (const [el, cancels] of cancellableElements) {
        if (!el.isConnected || shouldCancel(el)) {
          cancellableElements.delete(el);
          for (const cancel of cancels) cancel();
        }
      }
    },

    cancelAll() {
      for (const [el, cancels] of cancellableElements) {
        cancellableElements.delete(el);
        for (const cancel of cancels) cancel();
      }
    },

    cancelInRoot(root, shouldCancel = () => true) {
      for (const [el, cancels] of cancellableElements) {
        if ((el === root || root.contains(el)) && shouldCancel(el)) {
          cancellableElements.delete(el);
          for (const cancel of cancels) cancel();
        }
      }
    },
  };
}
