# wurenju/frontend Recovery

`wurenju/frontend` originally landed in the superproject as a gitlink that pointed at submodule commit `3df51fb796248834e39f95839c3d6c5b7f4f9b89`.

That commit is no longer available in the local Git object databases, `.git/modules`, or other local repositories on this machine, so the original source tree could not be restored losslessly.

This directory has therefore been converted back into a normal tracked directory with:

- a minimal `Vite + React + TypeScript + Tailwind v4` shell,
- the recovered dependency graph from `pnpm-lock.yaml`,
- the previously built frontend bundle preserved as static files under `public/`.

The static bundle remains available through `/legacy-shell.html`, and the new app shell embeds it so the existing UI can still be loaded while the original source is recovered incrementally from history or rebuilt.
