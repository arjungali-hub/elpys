# Elpys — project notes for Claude Code

## Known issues / gotchas

Tooling and environment traps that have cost real time before — check here
before re-diagnosing something that's already been figured out:
`_work/docs/gotchas.md`.

## Development log

Every code change gets an entry in `_work/docs/dev-log.md` (newest first).
`_work/` is gitignored — use `git add -f` when committing changes to files
under it.

## Merging

Krish's standing instruction (2026-11-24): always merge to `main` and push
after finishing an update — don't wait to be asked. Still never merge the
parked branches (`feature/search-bar`, `feature/map-pin-clusters-parked`)
unless he names them.
