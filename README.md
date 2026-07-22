# respectfb — Fork-Based Distributed Respect System

A git-native peer-to-peer respect/reputation system for GitHub users.
Each user's fork of this repo is their personal respect ledger. A GitHub App
handles authentication and commits. Respect syncs through pull requests.

## How It Works

```
  You (Browser)           GitHub App Server        Your Fork           Central Repo
  ┌──────────┐  OAuth    ┌──────────────┐  commit  ┌──────────┐  sync  ┌──────────┐
  │userscript│ ────────▶ │ Express App  │ ───────▶ │you/rspfb │ ──PR──▶│org/rspfb │
  │  👍 UI   │◀─ totals─ │ OAuth + API  │          │respects/ │        │aggregate │
  └──────────┘           └──────────────┘          │you.json  │        │totals    │
                                                    └──────────┘        └──────────┘
```

1. **Fork this repo** — your fork at `{you}/respectfb` is your personal ledger
2. **Login via OAuth** — the userscript opens a GitHub OAuth flow (no PAT needed)
3. **Give respect** — the GitHub App commits `respects/{you}.json` to YOUR fork
4. **Sync** — the App opens PRs from your fork back to this central repo
5. **Aggregate** — `aggregate.yml` computes totals from all merged ledgers
6. **Display** — the userscript reads totals and shows 👍 badges

## Repo Structure

```
respectfb/
├── respects/            # Per-user ledgers (one JSON file per user)
│   └── {username}.json  # Committed by the GitHub App
├── aggregate/           # Computed global totals
│   └── totals.json
├── schema.json          # JSON Schema for ledgers
├── .gitignore
├── .github/workflows/
│   └── aggregate.yml    # Runs on central repo after merges
└── README.md
```

## Setting Up Your Instance

### 1. Fork this repo

Click Fork → your `{username}/respectfb`.

### 2. Register a GitHub App

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App**
2. Set:
   - **Name**: `respectfb`
   - **Homepage URL**: your App server URL
   - **Callback URL**: `{server}/api/auth/callback`
   - **Webhook URL**: `{server}/webhook`
   - **Webhook secret**: a random string
3. **Permissions**:
   - Repository **Contents**: Read & write
   - Repository **Pull requests**: Read & write
   - Account **Email addresses**: Read-only
4. **Subscribe to events**: Push
5. Generate and download a **private key**
6. Note the **App ID**, **Client ID**, and **Client Secret**

### 3. Install the App

Install the GitHub App on your fork and the central repo.

### 4. Run the App server

```bash
cd app-server/
cp .env.example .env
# Fill in GITHUB_APP_ID, private key, CLIENT_ID, CLIENT_SECRET,
# CENTRAL_REPO_OWNER, CENTRAL_REPO_NAME, SESSION_SECRET, WEBHOOK_SECRET
npm install
npm start
```

### 5. Install the userscript

1. Open Violentmonkey → create new script
2. Paste `userscript/github-respect.user.js`
3. Save
4. Open Violentmonkey menu → ⚙️ Respect Settings
5. Set App Server URL → Save → click "Login with GitHub"

## Safety Guarantees

- **Authentication**: OAuth login verifies your GitHub identity — nobody can
  give respect on your behalf
- **Username validation**: strict GitHub username regex before any write
- **No self-respect**: you can't respect yourself
- **Duplicate detection**: you can only respect each person once
- **Concurrency**: per-user serialization prevents ledger races
- **Schema validation**: ledgers validated against `schema.json`
- **Error resilience**: malformed files are logged and skipped, never crash

## Data Format

**Ledger** (`respects/{user}.json`):
```json
{
  "user": "alice",
  "given": {
    "bob": { "score": 5, "reason": "great code reviews", "at": "2026-07-22T12:00:00Z" }
  },
  "meta": { "updated": "2026-07-22T12:00:00Z", "version": 1 }
}
```

**Totals** (`aggregate/totals.json`):
```json
{
  "generated_at": "2026-07-22T12:17:00Z",
  "total_ledgers": 42,
  "users": {
    "bob": { "score": 127, "respecters": 15 }
  }
}
```

## License

MIT
