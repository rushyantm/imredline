---
name: imredline-fix
description: Work the IMRedline review queue from the terminal — list the open tester-feedback reports a site's reviewers filed, look at each one's screenshot and pinned element, fix it in the code, ship, and close the issue with what changed. Use when the user says "fix the review queue", "work the queue", "what did the testers file", "clear the feedback", "/imredline-fix", or names a report number; also when a tester-feedback issue is mentioned.
---

# imredline-fix — the review queue, from a terminal

A reviewer pointed at something on the live site and typed a sentence. It is a
GitHub issue labelled `tester-feedback` whose body follows IMRedline's contract:
type, page, element (a CSS selector), device, note, screenshot path on the
`imredline-assets` branch, optional samples. This skill turns that list into
fixes. GitHub Issues is the whole store: the site's `/imredline/queue` page reads
the same issues, so closing here updates there.

## Which repo

The repo is the one the site files into (`IMREDLINE_GITHUB_REPO`). In a project
that runs IMRedline it is this repo's own `origin`; take it from
`git remote get-url origin`. When the user names a site, use that site's repo.

## Steps

Scripts live next to this file; they need `gh` signed in. Never print tokens.

1. **List** what is open:
   ```bash
   node "$SKILL_DIR/scripts/queue.mjs" list <owner/repo>
   ```
   Show the user the list in one breath (number, type, page, first line of the
   note). If they said "fix the review queue", work all of them oldest first;
   if they named numbers, only those.

2. **Show** one report — always, before touching code:
   ```bash
   node "$SKILL_DIR/scripts/queue.mjs" show <owner/repo> <number>
   ```
   Read the note, the page, the selector and the device. Open the screenshot
   path it prints with the Read tool: the red box marks what the reviewer
   pinned, and the picture often says more than the note. A `shot note` line
   means the picture is the surrounding section, not the element alone.

3. **Find the code.** The selector is the rendered DOM, not the source; map it
   to the component: grep for the `id`, a distinctive class, or the visible
   text from the screenshot. The page path narrows which route.

4. **Fix it, small.** Do what the note asks and nothing else. `Bug` = make it
   work. `Change` = change the thing named (copy, number, photo, layout).
   `Idea` = build it only if it is under an hour and clearly right; otherwise
   comment with a plan and leave it open. Respect the repo's own rules
   (CLAUDE.md / AGENTS.md): frozen strings, prices, legal lines, generated
   files.

5. **Check** the way this repo checks (its test command, its build). Then
   commit on the repo's normal branch flow with a message that names the
   report: `fix(review #12): shorten "Minimum stay" header`. Ship the way the
   repo ships (push, PR, `railway up` — read its README; never invent a deploy).

6. **Close** with the receipt:
   ```bash
   node "$SKILL_DIR/scripts/queue.mjs" done <owner/repo> <number> --commit <sha> --note "<one line: what changed, where>"
   ```
   Not doing it? Say why and close it honestly:
   ```bash
   node "$SKILL_DIR/scripts/queue.mjs" skip <owner/repo> <number> --why "<reason>"
   ```

7. **Report** to the user: a table of number → what changed → commit, the
   ones skipped and why, and whether the deploy happened or still needs them.

## Rules

- One report, one commit. A reviewer should be able to read the issue and
  the commit side by side.
- The reviewer's words win over your taste. If the note and the picture
  disagree, the picture is what they saw; ask before guessing when both are
  unclear.
- Never edit text the repo marks frozen, prices, legal notices or generated
  files to satisfy a report. Skip with the reason instead.
- Do not touch reports labelled `pr-open` or `fixing` — another agent (the
  auto-fix bot) has them. `needs-owner` reports are the owner's decision:
  list them, do not act.

## Codex

Codex has no skills folder. Paste the "Steps" and "Rules" sections above into
the repo's `AGENTS.md` under a heading `## Fix the review queue`, pointing at
`node_modules/imredline/skills/imredline-fix/scripts/queue.mjs` — or copy this
folder into the repo as `scripts/imredline-fix/`. Then "fix the review queue"
means the same thing in either terminal.
