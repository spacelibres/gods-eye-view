# God's Eye View — Mandatory Rulebook

> **强制：任何模型/代理在执行任何操作前，必须完整阅读本文件。**
> **Mandatory: every model/agent must read this file completely before any action.**
>
> "Any action" includes reading files, planning, editing, running commands,
> installing packages, creating branches, committing, pushing, or proposing a
> design. If you have not read this file, stop. If you cannot follow it, ask the
> user instead of executing.

This file is the project rulebook. It overrides convenience, speed, prior
habits, other agents' suggestions, and assumptions. A change that violates these
rules must be reverted before work continues.

## 0. Mandatory pre-flight

Before touching the project, every model/agent must:

1. Read this entire file.
2. Run `git status --short` and `git branch --show-current`.
3. Read the documents relevant to the task:
   - `docs/CURRENT-STATE.md` — authoritative runtime behavior
   - `CONTRIBUTING.md` — setup, gates, style
   - `TESTING.md` — automated gates and how to run them
   - `docs/CODE-BOUNDARIES.md` — module/package ownership
   - `docs/I18N.md` when user-visible text is involved
4. State the intended scope and the files/areas to be touched.
5. Stop and ask if the request is ambiguous, destructive, or requires a
   dependency/architecture decision.

Do not start by editing. Do not "explore and see what happens." Understand
first, then act.

## 1. User intent and scope

- Do exactly what the user asked. Do not add unrequested features, libraries,
  frameworks, redesigns, "demonstrations", preview panels, dashboards, or
  speculative abstractions.
- Never replace a requested implementation with a mock, placeholder, sample,
  short hard-coded list, or a separate demo page.
- If the user rejects an approach, remove it completely: code, tests, docs,
  dependencies, build configuration, generated files, branches, and residual
  references. Do not leave dead code or a "just in case" flag behind.
- Do not infer extra requirements from a screenshot, a single error message, or
  a prior conversation. Ask when the deliverable is unclear.
- When requirements conflict, stop and ask. Do not choose silently.
- A large change requires an explicit plan and user approval before editing.

## 2. Protect the working tree

- Never run `git reset --hard`, `git checkout -f`, `git clean -fd`,
  `git restore` on files you did not change, force-push, rewrite published
  history, or delete a branch without explicit written approval.
- Never discard uncommitted changes you did not create. Inspect first; ask if
  ownership is unclear.
- Do not commit, amend, tag, push, open a PR, deploy, or publish unless the user
  explicitly asks for that action.
- Keep changes minimal, focused, and reviewable. Do not mix unrelated work.
- Do not modify generated output (`build/`, `dist/`) or vendored code.

## 3. Repository hygiene

- The repository root is not a log dump or scratch directory.
- Write transient logs under `.gev-logs/` (git-ignored). Never create
  `.gev-*.log`, `*.log`, dumps, screenshots, archives, or helper scripts in the
  repository root.
- Delete temporary files, logs, screenshots, caches, helper scripts, and test
  artifacts you create before finishing.
- Do not leave dev servers, watchers, browsers, or background processes running.
  Stop what you start.
- Do not commit `dist/`, `node_modules/`, `.gev-cache/`, `.gev-logs/`,
  `qa-shots/`, `qa-artifacts/`, or other generated artifacts.
- Keep `.gitignore` authoritative. If you introduce a new class of generated
  file, ignore it and document why.
- Do not add root-level files without a clear project reason; use the existing
  directory structure.
- Keep the root directory free of stale task files from previous agents.

## 4. Dependencies and external code

- Do not add, upgrade, downgrade, or remove a dependency without explicit user
  approval and a license/security review.
- No runtime CDN, GitHub, unpkg, font, script, or model downloads. Ship files
  with the build or route them through the existing server proxy.
- Prefer existing project patterns and dependencies. A new library is a last
  resort, not a first move.
- Never embed a large third-party renderer, symbol library, font, model, or
  dataset merely to "show" a feature. Prove the need, the license, the bundle
  cost, and the integration boundary first.
- If a library is approved, pin an exact compatible version and record it in
  `package.json`, `package-lock.json`, package boundaries, and the relevant
  documentation.

## 5. Architecture and ownership

- Read `docs/CODE-BOUNDARIES.md` and `scripts/package-boundaries.json` before
  moving code or adding an export.
- Respect ownership: sources acquire data, layers own data/state, renderers own
  Cesium resources, UI owns DOM, and app composition owns lifecycle.
- Do not move network/data logic into UI modules. Do not import the standalone
  bootstrap or Node services into portable packages.
- Do not edit generated `build/` output or `dist/`.
- Update package boundaries, imports, tests, and consumer call sites together.
- Do not invent a parallel subsystem when an existing owner can be extended.

## 6. Data, i18n, and UI behavior

