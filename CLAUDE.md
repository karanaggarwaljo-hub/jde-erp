@AGENTS.md

# Merging PRs

Once a PR against `master` has been verified (clean `tsc`, clean `npm run build`, and — for
UI changes — a real browser check where one is reachable), merge it without asking for
confirmation first. The owner explicitly asked not to be asked again. This covers merging
only — it doesn't extend to other irreversible actions (force-push, deleting branches/data,
etc.), which still need a check-in first.
