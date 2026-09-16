# Discard — 0.6.0 handoff

2026-09-16 (IST). Branch: `codex/discard`.
Clone: `/Users/Rishi/Documents/Claude/Projects/imredline/.local/discard`.
Base: `2e3d944` (includes DISCARD-SPEC and the inspiration work through `f51aa74`).

Implemented the discard spec. Version remains **0.6.0**. No report-body format,
bot-label, screenshot-branch, widget, dependency or package-version changes.

## Collect the work

From the original checkout, Claude can run:

```sh
git fetch .local/discard codex/discard:codex/discard
```

Then run the browser suites below before integrating. The original checkout's
`.git` was not written. All edits and commits are in this clone.

## Commits

- `bd6a8cc` feat: discard reports and clips through admin APIs
- `9e5fcd3` feat: add inline discard and restore controls to queue and gallery
- `9b0d80a` test: cover queue and gallery discard browser flows
- `c546073` feat: add report and clip discard CLI verbs
- `36744d0` fix: refuse unreadable clip data and sort all queue statuses
- `d2d8485` docs: explain discard housekeeping in 0.6.0
- A final docs commit adds this handoff.

## Files touched

| Files | Change |
| --- | --- |
| `src/core/types.ts`, `src/core/issue.ts` | Third status; optional state reason; five-case parser matrix. |
| `src/core/github.ts` | Optional close reason; delete tree entries with `sha:null` and no blob upload. |
| `src/core/handler.ts` | Admin discard/restore, comment and label handling; clip deletion and index rewrite; three-status ordering. |
| `src/queue/client.ts`, `src/core/page.ts` | Inline Discard/Restore, optional why, muted rows, filter/counts, missing-reference fallback. |
| `src/clips/client.ts`, `src/core/clips-page.ts` | Read admin flag; detail-only ghost Discard, inline confirm, toast and in-memory card removal. |
| `skills/imredline-fix/scripts/queue.mjs` | `discard`, `skip` alias, comment/close/label flow. |
| `skills/imredline-fix/scripts/clips.mjs` | New executable: JSON list and atomic discard through `gh api`. |
| `test/helpers/fake-github.mjs` | Comments, labels, state reasons, folder listing, delete entries and request-body recording. |
| `test/unit/issue.test.mjs`, `test/unit/github.test.mjs` | Status matrix and commitFiles deletion test. |
| `test/unit/handler.test.mjs` | Access, validation, comments, labels, restore, clips repo override, deletion, preserved entries and failed writes. |
| `test/unit/cli.test.mjs` | Ten tests exercising real script child processes with a fake `gh` on PATH. No live GitHub calls. |
| `test/browser/widget.mjs`, `test/browser/clip.mjs` | Existing suites extended for discard/restore, admin/reviewer controls, counts, confirmation/cancel and missing references. |
| `README.md`, `skills/imredline-fix/SKILL.md` | Extend the 0.6.0 inspiration notes and step 6. No CHANGELOG exists in this repo. |
| `HANDOFF-discard.md` | This handoff. |

## Checks run

All commands below ran from the clone root. The final gate passed:

```sh
npm run build && npm run check && npm run test:unit > /private/tmp/imredline-discard-gate.log 2>&1
```

**85 unit tests: 85 passed, 0 failed, 0 skipped, 0 cancelled.**
Build and TypeScript check both exited 0. This includes the 10 CLI tests.

Earlier validation commands and results:

```sh
npm run build && npm run check && npm run test:unit > /private/tmp/imredline-discard-core-tests.log 2>&1
```

70/70 passed at the API stage; build and check passed.

```sh
npm run build && npm run check
```

Passed after the UI work.

```sh
node --test test/unit/cli.test.mjs > /private/tmp/imredline-discard-cli-tests.log 2>&1
```

Ran twice: first 9 passed / 1 failed; the invalid-repo test exposed acceptance
of a `..` repo segment. Both CLI scripts now reject dot segments. Second run:
10 passed / 0 failed. The log contains the second run.

```sh
npm run build && npm run check && npm run test:unit > /private/tmp/imredline-discard-final-tests.log 2>&1
```

85/85 passed before the final commit pass. In total: four builds, four type
checks, three full unit runs, and two focused CLI runs.

