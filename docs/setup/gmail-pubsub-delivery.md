# Gmail Pub/Sub delivery: push or pull

Gmail tells us about new mail through Cloud Pub/Sub. `users.watch` makes Gmail publish
`{emailAddress, historyId}` to our topic, and the backend then reads the new messages
with `users.history.list` from the source's `lastSyncCursor`. The backend can receive
these notifications in one of two ways, set by `GOOGLE_PUBSUB_DELIVERY_MODE`.

| Mode | How a notification arrives | Needs |
| ---- | -------------------------- | ----- |
| `push` (default) | Pub/Sub POSTs to `BACKEND_URL/api/external-source-sync/google/ingest` with an OIDC token | A public endpoint Google's push servers can reach |
| `pull` | A worker holds an outbound StreamingPull connection to `pubsub.googleapis.com` and receives messages as they are published | Outbound access to Google APIs only |

Use `pull` on stacks that have no public endpoint, such as the external-VPN stack whose
load balancer admits only VPN addresses. StreamingPull delivers each message as soon as
it is published; there is no polling interval.

Both modes run the same ingest: the google adapter's preprocess (history from the
cursor, skipping Gmail ids already stored), transform and sync. Only the entry point
differs. Push checks the OIDC token; pull relies on IAM, since only principals with
subscriber access can read the subscription.

## Environment variables

