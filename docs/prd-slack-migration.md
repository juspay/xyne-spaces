# Product Requirements Document — Self-Serve Slack Migration (Direct Messages & Channels)

## 1. Executive summary

This document proposes a **self-serve way for people to bring their Slack conversations — direct
messages (DMs), group DMs, and channels — into Xyne Spaces.**

The flow is simple: a person **provides their Slack access token** in a dashboard, and the system
**collects their conversations on our servers**, **streaming them directly into GCS (Google Cloud
Storage)**. Because the data is streamed piece-by-piece to GCS, the service **never holds gigabytes
in memory**, so there are no out-of-memory failures no matter how large a person's history is.
Loading that data into the live product is then a **separate, admin-controlled step**.

The design guarantees that **a conversation is never migrated twice**, protects the production
environment during large imports, and treats the data with the highest level of privacy and
security, since it contains people's private conversations.

This builds on a collection-and-loading capability we have **already built and validated**, which
loads conversations into Xyne Spaces with full fidelity (messages, threads, mentions, formatting,
and attachments) **without impacting the running service**.

---

## 2. Background & problem

- The existing live migration reads Slack history slowly and is heavily rate-limited by Slack.
  Migrating a single person's DMs can take **hours**, and it blocks on Slack the whole time.
- For privacy reasons, Slack only lets a person read **their own** DMs, so we need each person's
  **Slack access** to collect their messages.
- **Our approach — separate "collect" from "load":** a person provides their access once; we
  **collect** their history in the background, **streaming it into GCS** (still rate-limited by
  Slack, but this runs off to the side and blocks nothing), and then **load** it into the product in
  a fast, controlled step. This removes the slow live fetching from the critical path and lets us
  migrate at scale.

---

## 3. Objectives

**In scope**
- A dashboard where a person **provides their Slack access token**, after which the system
  **collects their DMs and group DMs server-side** into GCS.
- **Streamed collection** — data is written to GCS as it arrives, so the service never holds large
  volumes in memory (**no out-of-memory failures**).
- Extending the same **collect → store → load** pipeline to **channels** (collected centrally with a
  workspace-level token, rather than per person).
- Reliable handling of **large histories (multiple gigabytes)**, with clear failure handling and
  **automatic cleanup of incomplete (orphaned) collections**.
- Secure, dedicated GCS storage for collected data, with automatic deletion after use.
- An **admin-controlled** loading step; no impact on people using the product live.
- A firm guarantee that **the same conversation is never migrated more than once**.

**Out of scope**
- Ongoing, continuous syncing — this is a **one-time historical import**.
- Recovering content Slack never stored (e.g. Google Drive links shared in chat; these are
  preserved as clickable links rather than files).

---

## 4. How it works — the experience

A **single dashboard** with two sections, shown by role:
- **"Your migration"** — every member sees **only their own** submission and its live status.
- **"Admin control panel"** — admins see **all** migrations across both queues, **approve** them for
  ingestion, and **resume** any that fail.

**For a member:**
1. They **submit** — provide their token (DMs & group DMs) or the channel form (Stage 1). **DM
   migration is one-time**: a repeat token submission is **rejected**, and a **note** explains that an
   admin must delete the previous migration to redo it. **Channels** may be re-submitted for
   re-migration.
2. They watch their migration move through the stages on the dashboard:
   **Submitted → Collecting** (live progress bar) **→ Awaiting approval → Ingesting** (live progress
   bar) **→ Completed**.
3. When it turns **green (Completed)**, they are notified their conversations are ready.

**For an admin (control panel):**
1. Sees **all** migrations across both queues, with live status and progress.
2. **Approves** each migration for ingestion (Stage 3) — typically after preparing the environment
   and shifting users.
3. **Stops** a running job (graceful, at a batch boundary), **resumes** a stopped or failed job
   (a **stopped** job resumes **next**; a **failed** one re-queues at the **end** — both continue from
   the checkpoint), or **deletes** a job — deleting a collection-stage job also clears its GCS data.
   All from the dashboard.
4. **Exports** the migration history (status, counts, timings — **never** tokens or contents) and
   holds global **pause / throttle** controls for the whole pipeline.

**The four stages — each migration moves through these checkpoints on the dashboard:**

1. **Submission** — the person provides their inputs:
   - **DMs & group DMs:** their Slack access token.
   - **Channels:** a short form (Slack channel id, target Xyne Spaces channel id, start date, etc.) —
     the same inputs as today's channel-sync.
   On submit, a **job is created** and placed in the **Collection queue** (status: *Submitted*).

