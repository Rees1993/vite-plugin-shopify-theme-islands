export interface ShopifyLifecycleRuntime {
  scan(root?: HTMLElement | null): void;
  observe(root?: HTMLElement | null): void;
  unobserve(root?: HTMLElement | null): void;
}

type ShopifyLifecycleAction = "scan" | "observe" | "unobserve";

const SHOPIFY_LIFECYCLE_ACTIONS: ReadonlyArray<[type: string, action: ShopifyLifecycleAction]> = [
  ["shopify:section:load", "observe"],
  ["shopify:section:unload", "unobserve"],
  ["shopify:section:reorder", "scan"],
  ["shopify:section:select", "scan"],
  ["shopify:section:deselect", "scan"],
  ["shopify:block:select", "scan"],
  ["shopify:block:deselect", "scan"],
];

const isBlockLifecycleEvent = (type: string): boolean => type.startsWith("shopify:block:");

function resolveLifecycleRoot(event: Event): HTMLElement | null {
  if (event.target instanceof HTMLElement) return event.target;

  if (!(event instanceof CustomEvent)) return null;
  const detail = event.detail;
  if (!detail || typeof detail !== "object") return null;

  if (isBlockLifecycleEvent(event.type)) {
    const blockId = "blockId" in detail && typeof detail.blockId === "string" ? detail.blockId : null;
    if (!blockId) return null;
    const root = document.getElementById(`shopify-block-${blockId}`);
    return root instanceof HTMLElement ? root : null;
  }

  const sectionId =
    "sectionId" in detail && typeof detail.sectionId === "string" ? detail.sectionId : null;
  if (!sectionId) return null;

  const root = document.getElementById(`shopify-section-${sectionId}`);
  return root instanceof HTMLElement ? root : null;
}

export function connectShopifyLifecycle(runtime: ShopifyLifecycleRuntime): () => void {
  const removers = SHOPIFY_LIFECYCLE_ACTIONS.map(([type, action]) => {
    const listener = (event: Event): void => {
      const root = resolveLifecycleRoot(event);
      if (!root) return;
      runtime[action](root);
    };

    document.addEventListener(type, listener);
    return () => document.removeEventListener(type, listener);
  });

  return () => {
    for (const remove of removers) remove();
  };
}
