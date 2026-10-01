# Agent creation: end-to-end script (local)

A run-through of creating an agent on a local stack, from an empty canvas to a saved agent that answers with real data. Each step says what to type or click and what you should see. Run it top to bottom the first time; after that, any scenario stands on its own.

Workspace URL below is `http://localhost:5173/<ws>`; swap in yours (Agent Hub is `/<ws>/ai/library`).

## Setup (once)

1. **Services.** mprocs is up: dashboard :5173, backend :3001, claw :3002, claw-auth :3003. Postgres, Redis and zero-cache containers are running (`docker start xyne-spaces-github-{postgres,redis,zero-cache}` after an OrbStack restart).
2. **GitHub sign-in.** On GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.
   - Homepage URL: `http://localhost:5173`
   - Authorization callback URL: `http://localhost:3003/claw/api/v1/github/callback`
   - Generate a client secret. In `apps/xyne-claw-auth/backend/.env` add:
     ```
     GITHUB_OAUTH_CLIENT_ID=<client id>
     GITHUB_OAUTH_CLIENT_SECRET=<client secret>
     ```
   - Restart **auth** in mprocs (select it, press `r`). GitHub now connects by signing in instead of a pasted token.
   - **First time on a fresh database:** GitHub's read tools (pull requests, issues, search) only reach the catalog once someone connects it. Open `/<ws>/ai/library/mcp/github`, **Connect**, sign in, then **Disconnect**. The tools stay, so the Build chat can add GitHub in scenario A and you still get to test its connect card.
