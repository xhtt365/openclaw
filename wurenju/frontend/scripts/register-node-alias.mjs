import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(projectRoot, "src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const relativePath = specifier.slice(2);
      const targetUrl = pathToFileURL(path.join(srcRoot, relativePath)).href;
      return nextResolve(targetUrl, context);
    }

    return nextResolve(specifier, context);
  },
});
