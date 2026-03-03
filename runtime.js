// Browser ESM runtime for island architecture.
// Loaded via `virtual:shopify-theme-islands/revive` — do not import directly.

function media(query) {
  const m = window.matchMedia(query);
  return new Promise(function (resolve) {
    if (m.matches) resolve(true);
    else m.addEventListener('change', resolve, { once: true });
  });
}

function visible(element) {
  return new Promise(function (resolve) {
    const obs = new window.IntersectionObserver(function (entries) {
      for (const e of entries) {
        if (e.isIntersecting) {
          obs.disconnect();
          resolve(true);
          break;
        }
      }
    });
    obs.observe(element);
  });
}

function idle() {
  return new Promise(function (resolve) {
    if ('requestIdleCallback' in window) window.requestIdleCallback(resolve);
    else setTimeout(resolve, 200);
  });
}

export function revive(islands, options) {
  const pathPrefix = (options && options.pathPrefix) || '/frontend/js/islands/';
  const attrVisible = (options && options.directiveVisible) || 'client:visible';
  const attrMedia = (options && options.directiveMedia) || 'client:media';
  const attrIdle = (options && options.directiveIdle) || 'client:idle';

  const observer = new MutationObserver(function (mutations) {
    for (let i = 0; i < mutations.length; i++) {
      const { addedNodes } = mutations[i];
      for (let j = 0; j < addedNodes.length; j++) {
        const node = addedNodes[j];
        if (node.nodeType === 1) dfs(node);
      }
    }
  });

  async function dfs(node) {
    const tagName = node.tagName.toLowerCase();
    const loader = islands[pathPrefix + tagName + '.ts'] || islands[pathPrefix + tagName + '.js'];
    if (/-/.test(tagName) && loader) {
      if (node.hasAttribute(attrVisible)) await visible(node);
      const q = node.getAttribute(attrMedia);
      if (q) await media(q);
      if (node.hasAttribute(attrIdle)) await idle();
      // kick off the load; side effects (e.g. customElements.define) run on resolution
      loader().catch(console.error);
    }
    let child = node.firstElementChild;
    while (child) {
      dfs(child); // intentionally not awaited — process siblings in parallel
      child = child.nextElementSibling;
    }
  }

  dfs(document.body);
  observer.observe(document.body, { childList: true, subtree: true });
}