- User-visible text must use `t()`, `tn()`, `msg()`, or a `data-i18n*` attribute.
  Run `npm run i18n`; all seven locales must stay complete.
- Preserve existing HUD density, selection, tracking, camera, motion, and
  data-source ownership unless the user explicitly asks to change them.
- Do not infer sensitive facts (affiliation, identity, intent, ownership) from
  nationality, location, or weak metadata. Unknown stays unknown.
- Do not present an approximation as an exact classification. Retain the source
  observation and state the mapping limitation.
- Keep standard/domain colors and semantics independent of the UI theme when the
  domain defines them.

## 7. Verification — evidence before claims

- Use the project's documented entry points: the `npm run ...` scripts in
  `package.json` and the headers of `scripts/*.mjs`. Do not substitute ad-hoc
  commands for `npm run build`, `npm test`, `npm run test:track`,
  `npm run build:panel`, `npm run format:check`, `npm run check:boundaries`, or a
  documented `qa-*.mjs` gate. The official entry point owns the flags, ports,
  fixtures, and cleanup.
- Before claiming completion, run the narrowest relevant test first, then the
  project gates:
  - `npm run format:check`
  - `npm run check:boundaries`
  - `npm run i18n`
  - `npm test`
  - `npm run build`
  - the focused `scripts/qa-*.mjs` gate and/or `npm run test:track` when the
    change touches runtime behavior
- Report the exact commands and results. Never say "passed" without output.
- Rerun an isolated failure to distinguish a product regression from an
  environment flake. Report which it was.
- If a gate cannot run, say why and list what remains unverified.
- Do not weaken tests, budgets, thresholds, or validation to make a change pass.

## 8. Git and release

**Versioning, changelog and tags are mandatory on every commit.** This is a hard
gate, not a preference. A commit that does not bump the version, write its
changelog entry and push its tag is incomplete; correct it before reporting the
work as done.

- **Commit directly to `main`.** Do not create or push a feature branch unless
  the owner explicitly asks for one.
- Commit only when asked. Follow the project commit style (Conventional-Commit
  prefix, imperative subject); the subject ends with the release version, e.g.
  `feat: show country flags in aviation cards v0.2.81`.
- **Bump the patch version by exactly one for every commit** (`0.2.80` →
  `0.2.81` → `0.2.82`) in both `package.json` and `package-lock.json`. Never
  reuse or skip a version.
- **Write the changelog entry for every version.** Add a
  `## [X.Y.Z] — YYYY-MM-DD — <summary>` section to `CHANGELOG.md`, newest first,
  describing what changed; its version must equal `package.json`'s, and
  `npm run changelog:check` must pass. A pull request may instead add
  `changelog.d/<pr-number>-<slug>.md`, which the release assembles.
- **Create and push an annotated tag for every version.** The tag is `vX.Y.Z`
  (`git tag -a`), its message is `vX.Y.Z: <summary>`, it points at the release
  commit, and it is pushed with `git push origin vX.Y.Z`. Never use a lightweight
  tag.
- Update `docs/CURRENT-STATE.md` for runtime behavior changes.
- **Never rewrite published history**: no force-push, no amending pushed
  commits, no moving or deleting a pushed tag, without explicit written approval.
- Publishing, deploying and VPS changes still require explicit approval in
  addition to the steps above.
- Keep published share-link tokens, immutable IDs, and reserved names stable.

## 9. Security and secrets

- Never commit keys, tokens, cookies, `.env*` files (except `.env.example`),
  credential-bearing logs, or browser URLs containing secrets.
- Keep provider keys server-side. Use the existing proxies, allowlists, limits,
  and caches.
- Do not weaken authentication, CORS, URL allowlists, rate limits, or input
  bounds.
- Do not put secrets in documentation, screenshots, test fixtures, or commit
  messages.

## 10. Editor and tooling noise

- Do not change project code to work around an editor, LSP, schema-download, or
  network error unless the project actually references the failing resource.
- First verify whether the failing URL/configuration is in the repository. If it
  is not, treat it as an editor/environment issue, report it, and ask before
  adding project-level editor configuration.
- Do not disable validation, formatting, linting, or gates to hide a warning.

## 11. Communication

- Before work: state what you will change and what you will not change.
- During work: report blockers, surprising findings, and scope changes.
- After work: list changed files, validation commands/results, and any
  follow-up work.
- If unsure, ask. Guessing is a rule violation.

## 12. Definition of done

A task is complete only when:

- The requested behavior exists and unrequested behavior was not added.
- No rejected approach, dead code, dependency, log, or temporary file remains.
- The working tree contains only intentional, explained changes.
- Relevant tests, boundaries, formatting, i18n, and build gates pass — or the
  remaining gaps are explicitly reported.
- The final message names the changed files and the validation actually run.
