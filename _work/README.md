# _work — everything that is not the website

The root of this repo is the website. `index.html`, `styles.css`, the other
`*.html` pages, the root `*.js` files, `vercel.json`, `package.json`, and the
`api/`, `lib/` and `logos/` folders all have to stay exactly where they are:
Vercel serves from the root, `cleanUrls` maps `/about` to `/about.html` there, and
`api/*.js` only becomes a serverless function at that path.

## Two separate protections

1. **`.gitignore` lists `_work/`**, so nothing in here is committed by accident
   (a `git add -A` once swept a skill archive onto the live site — fixed in
   `568bb20`). Files that *should* be versioned are added on purpose with
   `git add -f`.
2. **`.vercelignore` lists `_work/`**, so even the files that ARE committed are
   never deployed. Until October 2026 only protection 1 existed, and the
   committed `_work/docs/dev-log.md` was publicly readable at
   `elpys.vercel.app/_work/docs/dev-log.md`. Do not remove either line.

## What lives where

| Folder | In git? | What goes in it |
|---|---|---|
| `docs/` | yes (`git add -f`) | `dev-log.md` (every code change, newest first) and `gotchas.md` (tooling traps). |
| `skills/elpys-opportunity-scout/` | yes (`git add -f`) | The version-of-record copy of the scout skill: `SKILL.md` plus `references/criteria.md`, `sourcing.md` and `output-format.md`, and a `SHA256SUMS` file. The live skill is installed in Krish's Claude account; when it changes, copy the new files here, regenerate `SHA256SUMS`, and commit, so the history (including the durable reject list in `criteria.md`) is never in only one place. |
| `prompts/` | no | Claude Code prompts waiting to be run. |
| `patches/` | no | `.patch` files from Cowork sessions that can't push to GitHub. Apply with `git apply`, commit, then move to `_archive/patches/`. |
| `design/` | no | Design sources for the loading states. Already built into `styles.css` and `loading.js`; nothing here is needed to run the site. |
| `_archive/` | no | Applied patches, finished prompts, old status reports and the superseded August 2026 scout zip. Kept for reference only — nothing here is current. |

Browser-automation logs (`logs/`, `.playwright-mcp/`) are throwaway and can be
deleted whenever a tool recreates them.

## Where the project's history lives

Not here. The canonical history is the Claude Doc "Elpys Project Context"
(https://claude.ai/code/artifact/f67a0234-adf6-4453-bd88-c6285fdeb71e) — its
Change log, and its "Reference & history notes" tab, which holds the org
verification protocol and the August 2026 legal and org-verification write-ups.
Scheduled-task reports are in the project note `/elpys-scheduled-task-reports.md`.
