import { describe, expect, it, mock } from "bun:test";
import { createRetryScheduler } from "../retry-scheduler";

type FakeTimer = { fn: () => void; delay: number; cleared: boolean };

function makeFakeClock() {
  const timers: FakeTimer[] = [];
  return {
    timers,
    platform: {
      setTimeout(fn: () => void, delay: number): ReturnType<typeof setTimeout> {
        const timer: FakeTimer = { fn, delay, cleared: false };
        timers.push(timer);
        return timer as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout(timer: ReturnType<typeof setTimeout>): void {
        (timer as unknown as FakeTimer).cleared = true;
      },
    },
  };
}

describe("retry-scheduler", () => {
  it("schedules retry callbacks with exponential backoff", () => {
    const clock = makeFakeClock();
    const scheduler = createRetryScheduler({
      retries: 2,
      retryDelay: 100,
      platform: clock.platform,
    });
    const retry = mock(() => {});

    const first = scheduler.scheduleRetry("retry-island", retry);
    const second = scheduler.scheduleRetry("retry-island", retry);

    expect(first).toEqual({ attempt: 1, willRetry: true });
    expect(second).toEqual({ attempt: 2, willRetry: true });
    expect(clock.timers.map((timer) => timer.delay)).toEqual([100, 200]);

    clock.timers[0].fn();
    clock.timers[1].fn();
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("returns willRetry: false once retries are exhausted", () => {
    const clock = makeFakeClock();
    const scheduler = createRetryScheduler({
      retries: 1,
      retryDelay: 50,
      platform: clock.platform,
    });
    const retry = mock(() => {});

    expect(scheduler.scheduleRetry("done-island", retry)).toEqual({ attempt: 1, willRetry: true });
    expect(scheduler.scheduleRetry("done-island", retry)).toEqual({ attempt: 2, willRetry: false });
    expect(clock.timers).toHaveLength(1);
  });

  it("attemptOf reports the next attempt number without mutating state", () => {
    const clock = makeFakeClock();
    const scheduler = createRetryScheduler({
      retries: 3,
      retryDelay: 50,
      platform: clock.platform,
    });

    expect(scheduler.attemptOf("fresh-tag")).toBe(1);
    scheduler.scheduleRetry(
      "fresh-tag",
      mock(() => {}),
    );
    expect(scheduler.attemptOf("fresh-tag")).toBe(2);
    expect(scheduler.attemptOf("fresh-tag")).toBe(2);
  });

  it("cancel clears the pending timer and resets attempt count for one tag", () => {
    const clock = makeFakeClock();
    const scheduler = createRetryScheduler({
      retries: 3,
      retryDelay: 50,
      platform: clock.platform,
    });

    scheduler.scheduleRetry(
      "alpha",
      mock(() => {}),
    );
    scheduler.scheduleRetry(
      "beta",
      mock(() => {}),
    );
    expect(clock.timers).toHaveLength(2);

    scheduler.cancel("alpha");
    expect(clock.timers[0].cleared).toBe(true);
    expect(clock.timers[1].cleared).toBe(false);
    expect(scheduler.attemptOf("alpha")).toBe(1);
  });

  it("cancelAll clears every pending timer", () => {
    const clock = makeFakeClock();
    const scheduler = createRetryScheduler({
      retries: 3,
      retryDelay: 50,
      platform: clock.platform,
    });

    scheduler.scheduleRetry(
      "alpha",
      mock(() => {}),
    );
    scheduler.scheduleRetry(
      "beta",
      mock(() => {}),
    );
    scheduler.cancelAll();

    expect(clock.timers.every((timer) => timer.cleared)).toBe(true);
    expect(scheduler.attemptOf("alpha")).toBe(1);
    expect(scheduler.attemptOf("beta")).toBe(1);
  });

  it("scheduling a retry after a previous timer is still pending replaces it", () => {
    const clock = makeFakeClock();
    const scheduler = createRetryScheduler({
      retries: 5,
      retryDelay: 100,
      platform: clock.platform,
    });
    const retry = mock(() => {});

    scheduler.scheduleRetry("flaky", retry);
    scheduler.scheduleRetry("flaky", retry);
    expect(clock.timers[0].cleared).toBe(true);
    expect(clock.timers[1].cleared).toBe(false);
  });
});
