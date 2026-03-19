import type { IslandErrorDetail, IslandLoadDetail } from "./contract.js";

type RuntimeEventMap = {
  "islands:load": IslandLoadDetail;
  "islands:error": IslandErrorDetail;
};

export interface RuntimeLogger {
  note(msg: string): void;
  flush(summary: string): void;
}

export interface RuntimeSurface {
  dispatchLoad(detail: IslandLoadDetail): void;
  dispatchError(detail: IslandErrorDetail): void;
  onLoad(handler: (detail: IslandLoadDetail) => void): () => void;
  onError(handler: (detail: IslandErrorDetail) => void): () => void;
  createLogger(tagName: string, debug: boolean): RuntimeLogger;
  beginReadyLog(islandCount: number, debug: boolean): () => void;
}

interface RuntimeSurfaceDeps {
  target: Document;
  console: Pick<Console, "log" | "groupCollapsed" | "groupEnd">;
}

const SILENT_LOGGER: RuntimeLogger = {
  note() {},
  flush() {},
};

function addListener<K extends keyof RuntimeEventMap>(
  target: Document,
  name: K,
  handler: (detail: RuntimeEventMap[K]) => void,
): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<RuntimeEventMap[K]>).detail);
  target.addEventListener(name, listener as EventListener);
  return () => target.removeEventListener(name, listener as EventListener);
}

function dispatch<K extends keyof RuntimeEventMap>(
  target: Document,
  name: K,
  detail: RuntimeEventMap[K],
): void {
  target.dispatchEvent(new CustomEvent(name, { detail }));
}

export function createRuntimeSurface(deps: RuntimeSurfaceDeps): RuntimeSurface {
  return {
    dispatchLoad(detail) {
      dispatch(deps.target, "islands:load", detail);
    },

    dispatchError(detail) {
      dispatch(deps.target, "islands:error", detail);
    },

    onLoad(handler) {
      return addListener(deps.target, "islands:load", handler);
    },

    onError(handler) {
      return addListener(deps.target, "islands:error", handler);
    },

    createLogger(tagName, debug) {
      if (!debug) return SILENT_LOGGER;
      const msgs: string[] = [];
      return {
        note(msg) {
          msgs.push(msg);
        },
        flush(summary) {
          if (msgs.length === 0) {
            deps.console.log("[islands]", `<${tagName}> ${summary}`);
          } else {
            deps.console.groupCollapsed(`[islands] <${tagName}> ${summary}`);
            for (const msg of msgs) deps.console.log(msg);
            deps.console.groupEnd();
          }
          msgs.length = 0;
        },
      };
    },

    beginReadyLog(islandCount, debug) {
      if (!debug) return () => {};
      deps.console.groupCollapsed(`[islands] ready — ${islandCount} island(s)`);
      return () => deps.console.groupEnd();
    },
  };
}

export const runtimeSurface = createRuntimeSurface({
  target: document,
  console,
});
