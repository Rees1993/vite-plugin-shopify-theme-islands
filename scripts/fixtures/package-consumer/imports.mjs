import plugin from "vite-plugin-shopify-theme-islands";
import Island from "vite-plugin-shopify-theme-islands/island";
import { onIslandLoad, onIslandError } from "vite-plugin-shopify-theme-islands/events";

if (![plugin, Island, onIslandLoad, onIslandError].every((value) => typeof value === "function")) {
  throw Error("Invalid public JavaScript exports");
}
