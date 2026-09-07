# 0.1.0-rc.1 — acceptance release

The preceding application functionality was manually accepted by the owner. This release prepares independent Windows x64 and WSL2 x64 distributions, plus one maintainable source archive. It has not been publicly published.

- Windows: extract the ZIP and run `Start.cmd`. Node, SQLite, headed Chromium and the service run natively on Windows. WSL is not required.
- WSL2: extract the tar.gz inside WSL2 and run `./start.sh`. The service and school-login Chromium run in WSL2; view the workbench in the Windows browser through localhost forwarding. WSLg is required for the school-login window.
- Both formats include pinned Node 22.23.2, production dependencies and the matching Chromium. Neither needs the development Conda environment. Linux still needs compatible OS shared libraries.
- Both start with no plans, school session, reviews or provider key. Model and review access are disabled. User data lives outside the extracted program directory; model keys remain process-local.
- Production compilation is separated from maintained synthetic tests and demo startup. Release payloads exclude demo fixtures, test source, development notes, caches, traces, backups and personal testing data.
- Read-only module boundaries, identity confirmation, deterministic validation and explicit model/adoption behavior remain unchanged.

Verification: 150 regression tests passed (37 contract, 24 domain, 69 server, 17 fixture UI and 3 HTTP browser tests), together with strict types/lint, app build, OpenAPI drift and module boundaries. Both native packaged runtimes rendered a blank workbench using their bundled headed Chromium; external access remained disabled. The Windows browser also rendered the WSL2 service through localhost forwarding. Final archive extraction and relocation results are recorded beside the distributions in RELEASE_CHECKS.json.

Known limits: no signed installer; no guarantee of admission; missing source data can prevent validation/adoption. Network access and OS/browser prerequisites are distinct from the offline package checks. No additional real school login or paid-model call was made after the personal-data reset.

Original project code remains all-rights-reserved pending the owner's public-license decision. Third-party notices and per-file checksums are included in each runtime distribution.
