# Contributing to IMRedline

Thanks for looking. This is a small, community-supported package. There is no
company behind it and no support desk: issues and pull requests are read when
there is time, usually within a couple of weeks. Bug reports with a failing
test get looked at first.

## Running it

```
npm install
npm run build        # tsc + esbuild; bakes the widget and queue bundles into dist/
npm run check        # type-check only
npm run test:unit    # node --test, fake GitHub, no network
npm run test:browser # real Chrome via Playwright (channel "chrome"); desktop + iPhone
```

The browser tests need Google Chrome installed and `playwright` available
(`npm i -g playwright` or a local install). They run against `test/browser/fixture.html`
and a fake GitHub in `test/helpers/fake-github.mjs`. Nothing in the test suite
reaches the network.

## What is welcome

- Bug fixes with a test.
- Adapters for other servers (Express, Hono, Fastify…) — wrap `imredline/node`
  or call `handle()` from `imredline/server`; keep them dependency-free.
- Better device detection, capture fixes for specific CSS, accessibility of the
  widget and queue.
- Documentation.

## What is frozen

**The issue body is a contract** (README § "The issue body is a contract").
Auto-fix bots and humans parse it. Existing fields never move or change shape;
new information is a new line. A change that breaks `parseIssue` on an issue
written by an older version is a bug, not a feature — there is a test for it.

The mount path `/imredline`, the env variable names, the `tester-feedback`
label and the `imredline-assets` branch are public API. Renaming any of them
is a major version.

**A clip folder is a contract too** (README § "Clip"). The `imredline-clips`
branch, the `clips/<collection>/<slug>/` layout, the seven file names and the
shape of `clips/index.json` are read by people and by coding agents that never
see this package. Add files or fields; never rename or remove them.

## Ground rules

- No new runtime dependencies without a discussion first. The server half has
  none; the capture half has one (`html2canvas-pro`).
- Never fetch a reviewer-supplied URL from the server. Links and paths are
  validated and quoted as text, never followed.
- Anything that widens what a non-admin reviewer can do (read other sites'
  reports, mint links, change status) needs a very good reason.
- Keep the widget silent for ordinary visitors: no markup, no requests, no
  download of the capture library unless a report is being sent.

## Security

If you find something that lets a visitor without a token do anything, or a
reviewer do something an admin should, please do not open a public issue —
use GitHub's private vulnerability reporting on this repository.

## Licence

MIT. By contributing you agree your contribution is licensed the same way.