| Variable | Default | Used by | Meaning |
| -------- | ------- | ------- | ------- |
| `GOOGLE_PUBSUB_DELIVERY_MODE` | `push` | API, worker | `push` or `pull` |
| `GOOGLE_CLOUD_PROJECT_ID` | — | API, worker | Project that owns the topic and subscriptions |
| `GOOGLE_PUBSUB_TOPIC` | `gmail-notifications` | API, worker | Topic `users.watch` publishes to |
| `GOOGLE_PUBSUB_PULL_SUBSCRIPTION` | `gmail-google-shared-<env>-pull` | API, worker | Pull subscription name. `<env>` is `sandbox`, `dev` or `prod`, derived from `BACKEND_URL` as for the push subscription |
| `GOOGLE_PUBSUB_DEAD_LETTER_TOPIC` | empty | API, worker | Optional. When set, a newly created pull subscription dead-letters messages after `GOOGLE_PUBSUB_MAX_DELIVERY_ATTEMPTS` |
| `GOOGLE_PUBSUB_MAX_DELIVERY_ATTEMPTS` | `10` | API, worker | 5–100 |
| `GOOGLE_PUBSUB_PULL_MAX_MESSAGES` | `16` | worker | Messages one worker holds unacknowledged at a time |
| `ENABLE_GMAIL_PULL_WORKER` | `false` | worker | Starts the subscriber. It starts only when this is `true` **and** the mode is `pull` |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT_BASE64` | empty | API, worker | Service-account key. Push needs it for the OIDC token. In pull mode, leave it empty to use Application Default Credentials (Workload Identity) |
| `GOOGLE_PUBSUB_PUSH_SUBSCRIPTION`, `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL` | empty | API | Push only: used to verify the push request |

## Switching a stack to pull

1. Create the infrastructure listed below. Creating the subscription in Terraform is
   preferred. If it is missing, the worker and Gmail source setup create it, but that
   needs `pubsub.subscriptions.create` on the project.
2. On the API and the worker, set `GOOGLE_PUBSUB_DELIVERY_MODE=pull`. Set
   `GOOGLE_PUBSUB_PULL_SUBSCRIPTION` if the subscription isn't named by the default.
3. On one worker deployment (the generic worker), set `ENABLE_GMAIL_PULL_WORKER=true`.
   Several replicas are fine, because Pub/Sub spreads messages across subscribers.
4. Deploy, then check the worker log for
   `[GmailPullWorker] started {"mode":"pull","subscription":"…"}`.
5. Send a mail to a connected desk and confirm the ticket appears.
6. Once pull works, delete the old push subscription by hand. Nothing deletes it
   automatically, and while both exist each notification is processed twice (safe,
   because ingest is idempotent, but wasted work).

To roll back, set the mode back to `push` and `ENABLE_GMAIL_PULL_WORKER=false`.

Existing `users.watch` registrations need no change, because they point at the topic,
not at a subscription.

## Infrastructure prerequisites (pull)

- **Topic**: `GOOGLE_PUBSUB_TOPIC` in `GOOGLE_CLOUD_PROJECT_ID`.
- **Gmail can publish**: `gmail-api-push@system.gserviceaccount.com` has
  `roles/pubsub.publisher` on the topic.
- **Pull subscription** on the topic: no push config, ack deadline 600s, retention
  7 days. Optionally add a retry policy (10s to 600s backoff) and a dead-letter topic.
  When the backend creates the subscription itself, it applies these values.
- **Worker can read**: the worker's service account (Workload Identity, or the key's
  account) has `roles/pubsub.subscriber` on the subscription.
- **API can see it**: connecting a Gmail source calls `subscriptions.get` on the pull
  subscription, so the API's account needs `roles/pubsub.viewer` on it. It also needs
  `pubsub.subscriptions.create` if the subscription isn't created in Terraform.
- **Dead-letter topic (optional)**: the Pub/Sub service agent
  `service-<project-number>@gcp-sa-pubsub.iam.gserviceaccount.com` needs Publisher on
  the dead-letter topic and Subscriber on the subscription.
- **VPC Service Controls**: if the topic's project is inside a perimeter, add an
  ingress rule that lets Gmail's publisher (`gmail-api-push@system.gserviceaccount.com`)
  call `pubsub.googleapis.com` to publish to the topic.
- **Private Google Access DNS**: `*.googleapis.com` → `restricted.googleapis.com`
  (199.36.153.4/30) covers Pub/Sub. The restricted VIP does not serve the Gmail API,
  so `gmail.googleapis.com` must resolve to `private.googleapis.com`
  (199.36.153.8/30). Otherwise `users.history.list`, `messages.get` and `users.watch`
  fail.

## Proxies

The Pub/Sub client uses gRPC (grpc-js). grpc-js reads only the lower-case
`grpc_proxy`, `https_proxy` and `http_proxy`, and the matching `no_grpc_proxy` or
`no_proxy`. It ignores `HTTPS_PROXY` and `NO_PROXY`. Pods that set only the
upper-case variables therefore already connect directly. As a guard, the pull-mode
client also sets `grpc.enable_http_proxy: 0`, so StreamingPull never goes through the
egress proxy (Squid) even if someone adds a lower-case `https_proxy`. You don't need to
set `no_grpc_proxy`.

The Gmail API and OAuth token calls use HTTPS (gaxios). gaxios does honour
`HTTPS_PROXY`, so `.googleapis.com` must stay in `NO_PROXY` for them to use the private
path. With Workload Identity, tokens come from the metadata server over plain HTTP. If
`HTTP_PROXY` is set, add `metadata.google.internal` and `169.254.169.254` to `NO_PROXY`.

## Ack, retry and duplicates

| Outcome | Action |
| ------- | ------ |
| Ingested (including "nothing new in history") | ack |
| Payload not `{emailAddress, historyId}` JSON | ack, logged |
| No source for the mailbox, source disconnected, mailbox doesn't match the source's credentials | ack, logged |
| Database lookup failed, credentials couldn't be decrypted, Gmail or ingest error | nack, so Pub/Sub redelivers with backoff and dead-letters after the max attempts |

Push answers 504 for a disconnected source, so Pub/Sub retries it until retention
expires. Pull acks it instead, because retrying can't help.

Redelivery and duplicate delivery are safe. Ingest resumes from `lastSyncCursor` and
skips Gmail ids that are already stored, and the cursor advances only after a batch
fully succeeds. In each worker, notifications for the same mailbox run one at a time,
so two of them don't race on the same cursor.

## Observability

- **Startup**: `[GmailPullWorker] started` with mode, subscription, topic, project,
  `maxMessages` and the credential type.
- **Per message**: a debug line on success. A warn line for every ack without ingest and
  every nack, with `messageId`, `deliveryAttempt`, `reason` and the mailbox.
- **Every 60s**: `[GmailPullWorker] last 60s` with received, processed, skipped and
  retried counts, stream errors, and the in-flight count.
- **Stream errors**: logged with their gRPC code. The client reconnects on its own.

On SIGTERM the worker stops taking messages (new arrivals are nacked), waits up to 25s
for in-flight ones, then closes the subscription. Unacknowledged messages are
redelivered to another replica.

## Code

- `apps/backend/src/workers/gmailPubSubPullWorker.ts`: the subscriber.
- `apps/backend/src/integrations/adapters/google/pubsubNotification.ts`: decoding, the
  mailbox check (shared with the push authenticator) and the ack/nack decisions.
- `apps/backend/src/services/googleService.ts`: `setupPullSubscription`,
  `createPubSubClient` and `getPullSubscriptionName`.
