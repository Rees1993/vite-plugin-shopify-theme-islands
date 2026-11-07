import plugin from "vite-plugin-shopify-theme-islands";
import Island from "vite-plugin-shopify-theme-islands/island";
import { onIslandLoad, onIslandError } from "vite-plugin-shopify-theme-islands/events";
import { disconnect, scan, observe, unobserve } from "vite-plugin-shopify-theme-islands/revive";

plugin();
class Example extends Island(HTMLElement) {}

const offLoad: () => void = onIslandLoad((detail) => {
  const tag: string = detail.tag;
  const duration: number = detail.duration;
  const attempt: number = detail.attempt;
});
const offError: () => void = onIslandError((detail) => {
  const tag: string = detail.tag;
  const error: unknown = detail.error;
  const attempt: number = detail.attempt;
});

scan(document.body);
observe(document.body);
unobserve(document.body);
disconnect();