2. **Collection** — fetch & store. Jobs are picked **one at a time** (DMs, group DMs and channels
   share this queue). A **progress bar** shows conversations fetched and written to GCS. Each
   conversation that finishes is **recorded on the job**, so the work is checkpointed. When
   everything is fetched, the bar completes and the migration moves to approval.

3. **Ingestion approval** — a deliberate **admin gate**. Nothing loads into the product until an
   admin **approves** (typically after preparing the environment, §5.5). On approval, the job is
   pushed into the **Ingestion queue**.

4. **Ingestion** — load into the product. Jobs are picked **one at a time**. A **progress bar** shows
   *conversations ingested / total* (for DMs) or *messages ingested / total* (for channels).
   Ingestion runs in **batches**, and each batch updates the job — so the bar is accurate and the
   work is resumable. On success the collected data is **deleted from GCS** and the migration shows
   **green (completed)**.

**Two queues, each processed one job at a time:**
- **Collection queue** (Stage 1 → 2): fetch from Slack into GCS.
- **Ingestion queue** (Stage 3 → 4): load from GCS into the product.

**Fault tolerance & resume (see §5.9):**
- **Progress and checkpoints live on the job record.** Collection records **which conversations are
  already fetched**; ingestion records **how many batches are done**. The dashboard's progress bars
  read directly from this, so they are accurate and survive restarts.
- **If a worker/pod dies**, the job stops and the dashboard shows a clear failure (per the heartbeat
  rule, §5.9). The system **does not auto-retry** — **only an admin can resume**.
- **Resume continues from where it stopped:** collection skips conversations already fetched (into
  the **same GCS location**); ingestion skips conversations already loaded. Nothing is re-fetched or
  re-ingested (see the de-duplication guarantees, §5.6).
- **Resume position depends on why it stopped.** A **stopped** job (the admin deliberately paused it)
  resumes **next**; a **failed / pod-killed** job re-queues at the **end**, so a problematic job never
  blocks the others. Either way it continues from the checkpoint (position is just priority — it never
  affects correctness).

**Notes shown on the admin panel (the basics an admin needs at a glance):**
- **Processing is serial — one job at a time per queue.** Approving several just queues them in order;
  they don't run together.
- **Approve = go.** Approving sends a migration into ingestion — do it **only after** pre-prod is
  prepared and users are shifted. Ingestion loads into **pre-prod first**, then is **promoted to
  production** (environment choreography owned by Yash).
- **Stop is graceful.** It stops at the next batch boundary and leaves the job **resumable**, not lost.
- **Resume continues from the last checkpoint** — a **stopped** job resumes next, a **failed** one
  goes to the end of the queue; it never re-fetches or re-ingests anything already done.
- **Delete is destructive.** Deleting a **collection-stage** job also **removes its GCS data**;
  deleting a **completed DM** frees that person to submit again.
- **DM migration is one-time per person; channels can be re-migrated.**
- **Tokens are never shown or exported.** The history/export contains status, counts, and timings only.
- **Failed ≠ stuck.** A job is marked failed only after **~10 min with no heartbeat**; a rate-limited
  job keeps heartbeating, so a slow-but-alive job is not a failure.
- **Records are kept 6 months** for tracking; the underlying data in GCS is deleted after ingestion.
- **Each migration targets the workspace mapped from its Slack team** (§5.11); an unmapped team is rejected.

---

## 5. Key capabilities & design decisions

### 5.1 Two-phase design: collect first, load later
Separating **collection** from **loading** is the key architectural decision. Collection is
inherently slow (Slack rate-limits reads), so we run it as a **background** job that streams to GCS
and **blocks nothing**. Loading is fast and offline, and happens as a **deliberate, admin-controlled**
step. The slow part never sits on the critical path.

### 5.2 Memory-safe by design — never load too much into the pod (no OOM)
Neither fetching nor loading ever pulls a large amount of data into memory. **Collection streams
Slack → GCS** piece by piece, and **ingestion loads in small batches and streams attachments** — so
whether a history is megabytes or many gigabytes, the pod's memory footprint stays small and stable
(**no OOM**) at **every** stage. Jobs also run **strictly one at a time** (§5.4), so there is no
memory pile-up from concurrent work either. **Channels** use the same pipeline but are collected
**once centrally** with a workspace-level token (so we don't re-collect the same channel from every
member, and de-duplication is simpler); channel collection is **triggered by an admin through a
simple form** — the same pattern as our existing channel-sync — rather than per person.

### 5.3 Secure, dedicated GCS storage with automatic cleanup
Collected data is held in a **dedicated, access-restricted GCS bucket**, encrypted, with full access
logging. Each job records exactly where its data lives. When ingestion completes, that data is
**deleted immediately**, and an automatic retention rule removes anything left behind as a safety
net. Raw conversation data is never kept longer than necessary.

