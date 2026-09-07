# Workspace guidance

Communicate in concise Chinese, retaining useful English technical terms. Author Harness files in English.

## Authority and scope

This workspace is a fresh redevelopment. The prior checkout outside this workspace is read-only reference material, not an implementation baseline. Preserve the intentional staged deletions; never restore old files merely to make commands pass. Ignore `.claude/worktrees/` during normal discovery.

Read `README.md` and `MAINTAINING.md` when joining. If local design/research files under `docs/` and `runtime/` exist, consult relevant sections as dated evidence, not requirements. They are intentionally ignored development material and absent from source distributions. Resolve contradictions against the current user request and the source contracts; record material unresolved conflicts in the local `runtime/Progress.md`.

## Product invariants

- Local Node/Hono + SQLite service, React UI, separate headed Chromium for CAS login. Follow Framework; no Fastify, PostgreSQL, desktop shell, or Python product runtime.
- Advise-only: no enrollment, withdrawal, or priority-changing endpoints in product source. Enforce the documented module, static, and runtime boundaries when implementing the adapter.
- Cookies and authentication material stay in `server/zdbk` and local private storage, outside API responses, logs, fixtures, diagnostics, and model requests.
- Keep concrete teaching sections distinct. Hard constraints and final validation belong to deterministic domain functions. Admission probability remains unavailable.
- Freeze shared contracts, including v2 LLM slots, before fixture UI, domain, and server implementation. Domain has no I/O; client never imports server. See Framework sections 3, 6, and 10.
- Identify synthetic fixtures. Preserve missing/unknown values rather than inventing zeros or upstream facts.

## Development

Use the App-selected WSL workspace. Run tools via `scripts/in-env <command> ...` or activate `conda activate zju-course-assistant`; do not accidentally use the global NVM Node. Setup and verification are in `MAINTAINING.md`.

Pin direct package versions and update the lockfile deliberately. Add product dependencies when the corresponding implementation slice needs them. Run checks appropriate to the changed behavior; workspace checks do not prove application or live-site acceptance.

Check Git status before editing. Keep changes in scope, never stage unrelated files, and preserve user work. Use native search, history, tools, and lifecycle first. Add extensions for a demonstrated need. For substantial document acquisition, delegate bounded extraction/deduplication to Luna, or ambiguous comparison to Terra, with a focused brief and source locations; retain interpretation and final synthesis in the main agent. Handle small lookups directly.

Proceed with authorized reversible work. Discuss changes to product scope, architecture, or external data boundaries before implementation when the decision is unresolved. Record meaningful results, remaining risks, and the next step in `runtime/Progress.md` without duplicating stable design.

## First-hand evidence

Do not repeat existing zdbk field archaeology or clone class-arrange. When a feature needs current evidence, identify the exact unknown and ask the user for the latest selection-page URL; the user offered to supply it. A URL is not permission to submit enrollment operations. Strip personal query parameters from durable notes.

Use `zju-source-verification` for live zdbk field verification and fixture derivation. The development Playwright MCP uses an isolated browser and must not share the application's CAS profile. Record observation dates and distinguish declarations, actual requests, and tested behavior.

class-arrange and Lazuli are interaction/reference sources only; implement independently. See `docs/BACKGROUND.md` and `docs/Workspace.md` for provenance and unresolved evidence.
