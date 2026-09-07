# Maintaining ZJU Course Assistant

This source tree is a TypeScript application: Node/Hono and SQLite serve a React UI on loopback. A separate headed Chromium handles school CAS login. There is no desktop shell, Python product runtime, enrollment operation, optimizer or admission probability model.

## Reproduce the development environment

Use Node **22.23.2** and pnpm **10.33.2**. Direct versions and transitive resolutions are pinned. On the original WSL workspace, run commands with `scripts/in-env`; on another development host, activate an equivalent environment before running pnpm.

```sh
conda env create -f environment.yml
conda activate zju-course-assistant
pnpm install --frozen-lockfile
pnpm browser:install
pnpm build
pnpm start
```

Production starts empty. `pnpm demo` seeds explicitly synthetic courses in a separate local directory. `pnpm ui:dev` runs the synthetic fixture client and does not call a provider. Node compilation for `build` excludes test sources; the runtime release also excludes the demo entrypoint and all fixtures.

## Ownership and invariants

- `src/shared/contracts`: Zod wire schemas, frozen operation registry and generated `docs/api/openapi.json`. Change the contract before dependent modules. Snapshot schema is 1; Plan/archive schema is 2.
- `src/domain`: pure deterministic planning, validation and projection. No I/O. Concrete teaching sections stay distinct; unknown evidence never becomes zero or a fabricated fact.
- `src/server`: local token/origin guards, SQLite, model transport, anonymous external reviews and the exact school read allowlist. Authentication stays in `server/zdbk` and private storage. Never return it through APIs, model input, errors, logs or fixtures.
- `src/client`: React, the HTTP adapter, explicit settings/confirmation and the reviewable proposal lifecycle. Never import server modules. A model proposes within user candidates; deterministic validation and explicit copy-as-plan adoption decide whether it can be used.
- `tests` and `fixtures`: maintained synthetic regression evidence. Do not check in actual school data, reviews, credentials, screenshots, traces or manual-testing exports.

Model/review access is disabled initially. Opening reviews never triggers model generation. Identity ambiguities need confirmation; only matching course grades are displayed. Model keys live only in process memory. CAS and planning data are local. Windows storage defaults to `%LOCALAPPDATA%\ZJUCourseAssistant`; Linux storage defaults to `~/.local/share/zju-course-assistant/data`. `ZJU_DATA_DIR` and `ZJU_PORT` override these settings. Stop the process before any file-level recovery or deletion.

Original design/research/progress documents under `docs/` (except the generated API) and `runtime/` are local working material excluded from Git and release archives. A fresh clone is maintainable using this file, README, the source contracts and regression tests. Existing local documents can supply dated evidence, but do not treat older milestones as current requirements. Referenced interaction sources were not copied into the implementation.

## Verification

```sh
pnpm contracts:check
pnpm domain:check
pnpm server:check
pnpm ui:check
pnpm local:test
pnpm boundaries:check
pnpm workspace:check
```

`local:test` starts a disposable HTTP server and deletes its temporary storage. Browser runs and compilers create ignored `.local/` and `dist/` output. Remove these after validation if disk space is needed; keep maintained regression source. Live school/provider verification is separate from tests, requires explicit authority and must not introduce personal data into source or releases.

## Build an acceptance release

Two independent x64 distributions share the same application source. Windows uses a ZIP and `Start.cmd`; WSL2 uses a tar.gz started inside WSL2 with `./start.sh`, while its UI is viewed in the Windows browser. Each includes its own pinned Node, production dependencies and matching Chromium. User data remains outside the program directory. Linux requires compatible OS shared libraries and WSLg for school login.

1. Run the complete checks and `pnpm build` in the pinned development environment. Prepare each empty stage using `node scripts/release/prepare.mjs <stage>`.
2. **Windows:** obtain official Node `v22.23.2` Windows x64 ZIP and verify SHA-256 `1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97`. Using its `node.exe`, run `scripts/release/windows-dependencies.mjs <stage> <private tools directory>`. This uses the unchanged lockfile, a copied/hoisted layout, published native SQLite prebuild and a private browser directory. Windows operations can be orchestrated from WSL, but they must execute the Windows Node binary against Windows paths.
3. **WSL2:** run `node scripts/release/linux-dependencies.mjs <stage> <private tools directory>` on x86-64 Linux using the pinned development environment. It verifies and installs the official Linux Node archive, production dependencies and Chromium. The Linux Node SHA-256 is `d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307`.
4. Run `node scripts/release/finalize.mjs <stage> <win32|linux>` to remove host-path/build metadata, retain the target native prebuild, collect dependency licenses and generate a per-file manifest. Sources: [official Node distributions](https://nodejs.org/dist/v22.23.2/), [checksums](https://nodejs.org/dist/v22.23.2/SHASUMS256.txt) and [Playwright browser packaging](https://playwright.dev/docs/browsers#managing-browser-binaries).
5. Rename stages to `zju-course-assistant-0.1.0-rc.1-windows-x64` and `zju-course-assistant-0.1.0-rc.1-wsl2-x64`. Run each platform's bundled runtime with `scripts/release/smoke.mjs <stage> <report outside stage>`. The helper must run on the target platform, launches the actual user entrypoint with temporary data, opens the packaged headed browser, verifies a blank/disconnected workbench and closes/deletes its state. Never use WSL evidence to claim native Windows acceptance. `Start.cmd --check` or `./start.sh --check` provide a smaller user-facing runtime diagnostic.
6. Run `node scripts/release/archive.mjs <stage> <native smoke report>`. This verifies the target-platform report and every payload hash before creating the archive under `releases/`. Extract the finished artifacts and repeat the smoke checks from a different path, including WSL-service access from a Windows browser. Build a source archive with `pnpm release:source`; its explicit allowlist reads working files, never Git HEAD or the staged-deletion index.
7. Delete private build-tool directories, smoke profiles/data, traces, caches and intermediate package trees. Retain requested artifacts, checksum files and concise nonpersonal verification results. Do not publish/upload until owner acceptance.

The source archive includes maintained synthetic regression tests, contracts and environment locks. Local research/progress documents remain ignored. Original code is all-rights-reserved pending the owner's public-license decision; preserve third-party notices. Changes to versions, native platform, Chromium revision or packaging paths require fresh target-platform checks. The ZIP is unsigned and is not a desktop shell or signed installer.
