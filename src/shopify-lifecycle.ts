export interface ShopifyLifecycleRuntime {
  scan(root?: HTMLElement | null): void;
  observe(root?: HTMLElement | null): void;
  unobserve(root?: HTMLElement | null): void;
}

export interface ShopifyLifecyclePorts {
  resolveRoot(event: Event): HTMLElement | null;
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
const isSectionLifecycleEvent = (type: string): boolean => type.startsWith("shopify:section:");

function findClosestLifecycleRoot(
  target: EventTarget | null,
  selector: string,
): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const root = target.closest(selector);
  return root instanceof HTMLElement ? root : null;
}

export function resolveLifecycleRoot(event: Event): HTMLElement | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail = event.detail;
  if (!detail || typeof detail !== "object") return null;

  if (isBlockLifecycleEvent(event.type)) {
    const blockId =
      "blockId" in detail && typeof detail.blockId === "string" ? detail.blockId : null;
    if (blockId) {
      const root = document.getElementById(`shopify-block-${blockId}`);
      if (root instanceof HTMLElement) return root;
    }
    return findClosestLifecycleRoot(event.target, '[id^="shopify-block-"]');
  }

  if (isSectionLifecycleEvent(event.type)) {
    const sectionId =
      "sectionId" in detail && typeof detail.sectionId === "string" ? detail.sectionId : null;
    if (sectionId) {
      const root = document.getElementById(`shopify-section-${sectionId}`);
      if (root instanceof HTMLElement) return root;
    }
    return findClosestLifecycleRoot(event.target, '[id^="shopify-section-"]');
  }

  return null;
}

export function connectShopifyLifecycle(
  runtime: ShopifyLifecycleRuntime,
  ports: Partial<ShopifyLifecyclePorts> = {},
): () => void {
  const removers = SHOPIFY_LIFECYCLE_ACTIONS.map(([type, action]) => {
    const listener = (event: Event): void => {
      const root = ports.resolveRoot?.(event) ?? resolveLifecycleRoot(event);
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
