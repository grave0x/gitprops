# gitprops

Give props to people on GitHub. Data lives in git.

## What it does

A userscript adds a thumbs-up button next to usernames on GitHub. Click it, pick
a score (1-5), optionally say why. Your props are committed as JSON to this repo. 

A GitHub Action merges everyone's props into totals. The userscript polls and
shows scores next to usernames everywhere.

## Setup

### You need

- A GitHub App (for OAuth login)
- A server running the App code (Express + Octokit)
- The [userscript](userscript/github-respect.user.js) in Violentmonkey

### Quick start

[Install the userscript](https://github.com/grave0x/respectfb/raw/main/userscript/github-respect.user.js).
Set the App server URL in settings. Login with GitHub.

## How data is stored

Each user gets one file in `respects/`:

```json
{
  "user": "alice",
  "given": {
    "bob": { "score": 5, "reason": "great code reviews", "at": "2026-07-22T12:00:00Z" }
  }
}
```

Totals are computed hourly (or on push) by `.github/workflows/aggregate.yml` into
`aggregate/totals.json`:

```json
{
  "total_ledgers": 42,
  "users": {
    "bob": { "score": 127, "respecters": 15 }
  }
}
```

## License

MIT