### 5.4 Admin control: serial processing, approval, resume, delete, export
Each queue runs **strictly one job at a time** — deliberately serial, **for accountability and clean
tracking**, never parallelized. Collection runs automatically as submissions arrive, but **loading
into the product requires an explicit admin approval per migration** (Stage 3): nothing is ingested
until an admin approves, typically after preparing the environment (§5.5). Admins can also:
- **Stop** a running job — a **graceful, cooperative stop at the next batch boundary** (never a
  mid-batch kill): the worker finishes the current batch, saves the checkpoint, and marks the job
  **stopped**, leaving a clean, resumable state (see §5.9). **Stop-everything** = pause the queue.
- **Resume** a stopped or failed job — a **stopped** job resumes **next**, a **failed** one re-queues
  at the **end**; both continue from the last checkpoint. (Position is only priority; it never affects
  correctness, since jobs are checkpointed.)
- **Delete** a job — and if it is still in the collection queue, its **data is also removed from GCS**.
- **Export** the migration history (status, counts, timings) — **never the token or message contents**.
- **Pause / throttle** the whole pipeline instantly via runtime configuration, without a code release.

**Job records are retained for 6 months** (metadata only — status, counts, who/when; never the token
or the conversations), so past migrations stay trackable, then they are purged. Members only ever see
and submit **their own** migration; the full queues and all admin actions are **admin-only**.

### 5.5 Loading data without impacting live users
Migrations run against a **pre-prod environment first**, with real-time syncing
**turned off** there so the bulk load is efficient. Loading reads from GCS and writes in **small
batches** (streaming attachments), so the pod's memory stays bounded no matter how large the history
is (**no OOM**, §5.2). The team coordinates the run as a controlled operation: prepare pre-prod,
**approve the migration** (§5.4), load and validate the conversations, then **promote the results to
production** and complete the environment cutover so the data becomes available to people.

Because migrated conversations are **brand-new** to the system, this promotion is purely additive —
it does not conflict with anything live users are doing. The only shared information is **people's
accounts**, which we match by email so we never create duplicate users. The pre-prod → production
sync (and the environment cutover it needs) is **owned by Yash** — see §9.

### 5.6 Guaranteed: no duplicate migrations, ever
This is a core requirement, enforced at multiple levels and applying to DMs, group DMs, and channels:
- Every conversation maps to a **single, deterministic identity** (for DMs, based on its
  participants) — so the same conversation always resolves to the same place, no matter who submits it.
- We keep a **registry of conversations already migrated**; before any work starts, we check it and
  skip anything already done.
- Individual messages are **de-duplicated** on the way in, so even a re-submission or a retry cannot
  create a second copy.
- Critically, if **both** people in a conversation submit it, the system recognises it as the
  **same** conversation and migrates it **once**.
- **DMs are one-time per person.** Once someone has submitted their DM/group-DM migration, further
  token submissions are **rejected** — DM migration runs **once**. To redo it, an **admin must
  delete** the existing migration first; the dashboard shows a **note** explaining this.
- **Channels are not limited this way** — the same channel can be **re-submitted for re-migration**,
  and the guarantees above keep a re-run from creating duplicates.
- Each conversation is **marked as migrated once it is loaded**, so **resuming or re-approving** a
  job never re-ingests what's already done — this is precisely what makes both queues safely resumable.

### 5.7 Token handling & custody
Because collection uses a person's Slack access, this gets first-class governance:
- Access is requested with the **minimum permissions** needed to read conversations, and is used
  **only during the Collection stage**.
- The token is stored **encrypted on the job**, **restricted and audited**, and **deleted (or
  revoked) as soon as collection completes**.
- The token is **never logged, exported, or shown** — it is excluded from all logs, the dashboard
  export, and every admin view, and is never exposed to the browser or to other users.
- People can **revoke** access at any time. This is the primary item for **Security review**.

### 5.8 Privacy & transparency
This is **highly sensitive data** — private conversations and personal information. Accordingly:
- Data is encrypted in transit and at rest; access is tightly restricted and fully audited. The
  **access token is deleted as soon as collection completes**; the **collected data is deleted once
  ingestion completes** (it is needed in between to load the conversations).
- A person can only submit **their own** conversations and can only see **their own** migration.
  Full-queue visibility and the ability to initiate are **restricted to admins**.
- People see a **live progress bar** while their data is being fetched — the count of conversations
  collected and stored, out of the total — so collection is transparent and never silent.
