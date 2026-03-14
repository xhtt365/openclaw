const LEGACY_URL = "/legacy-shell.html";
const SUBMODULE_COMMIT = "3df51fb796248834e39f95839c3d6c5b7f4f9b89";

function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-300">
                Wurenju Frontend
              </p>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  虾班前端恢复壳
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  原始 submodule commit 已无法从本机 Git 对象库恢复。当前目录已经改回普通目录，
                  并保留了现成的静态构建结果，方便后续继续补源码。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <a
                className="inline-flex items-center justify-center rounded-full bg-orange-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-orange-400"
                href={LEGACY_URL}
                rel="noreferrer"
                target="_blank"
              >
                新标签打开静态版
              </a>
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300">
                submodule commit: {SUBMODULE_COMMIT.slice(0, 12)}
              </span>
            </div>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-xl shadow-black/20">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">
                当前状态
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">普通目录已恢复</h2>
            </div>

            <ul className="space-y-3 text-sm leading-6 text-slate-300">
              <li>1. `wurenju/frontend` 已从 gitlink 改为普通目录。</li>
              <li>2. `pnpm-lock.yaml` 中记录的依赖已经重新落回 `package.json`。</li>
              <li>3. 当前可用的静态构建结果保存在 `public/` 下，避免已有界面完全丢失。</li>
              <li>4. 后续如果从历史会话找回更多源码，可以直接在这个目录继续补。</li>
            </ul>

            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
              这是恢复壳，不是假装完整源码。原始业务源码仍需要后续从历史会话或其他备份继续回填。
            </div>
          </aside>

          <section className="min-h-[70vh] overflow-hidden rounded-[28px] border border-white/10 bg-white shadow-2xl shadow-black/30">
            <iframe className="h-[70vh] w-full bg-white" src={LEGACY_URL} title="虾班静态恢复版" />
          </section>
        </section>
      </div>
    </main>
  );
}

export default App;
