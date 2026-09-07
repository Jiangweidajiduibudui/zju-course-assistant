# 0.1.0-rc.2 — guided workbench prerelease

This prerelease includes the current independently implemented page-anchored beginner tour and independent native Windows x64 / WSL2 x64 runtime packages. The owner authorized publishing the corresponding source and release artifacts.

- First-use hints highlight actual page controls, follow scrolling/resizing, and switch to the relevant planning tab. Login, synchronization, plan creation and data-changing operations remain explicit user actions.
- The tour waits for course data and a selected plan before dependent steps, pauses for native dialogs, supports missing-target recovery, and can be skipped or replayed. It does not enable models or reviews.
- Windows: extract the ZIP and run `Start.cmd`; no WSL or development environment is required.
- WSL2: extract the tar.gz inside WSL2 and run `./start.sh`; view the workbench in the Windows browser. School login requires WSLg and compatible Chromium shared libraries.
- Both distributions include Node 22.23.2, pinned production dependencies, matching Chromium, third-party notices and per-file checksums. First launch is blank and logged out, with no embedded keys, personal plans or school data.
- Planning, candidate ordering, deterministic validation, teacher reviews, manually triggered summaries and AI proposals remain advise-only. A validated AI proposal can be saved as a separate plan; enrollment operations remain outside this application.

All 153 regression tests passed: 37 contracts, 24 domain, 69 server, 20 fixture UI and 3 HTTP browser tests. Strict types/lint, app build, OpenAPI drift and module boundaries also passed. The final target-platform release checks and artifact SHA-256 values accompany the downloadable packages. Target-platform package checks use bundled runtimes and headed Chromium with temporary data; they do not imply new school-login or provider acceptance.

Known limits: prerelease software, unsigned portable packages, no admission guarantee, and source/network/OS requirements remain separate from offline verification. Original project code remains all-rights-reserved pending the owner's license decision; third-party licenses remain included.