- Per organisation policy, conversations are **always migrated**; no per-participant consent step is
  required.

### 5.9 Reliability, failure handling & resume
- **Failure detection (heartbeat):** the worker sends a **heartbeat** (with progress) every few
  seconds, and **keeps heartbeating even while waiting on Slack rate limits**, so throttling is never
  mistaken for death. A job is marked **failed** only if its heartbeat goes silent for **~10 minutes**
  (a *stall* threshold, not a total-runtime limit). The live progress bar is driven by this heartbeat
  — it advances while healthy and flips to an error state when the heartbeat stops.
- **No auto-retry; admin resume only.** A failed job — in **either** the collection or the ingestion
  queue — stops and is **not** retried automatically. An **admin resumes** it, which **re-queues it at
  the end** of its queue (so a problematic job doesn't block healthy ones) and **continues from the
  last checkpoint**: collection skips conversations already fetched, ingestion skips conversations
  already loaded. Nothing is re-fetched or re-ingested (§5.6).
- **Stopping is graceful (voluntary stop).** An admin **Stop** sets a flag the worker checks **at each
  batch boundary**; it finishes the current batch, saves the checkpoint, and marks the job
  **stopped** — the same clean, resumable state as a failure, never a torn batch. Because the admin
  deliberately paused it, resuming a **stopped** job puts it at the **front** (it resumes next), unlike
  a failed job which goes to the end. This works for both collection (stops at a conversation boundary)
  and ingestion (stops at a batch boundary). Position is only priority — a resumed job always continues
  from its checkpoint.
  **Stop-everything** pauses the queue so no new jobs are picked while the in-flight one winds down.
- **Checkpoints live on the job.** Collection records which conversations are already fetched (into
  the same GCS location); ingestion records how many batches are done. This is what makes both queues
  resumable and drives the progress bars.
- **Cleanup.** When a migration **completes or is cancelled**, its collected data is **deleted from
  GCS**; a **background sweep** removes any GCS data whose job no longer exists, so nothing sensitive
  lingers.
- Loading is **idempotent**: interruptions, resumes, or re-approvals never produce duplicates or
  partial corruption. Conversation ordering reflects the **real message dates**, not the import time.

### 5.10 Status lifecycle & where things live (record vs data)
Two separate things, with different lifetimes:
- **The GCS data** (the actual conversations) — deleted the moment **ingestion completes** (or on
  delete/abandon).
- **The job record** — a small entry (status, counts, who, when; **no conversation content**) kept in
  the queue for **6 months**. This is what the dashboard reads. **Deleting the data never deletes the
  record**, so a migration still shows as *Completed* long after its data is gone.

Each migration moves through a status the UI renders, and the **status decides which admin actions
are available**:

| Status | Meaning | Admin actions |
|---|---|---|
| Submitted | queued for collection | Delete |
| Collecting | fetching Slack → GCS (progress bar) | Stop, Delete |
| Awaiting approval | collected; needs admin go-ahead | Approve, Delete |
| Ingesting | loading GCS → product (progress bar) | Stop, Delete |
| Stopped / Failed | halted mid-run, checkpoint saved | Resume, Delete |
| **Completed** | loaded; GCS data deleted | **Delete only** |

- **Completed is terminal** — no Resume, **no re-trigger**. A completed DM shows green with no re-run
  option, and the person cannot re-submit (DM is one-time). The only way to redo is an **admin
  Delete**, which removes the record and frees a fresh submission. **Channels** are the exception: a
  completed channel can be **re-submitted as a new job**.
- On completion the record's status is set to **Completed**, the **GCS data is deleted**, and the
  **token is cleared**; the record itself persists (via the queue's age-based retention) purely so the
  UI can show past migrations.

### 5.11 Workspace & identity resolution
- **The target workspace is derived, not chosen.** Each dump carries the Slack **team (workspace)
  id**; we map it to a single Xyne workspace via configured **team → workspace** mapping. A person's
  DMs and group DMs are always loaded into **their own** workspace. If a team has **no mapping**, the
  submission is **rejected** — we never silently fall back to a default, which could load into the
  wrong workspace.
- **People are matched by email — the source of truth.** Every participant (the owner and everyone in
  their conversations) is resolved **by email** within that one workspace: if the person already
  exists, we **reuse** their account; only genuinely-new people are created. This guarantees **no
  duplicate users** in the workspace.
- **A real person is never turned into a bot/app user.** Some Slack messages carry a bot id even
  though a real human wrote them (e.g. an "added an integration" system message). Those are attributed
  to the **human** (by email), and pure system messages are skipped — so we never mint an app/bot user
  for a real person. **Genuine bots** (reminders, GitHub, etc.) still map to app users, as they should.
- **Self-DMs** ("notes to self") are migrated as a personal conversation for the owner.

*Implementation note:* this identity logic — email-as-source-of-truth, human-over-bot attribution,
the system-message skips, and self-DM handling — lives in the loader and **must travel with it** when
the loader is promoted from the local tool to the production worker. The underlying Slack transform
treats any message carrying a bot id as a bot, so these safeguards are what enforce correct identity.

---

## 6. Success metrics
- Time to migrate one person's DMs drops from **hours to minutes** of hands-on effort.
- **Zero** duplicate conversations across all migrations.
- **Stable, low memory footprint** during **both collection and ingestion** — no out-of-memory
  incidents at any history size.
- No measurable impact on production performance during imports.
- Tokens deleted after collection and collected data after ingestion; **job records purged after
  6 months**; **zero** token leaks in logs or exports.

---

## 7. Rollout plan (phased)
1. **Foundation** — finalize the de-duplication guarantees and the validated loading engine as an
   automated background service.
2. **Collection** — token intake plus streamed, **checkpointed** server-side collection into GCS,
   with heartbeat failure detection and **admin resume** (DMs and group DMs).
3. **Dashboard, queues & approval** — the two-section dashboard with the **four-stage tracker**, the
   **collection and ingestion queues**, the **admin approval gate**, resume, and cleanup.
4. **Live-safe loading** — pre-prod import plus controlled promotion to production.
5. **Channels** — extend collection to channels via a central workspace token.
6. **Hardening & launch** — token-custody review, monitoring/alerting, and GA.

---

## 8. Risks
- **Data sensitivity & token custody** — mitigated by minimal permissions, encryption,
  least-privilege access, auditing, and prompt deletion/revocation after collection.
- **Slack rate limits during collection** — mitigated by the collect/load split (collection is off
  the critical path, so it blocks nothing) and automatic retry with back-off.
- **Production impact during promotion** — mitigated by pre-prod-first loading and admin-controlled,
  serial, one-at-a-time processing.
- **Interrupted job (collection or ingestion)** — work is **checkpointed on the job**, so a lost run
  shows a clear failure and an **admin resumes it from the last checkpoint** (re-queued at the end);
  nothing is re-fetched or re-ingested, and abandoned data is swept from GCS.

---

## 9. Decisions & ownership
1. **Production sync — owner: Yash.** Migrated data is ingested into **pre-prod**, then synced
   to production. Yash owns the environment choreography: **scaling down the pre-prod real-time
   (zero) service** and **moving users from pre-prod to production** around the sync.
2. **Consent — decided.** Conversations are **always migrated**; no per-participant consent step is
   required.
3. **Lifecycle, retention & one-per-person — decided.**
   - A job is created at **Submission** and moves through four stages (Submit → Collect → Approve →
     Ingest); **collection and ingestion are checkpointed on the job**, so both are resumable.
   - The **access token is deleted once collection completes**; the **collected data is deleted once
     ingestion completes** (and by a background sweep for any abandoned job). The **token is never
     logged or exported**.
   - The **job record is retained for 6 months** (metadata only), so past migrations stay trackable.
   - **Strictly one job at a time** per queue (serial, for accountability and tracking — not parallelized).
   - People see **live progress bars** for collection and ingestion; admins can **export** the
     history (status/counts/timings, never the token or contents).
   - **DMs are one-time per person** (repeat submissions rejected; an **admin must delete** to allow a
     redo — shown as a dashboard note). **Channels** may be **re-submitted for re-migration**.
   - Only an **admin can resume** a stopped or failed job (always continuing from the last checkpoint):
     a **stopped** job resumes **next** (front); a **failed / pod-killed** job re-queues at the **end**
     so it can't block healthy jobs. Admins can also **stop** a running job (graceful, at a batch
     boundary) or **delete** it — deleting a collection-queue job also **removes its data from GCS**.
4. **Channels — decided.** Channel collection is **admin-triggered via a form** (the same pattern as
   our existing channel-sync), using a central workspace token.
5. **Group DMs — decided.** No special handling needed: Slack creates a **new** group DM when
   membership changes, so each already has a stable member set to de-duplicate on.
6. **Workspace & identity resolution — decided.** DMs/group DMs load into the workspace **mapped from
   the dump's Slack team id** (team → workspace mapping); an **unmapped team is rejected**, never
   defaulted. All participants are matched **by email**, so no duplicate users are created and a real
   person is never created as a bot/app user (see §5.11). The loader's identity logic must be carried
   into the production worker.
