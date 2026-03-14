# wurenju/frontend Recovery

`wurenju/frontend` originally landed in the superproject as a gitlink that pointed at submodule commit `3df51fb796248834e39f95839c3d6c5b7f4f9b89`.

That commit is no longer available in the local Git object databases, `.git/modules`, or other local repositories on this machine, so the original source tree could not be restored losslessly.

This directory has therefore been converted back into a normal tracked directory with:

- a minimal `Vite + React + TypeScript + Tailwind v4` recovery shell,
- the recovered dependency graph from `pnpm-lock.yaml`,
- the previously built frontend bundle preserved as static files under `public/`,
- and a growing set of original source files recovered from local Codex session logs under `~/.codex/sessions/`.

The static bundle remains available through `/legacy-shell.html`, and the current `src/main.tsx` still boots the recovery shell so `pnpm build` stays green while source recovery continues.

Recovered from session logs so far:

- app entry and routing: `src/App.tsx`, `src/pages/OfficePage.tsx`
- layout and chat UI: `src/components/layout/*`, `src/components/chat/*`
- office UI: `src/components/office/*` except `ConfigHistoryPanel.tsx` was restored from an `apply_patch` record
- modals and supporting UI: `src/components/modals/*`, `src/components/ui/ContextRing.tsx`, `src/components/ui/button.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/input.tsx`, `src/components/ui/spinner.tsx`, `src/components/ui/toast.tsx`, `src/components/ui/toaster.tsx`, `src/components/ui/textarea.tsx`, `src/components/ui/use-toast.ts`
- state, services, types, and utils: `src/stores/chatStore.ts`, `src/stores/groupStore.ts`, `src/stores/officeStore.ts`, `src/services/gateway.ts`, `src/services/gateway.test.ts`, `src/types/agent.ts`, `src/types/config.ts`, `src/types/gateway.ts`, `src/types/model.ts`, `src/utils/*`, `src/constants/agentTemplates.ts`

Still missing or incomplete:

- `src/stores/agentStore.ts`: large portions were recovered, but two line ranges are still missing from the available local logs, so the file has not been restored into the tree yet
- the original git object for submodule commit `3df51fb796248834e39f95839c3d6c5b7f4f9b89` is still unavailable locally, so this is not a lossless reconstruction

Until `agentStore.ts` is fully recovered, the repository intentionally keeps the recovery shell as the active entrypoint instead of wiring the restored app back into `main.tsx`.
