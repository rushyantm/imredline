# Discard — housekeeping for reports and clips (0.6.0, second half)

Status: spec, 2026-09-16. Owner's ask, verbatim: "give me the admin a button on
all the sites and all the queues to discard certain things so I can do the
housekeeping myself, as well as you do it when you are finishing work or
getting instructions." Two surfaces, one verb, admin only.

Written for 0.6.0; 0.6.0 was published before this landed, so it ships as **0.7.0**.

## What "discard" means

| Surface | Discard = | Undo = | Where the truth lives |
|---|---|---|---|
| Report (queue) | closed as **not planned** on GitHub + label `discarded` | Restore → reopen + label removed | the issue's `state` + `state_reason` |
| Clip (gallery) | the clip folder AND its `clips/index.json` entry removed in **one commit** on `imredline-clips` | `git revert` of that commit (the commit message names the clip) | the branch |

A discarded report is not "done": nothing was fixed. The queue must show the
difference. A discarded clip is gone from the gallery; git history keeps it.

## Contract changes (the only ones)

### `Status`
`src/core/types.ts`: `STATUSES = ["open", "done", "discarded"]`. `QueueRow.status`
gains the third value. `parseIssue` (`src/core/issue.ts:182`):

```
closed && (state_reason === "not_planned" || labels has "discarded" || labels has "wontfix") → "discarded"
closed otherwise → "done"
open → "open"
```
`GhIssue` gains `state_reason?: string | null`. `wontfix` is accepted because
the `imredline-fix` skill's `skip` verb has been writing it; existing closed
issues without either signal stay `done`. Add unit tests for all five cases.

### `PATCH /api/report/<n>` (admin, existing route)
`{ status: "discarded" }` → `GitHub.setState(n, "closed", "not_planned")` and
add label `discarded` (Issues API `POST /issues/<n>/labels`, body `{labels:["discarded"]}`;
create the label on first use if GitHub answers 404 for it — colour `#9e9e9e`,
description "Discarded from the review queue"). Two calls; if the label call
fails the state still changed, answer `{ ok:true, status:"discarded", warning:"label not applied" }`.
`{ status: "open" }` from a discarded row → `setState(n, "open")` and
`DELETE /issues/<n>/labels/discarded` (ignore 404).
`{ status: "done" }` unchanged. Extend `setState(number, state, reason?)`.
Optional `{ why?: string }` (≤ 300 chars) → posted as an issue comment
`Discarded from the queue by <admin name>: <why>` before closing; without `why`
the comment is `Discarded from the queue by <admin name>.` One comment, always —
the reporter should read why their report went away.

Never touch the bot's labels (`triaged:*`, `plan-approved`, `pr-open`,
`merged`, `deployed`, `implement-failed`).

### `DELETE /api/clip?path=clips/<collection>/<slug>` (admin, NEW)
Path-jail with the same regex as `/api/clip-asset` minus the file. Flow:
1. read `clips/index.json` on `imredline-clips` (clips repo, `c.clipsRepo` aware);
   404 → `{error:"That clip does not exist here."}` when the path is not in it.
2. list the folder (`GET /contents/<path>?ref=imredline-clips`) to learn the
   files actually present (seven from the clip, `audit.md` when audited — do
   not hard-code the list).
3. `GitHub.commitFiles(branch, "discard <collection>/<slug> (by <admin name>)", [...])`
   with the index rewritten and every folder file marked for deletion.
   Extend `commitFiles` so a file entry may be `{ path, delete: true }` → tree
   entry `{ path, mode:"100644", type:"blob", sha: null }` (Git Data API
   deletes a path when `sha` is null). One commit, nothing half-lands.
4. answer `{ ok:true, commit:<sha>, path }`; `null` from commitFiles → 502
   "GitHub refused the change — the clip is still there."
Reports that reference the clip (`inspiration.path`) keep their line; the
queue's reference thumbnail already tolerates a 404 (verify; make it show
"reference discarded" instead of a broken image).

### Queue UI (`src/queue/client.ts`)
- Admin row actions: **Done / Reopen** as today, plus **Discard** on open rows
  and **Restore** on discarded rows. Discard is a two-click inline confirm
  (button turns into `Discard? ✓ ✕` with an optional one-line "why" input),
  never `window.confirm`. Then `PATCH { status:"discarded", why }`.
- A discarded row: muted (opacity .55), chip `discarded` (tone plain), the
  Done button hidden. Restore puts it back to open.
- Status filter gains `Discarded`; the default filter stays `Open`. The
  sub-line counts read `N open · M done · K discarded of T`.
- Non-admin reviewers see the `discarded` chip, no buttons.

### Gallery UI (`src/clips/client.ts`)
- `/api/clips` already returns `admin`; the client currently ignores it —
  read it.
- On the clip detail view, when admin: a ghost **Discard** button at the end
  of the action row, same two-click inline confirm (`Discard this clip? ✓ ✕`).
  On success: toast `Discarded <collection>/<slug>`, go back to the list with
  the card removed (drop it from the in-memory list; no refetch needed).
- On the card grid, when admin: no button (too easy to misclick); discard
  lives on the detail view only.

### CLI for the agent (`skills/imredline-fix/scripts/queue.mjs`)
Add verb `discard <owner/repo> <number> --why "…"` = comment + close with
`--reason "not planned"` + label `discarded` (via `gh issue close … --reason
"not planned"` and `gh issue edit … --add-label discarded`, creating the label
with `gh label create` on failure). Keep `skip` as an alias that does the same
(it used to add `wontfix`; switch it to `discarded`). Add
`skills/imredline-fix/scripts/clips.mjs` with `list <owner/repo>` (reads
`clips/index.json` off the branch with `gh api`) and `discard <owner/repo>
<clips/coll/slug> [--why "…"]` — same one-commit deletion through the Git Data
API with `gh api` (blobs not needed for deletes: tree entries with `sha:null`),
message `discard <coll>/<slug> (by claude): <why>`. Document both in
`skills/imredline-fix/SKILL.md` step 6 ("Not doing it? discard it, say why").

## Tests
- Unit (`test/unit/`): parseIssue status matrix; handler PATCH discarded →
  close call carries `state_reason:"not_planned"` and the label call happens;
  PATCH open from discarded removes the label; DELETE /api/clip: 401 for a
  reviewer, 400 bad path, 404 not in index, happy path builds a tree whose
  entries for the folder carry `sha:null` and the index no longer lists it;
  commitFiles with a delete entry. Mock `fetch` the way the existing handler
  tests do.
- Browser (`test/browser/`): you cannot launch Chrome in your sandbox — write
  the queue/gallery assertions into the existing suites (a discarded row is
  muted and its Done button absent; the gallery detail shows Discard only for
  the admin) and say in the handoff that they are unrun. Claude runs them.
- `npm run build && npm run check && npm run test:unit` must be green.

## Out of scope
Bulk select, discarding from the widget, deleting screenshots on
`imredline-assets` (issues keep their pictures), any change to the issue
body format, any change to the bot's labels.

## Handoff
Work on branch `codex/discard` in a clone under `.local/discard/` (the repo's
`.git` is read-only from your sandbox; `git fetch .local/discard codex/discard:codex/discard`
is how Claude collects it). Commit in small steps, conventional messages
(`feat:`, `test:`, `docs:`). End with a `HANDOFF-discard.md` at the clone root:
files touched, the exact commands you ran with their counts, what is unrun,
anything you chose that this spec left open.
