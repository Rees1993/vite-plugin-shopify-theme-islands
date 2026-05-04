export interface RetryPlatform {
  setTimeout(fn: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

export interface RetrySchedulerOptions {
  retries: number;
  retryDelay: number;
  platform?: RetryPlatform;
}

export interface RetryScheduler {
  /** Returns the attempt number a settle would resolve to, without mutating state. */
  attemptOf(tag: string): number;
  /**
   * Records a failed attempt. If retries are not exhausted, schedules `retry`
   * via the platform timer with exponential backoff. Returns the attempt number
   * just used and whether another retry is queued.
   */
  scheduleRetry(tag: string, retry: () => void): { willRetry: boolean; attempt: number };
  /** Cancel any pending retry timer and forget the attempt count for one tag. */
  cancel(tag: string): void;
  /** Cancel everything. */
  cancelAll(): void;
}

export function createRetryScheduler(options: RetrySchedulerOptions): RetryScheduler {
  const retryCount = new Map<string, number>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const platform = options.platform ?? globalThis;

  const clearRetryTimer = (tag: string): void => {
    const timer = retryTimers.get(tag);
    if (timer === undefined) return;
    platform.clearTimeout(timer);
    retryTimers.delete(tag);
  };

  return {
    attemptOf(tag) {
      return (retryCount.get(tag) ?? 0) + 1;
    },

    scheduleRetry(tag, retry) {
      const attempt = (retryCount.get(tag) ?? 0) + 1;
      if (attempt <= options.retries) {
        retryCount.set(tag, attempt);
        clearRetryTimer(tag);
        const timer = platform.setTimeout(
          () => {
            retryTimers.delete(tag);
            retry();
          },
          options.retryDelay * 2 ** (attempt - 1),
        );
        retryTimers.set(tag, timer);
        return { willRetry: true, attempt };
      }

      clearRetryTimer(tag);
      retryCount.delete(tag);
      return { willRetry: false, attempt };
    },

    cancel(tag) {
      clearRetryTimer(tag);
      retryCount.delete(tag);
    },

    cancelAll() {
      for (const timer of retryTimers.values()) platform.clearTimeout(timer);
      retryTimers.clear();
      retryCount.clear();
    },
  };
}