Final syntax checks (four files, zero errors; no browser launched):

```sh
node --check test/browser/widget.mjs && node --check test/browser/clip.mjs && node --check skills/imredline-fix/scripts/queue.mjs && node --check skills/imredline-fix/scripts/clips.mjs
```

These pairs were also run earlier:

```sh
node --check test/browser/widget.mjs && node --check test/browser/clip.mjs
node --check skills/imredline-fix/scripts/queue.mjs && node --check skills/imredline-fix/scripts/clips.mjs
```

Diff checks passed with no whitespace errors:

```sh
git diff --check
git diff --check 2e3d944..HEAD
```

Build dependencies came from the existing checkout, with
`ln -s ../../node_modules node_modules`. That clone-local symlink is excluded
in `.git/info/exclude`. No install or lockfile change was needed.

## Unrun

Chrome was not launched. Browser assertions are **written but unrun**.
Claude should run:

```sh
npm run test:browser
```

This runs `node test/browser/capture.mjs`, `node test/browser/widget.mjs`, and
`node test/browser/clip.mjs`. `npm test` was not run because it launches those
browser suites. No live API or live CLI smoke test, publish or deployment ran.

## Choices where the spec left room

- API `why` must be a string of at most 300 characters; null/numbers are 400.
  Trim surrounding whitespace. Empty/whitespace why uses the no-reason comment.
  CLI reasons are trimmed and capped at 300 too; reports require a nonempty
  reason, clips do not. Neither CLI interpolates why through a shell.
- API comments/commit messages use the resolved admin's name (including a
  bring-your-own admin token), falling back to the configured admin name.
  CLI report comments name `claude`, matching the specified clip CLI identity.
- A refused comment stops before closing. A refused close stops before adding
  the label. Each discard invocation attempts one comment; no automatic
  whole-operation retries or new idempotency store were added.
- GitHub label colour is sent as `9e9e9e` (the API/CLI hex form of `#9e9e9e`).
  API label-create 422 is treated as a possible creation race and add is retried.
  CLI label-add failure triggers create then retry; a final failure exits 1
  and explicitly says the issue is already closed as not planned.
- Every PATCH to open removes only `discarded`, without an extra issue read.
  Missing label (404) is ignored. Other removal failures return success with
  `warning:"label not removed"`; open state still wins. Legacy `wontfix` and
  all bot labels are preserved. Restore posts no comment.
- Clip deletion uses the exact existing clip-asset folder jail: collection
  length 1–40 and slug length 1–48, lowercase letters/digits/hyphens. It does
  not substitute the different inspiration-path regex.
- Destructive index reads are strict JSON arrays with string paths; every
  other field is retained, including request IDs and unknown fields. Missing
  index/entry is 404; malformed index or a refused folder read is 502.
- Clip folders are flat under the existing contract. Delete every returned
  file, including audit.md and unfamiliar filenames. Refuse empty listings,
  nested directories or paths outside the target folder rather than leave
  part of a clip behind. No hard-coded deletion filename list.
- Clip CLI list prints the raw index as pretty JSON. Missing/unreadable branch
  or index exits 1. Discard prints `{ok,commit,path}` as JSON. Without why, the
  commit message ends at `(by claude)` with no trailing colon.
- Clip CLI reads index/folder from an immutable parent SHA and updates the
  branch with `force:false`. A competing branch update refuses the move;
  there is no automatic retry. The API retains the specified index/folder
  read followed by the existing commitFiles flow.
- Queue All order is open, done, discarded. Counts cover all rows, regardless
  of filters. After a status change, the current filter still applies.
- Confirm/cancel buttons have accessible names. Queue row controls are
  disabled during a write; failures keep the why input. Label warnings remain
  visible after a successful row update. Network errors ask for a reload to
  check the remote state instead of claiming no change occurred.
- Gallery toast lasts five seconds and has `role="status"`. Discard removes
  the card without a list refetch, retains current filters, and clears the
  detail URL. Late preview/README/audit responses cannot repopulate a detail
  that was left or discarded. The gallery confirm has no why input, as specified.
- Any reference thumbnail load failure replaces the image with the literal
  `reference discarded`; the inspiration links and issue line remain intact.
