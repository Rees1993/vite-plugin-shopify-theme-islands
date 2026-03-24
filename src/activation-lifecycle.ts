export interface ActivationLifecycle {
  readonly initialWalkComplete: boolean;
  settleSuccess(tag: string): number;
  settleFailure(tag: string): { retryDelayMs: number | null; attempt: number };
  evict(tag: string): void;
  watchCancellable(el: Element, cancel: () => void): () => void;
  walk(root: HTMLElement): void;
}