3. **Google sign-in (Gmail, Calendar, Drive).** In Google Cloud console, pick or create a project.
   - APIs & Services → Library: enable Gmail API, Google Calendar API, Google Drive API, People API, Tasks API (Sheets, Docs, Slides and Forms if you'll use them).
   - OAuth consent screen: **Internal** if the project belongs to your Workspace (no test users, no "unverified app" screen). Otherwise **External** in Testing, with your account added as a test user.
   - Credentials → Create credentials → OAuth client ID → **Web application**. Authorized redirect URI: `http://localhost:3003/claw/api/v1/google/callback`.
   - In claw-auth's `.env`, replace the placeholders:
     ```
     GOOGLE_CLIENT_ID=<client id>
     GOOGLE_CLIENT_SECRET=<client secret>
     ```
   - Restart **auth**. With External/Testing, Google expires the sign-in after 7 days; connect again then.
4. **X sign-in (optional, for scenario D).** In the X developer portal, open your app → User authentication settings.
   - App permissions: Read. Type of app: Web App.
   - Callback URI: `http://127.0.0.1:3003/claw/api/v1/twitter/callback` (X rejects `localhost`).
   - Website URL: any https URL.
   - Keys and tokens → API Key and Secret. In claw-auth's `.env`:
     ```
     X_OAUTH_CONSUMER_KEY=<API key>
     X_OAUTH_CONSUMER_SECRET=<API key secret>
     ```
   - Restart **auth**. Searching posts needs X API Basic or higher; on the free tier the sign-in works but search returns 403.
5. **Web search (optional).** `PARALLEL_API_KEY=<key>` in `apps/xyne-claw/.env`, then restart **claw**. Without it the agent says search isn't configured.
6. Sign in at `http://localhost:5173` and open Agent Hub.

To run a connect step again later, open `/<ws>/ai/library/mcp/github` and click **Disconnect**.

---

## A. Morning triage (Xyne Spaces + GitHub, scheduled)

The main path: build with the Build chat, test as you go, connect GitHub from the chat, save.

| # | Do | Expect |
|---|----|--------|
| A1 | Agent Hub → **Create agent** | A fresh, empty canvas. The URL gains `?draft=<id>`. No old draft content. |
| A2 | In the test chat at the bottom (*Ask your agent anything*): `hi` | A short, natural hello. No "I'm not set up yet" disclaimer. The **+** button hides and the stop button is filled while it thinks. |
| A3 | Test chat: `what can you do?` | It says honestly that it has nothing to work with yet. Watch for it claiming abilities it doesn't have; the test chat runs on the fast model, which can over-promise. |
| A4 | Build chat: `Every weekday at 9am, go through my Xyne Spaces activity, DMs and mentions and my GitHub review requests, and tell me who to reply to first. Keep it short.` | Name, handle and description fill in. Schedule: weekdays at 9:00. MCP row: Xyne Spaces and GitHub. Instructions arrive a few lines at a time, each block fading in out of a blur (about 0.75s apart). |
| A5 | Same reply | A **Connect to unlock this** card for GitHub only. Xyne Spaces needs nothing: it runs on your sign-in. |
| A6 | If a question card appears (e.g. *What should the brief include?*) | Options you can tick several of. Pick two or three and send. The canvas updates. |
| A7 | Test chat: `what needs my reply this morning?` | Real items from your Spaces activity. Under the reply, a row **GitHub · Account not connected** with a GitHub connect card below it. |
| A8 | Click **Connect** on that card | GitHub's consent page for your OAuth app, asking for repo, org, profile and notifications access. |
| A9 | **Authorize** | Back on the same draft: the canvas comes into focus as one piece, a **GitHub connected** toast, `github_connected` gone from the URL (`?draft=` stays), the test chat open on the same conversation, and the card showing GitHub connected. |
| A10 | Test chat: `try again` | The answer now includes your GitHub review requests. No GitHub row this time. |
| A11 | Test chat: `reply to the first one saying I'll look after lunch` | It doesn't send anything. A row **Writes are off while testing**. |
| A12 | Test chat: `also check my Gmail for anything waiting on a reply, and my calendar for meetings before noon` | A **Connect to unlock this** card with Google and **Connect** (no Add row: connectors are connected, not added). |
| A13 | Click **Connect** | Google lands in the MCP row with its Gmail and Calendar read tools straight away, then the Google sign-in runs (or the dummy wait locally). The card reads **Connected** and **Ask again** appears. |
| A13b | **Connect** on the Google card | Google's account chooser, then its consent page listing Gmail, Calendar, Drive and the rest. (External/Testing shows "Google hasn't verified this app" first: Continue.) |
| A13c | Allow | Back on the draft with a *Google connected* toast and the card showing it connected. |
| A13d | Test chat: `try again` | The brief now has emails that need a reply and your meetings before noon, alongside Spaces and GitHub. |
| A14 | **Save** | A toast *@<handle> is ready*. The agent is in Agent Hub (its avatar there doesn't match the draft's yet; known). |
| A15 | Open the agent from Agent Hub and ask `what needs my reply this morning?` | Same quality of answer as A10, now from the saved agent (main model, so slower). |

## B. Drafts

| # | Do | Expect |
|---|----|--------|
| B1 | Create agent, then Build chat: `An agent that summarises my unread Spaces DMs every evening at 6` | A drafted canvas. |
| B2 | **Cancel** | A dialog with **Save draft**. |
| B3 | **Save draft** | Toast *Saved to Drafts in Agent Hub*; you land in Agent Hub with a **Drafts** section at the top, showing this draft with the same avatar as its canvas, a *Draft* pill and *Edited just now*. |
| B4 | **Create agent** | A fresh canvas, not the draft. |
| B5 | Back in Agent Hub, open the draft | The whole canvas comes into focus at once, quickly. The Build chat history is back. |
| B6 | **Cancel** | Leaves straight away (a kept draft doesn't ask again). |
| B7 | Draft card → ⋯ → **Delete draft** | Gone from Drafts. |
| B8 | Reload in the middle of B1 instead | The same draft comes back on reload, with the same focus-in. |

## C. Repo watcher (GitHub, real data)

Checks the GitHub token from the sign-in actually reads private data.

| # | Do | Expect |
|---|----|--------|
| C1 | Create agent → Build chat: `When I ask, tell me what merged today in juspay/xyne-spaces and flag anything risky` | GitHub in the MCP row. No connect card if A9 already connected GitHub. |
| C2 | Test chat: `what merged today?` | Real pull requests from the repo, with titles and authors. A private repo working proves the `repo` scope came through. |
| C3 | Test chat: `which of those touched auth?` | Follows up in the same conversation. |

## D. X reading list (optional, needs setup step 4)

| # | Do | Expect |
|---|----|--------|
| D1 | Create agent → Build chat: `Every morning, find 5 posts on X about chat composer design and agent UX worth reading` | Twitter / X in the MCP row and a connect card for it. |
| D2 | **Connect** | X's *Authorize app* page. |
| D3 | **Authorize app** | Back on the draft with a *Twitter / X connected* toast and the card showing it connected. |
| D4 | Test chat: `anything good today?` | Posts from X search. On the free API tier, an honest error about access instead. |
| D5 | Repeat D2 and press **Cancel** on X | Back on the draft with *wasn't connected: the sign-in was cancelled*. |

## E. Edges worth a pass

- **Build chat small talk:** `hi` gets a quick reply and leaves the canvas alone.
- **Cancel GitHub's sign-in:** on GitHub's page, cancel. Back on the draft with *GitHub wasn't connected: the sign-in was cancelled*.
- **Slow model:** if the Build chat planner is slow, a question still gets a real answer (not *I couldn't answer that just now*) unless the answering model fails too.
- **Leaving mid-test:** go to Agent Hub, then browser Back to the draft. The canvas is there but the test chat starts empty (leaving ends the test); a reload keeps it.
- **Web search without a key:** test chat `find me references for chat composer design` says search isn't configured and doesn't invent links.
