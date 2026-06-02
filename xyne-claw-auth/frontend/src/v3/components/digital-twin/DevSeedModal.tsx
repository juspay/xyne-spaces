/**
 * DevSeedModal — dev utility for populating the Digital Twin with test data.
 *
 * Step 1: Upload a rich .md file → creates candidates (Candidates tab).
 * Step 2: Approve all pending candidates → fires the async Hindsight retain;
 *         polls listDigitalTwinMemories until memories land (usually 1-3s).
 * Step 3: Open Recall Tester and query the seeded content.
 *
 * Batches require the nightly pipeline — cannot be seeded via API.
 */
import { useState, useRef } from "react";
import { CheckCircleIcon, SpinnerGapIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  uploadDigitalTwinMd,
  approveDigitalTwinCluster,
  listDigitalTwinClusters,
  listDigitalTwinMemories,
} from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { useSnackbar } from "../ui/Snackbar";

// ── Test markdown ──────────────────────────────────────────────────────────────
// Spans all 8 subsystems so every cluster gets candidates.

const TEST_MD = `# Test Digital Twin Memories

## Communication Style
I prefer concise, direct responses with bullet points over long paragraphs. I almost always start replies with a quick acknowledgment before diving into detail. My tone is casual-professional — I avoid corporate jargon but stay clear and structured. When reviewing PRs I lead with what's good before flagging issues.

I respond to pings within 30 minutes during work hours and set clear OOO statuses otherwise.

## Technical Expertise
Deep expertise in TypeScript, React 19, and Node.js. I've been working with Tailwind CSS since v2 and recently adopted v4's new configuration model. Strong background in REST API design and PostgreSQL schema modeling including JSONB indexing strategies.

Comfortable with WebSockets and real-time collaboration systems. I built the live presence layer for Xyne Spaces. I'm also familiar with Radix UI primitives and how to compose accessible compound components on top of them.

I can navigate Rust code but don't write it day-to-day.

## Active Projects
Currently leading the Digital Twin V3 UI overhaul — a complete redesign of the memory management interface. The new design introduces a persistent two-column layout, a right-column review panel, and an inline subsystem graph visualization.

Also maintaining the Xyne Claw authentication service and the patterns frontend teams use to integrate with it. Actively reducing the number of full-page re-renders on tab navigation.

## Team Relationships
Work closely with Maya (backend) who owns the Hindsight memory pipeline. I rely on her for schema changes and backfill trigger APIs. My manager is David who handles product direction and unblocks cross-team dependencies.

Priya on design reviews most of my component work before it ships — she owns the Xyne design token system. I sync with the infra team (Leon) whenever I need new environment variables or service-to-service auth changes.

## Workflow Preferences
I use VS Code with the Vim extension and a custom snippet library for common React patterns. All my branches follow the pattern feature/short-description. I write commit messages in the imperative mood (Add, Fix, Update) and always include a Co-Authored-By line for pair sessions.

Strongly prefer TypeScript strict mode enabled everywhere. I avoid the any type and always leave a comment when forced to use it. I run tsc --noEmit and ESLint before every PR.

I prefer small, focused PRs over large feature branches — easier to review and faster to revert.

## Key Decisions
Decided to use Radix UI primitives for the modal and tooltip system rather than building from scratch — saves significant accessibility work and keeps keyboard navigation consistent across the product.

Chose to keep V1, V2, and V3 Digital Twin implementations side-by-side during the migration rather than doing a big-bang replacement. This lets us A/B-test in production without a feature flag system.

Elected not to use a state management library for the Digital Twin feature — React context and local state is sufficient and avoids the indirection cost.

## Context & Role
Senior Frontend Engineer at Xyne, around 2 years tenure. I focus primarily on the Spaces product and the Digital Twin feature area. I'm the de-facto owner of the V3 component library and the xyne design token conventions. Based in Berlin, working UTC+2, flexible on hours for cross-timezone meetings.

## Reference Documents
Authored the Digital Twin Architecture doc outlining the backfill pipeline, subsystem taxonomy, and review queue design. Also wrote the Xyne Component Design System guide covering the xyne token conventions and theming approach.

Maintains the frontend onboarding guide for new engineers joining the Spaces team.
`;

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS  = 15_000;

// ── Component ──────────────────────────────────────────────────────────────────

interface DevSeedModalProps {
  userId: string;
  open: boolean;
  onClose: () => void;
  /** Called after memories land in Hindsight so the parent can refresh tabs. */
  onSeeded: () => void;
}

type ApproveState =
  | { phase: "idle" }
  | { phase: "approving" }
  | { phase: "polling"; elapsed: number }
  | { phase: "done"; memoryCount: number }
  | { phase: "timeout" }
  | { phase: "error"; message: string };

export function DevSeedModal({ userId, open, onClose, onSeeded }: DevSeedModalProps) {
  const { show: showSnackbar } = useSnackbar();

  const [seeding,     setSeeding]     = useState(false);
  const [seededCount, setSeededCount] = useState<number | null>(null);
  const [approveState, setApproveState] = useState<ApproveState>({ phase: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Step 1: seed candidates via .md upload ────────────────────────────

  async function handleSeed() {
    setSeeding(true);
    setSeededCount(null);
    try {
      const result = await uploadDigitalTwinMd(userId, "dev-test-memories.md", TEST_MD);
      setSeededCount(result.candidatesCreated);
      showSnackbar({
        variant: "success",
        title: `${result.candidatesCreated} candidate${result.candidatesCreated === 1 ? "" : "s"} created`,
      });
    } catch (e) {
      showSnackbar({
        variant: "error",
        title: "Seed failed: " + (e instanceof Error ? e.message : String(e)),
      });
    } finally {
      setSeeding(false);
    }
  }

  // ── Step 2: approve all → poll until memories land ────────────────────

  async function handleApproveAll() {
    if (pollRef.current) clearInterval(pollRef.current);
    setApproveState({ phase: "approving" });

    try {
      // Fire approve for every pending cluster (202 async on backend)
      const { clusters } = await listDigitalTwinClusters(userId);
      const pending = clusters.filter((c) => c.pending > 0);
      for (const cluster of pending) {
        await approveDigitalTwinCluster(userId, cluster.subsystem);
      }
    } catch (e) {
      setApproveState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }

    // Backend runs setImmediate → poll until memories appear in Hindsight
    setApproveState({ phase: "polling", elapsed: 0 });
    const startedAt = Date.now();

    pollRef.current = setInterval(async () => {
      const elapsed = Date.now() - startedAt;

      if (elapsed >= POLL_TIMEOUT_MS) {
        clearInterval(pollRef.current!);
        setApproveState({ phase: "timeout" });
        return;
      }

      try {
        const { total } = await listDigitalTwinMemories(userId, { limit: 1 });
        setApproveState({ phase: "polling", elapsed });
        if (total > 0) {
          clearInterval(pollRef.current!);
          setApproveState({ phase: "done", memoryCount: total });
          showSnackbar({ variant: "success", title: `${total} memor${total === 1 ? "y" : "ies"} ready in Hindsight` });
          onSeeded();
        }
      } catch {
        // transient — keep polling
      }
    }, POLL_INTERVAL_MS);
  }

  const isPolling = approveState.phase === "polling";
  const isApproving = approveState.phase === "approving";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          if (pollRef.current) clearInterval(pollRef.current);
          onClose();
        }
      }}
      title="Dev seed tools"
      description="Populate the Digital Twin with test data. Run the steps in order."
      maxWidth={480}
      leftOffset={100}
    >
      {/* ── Step 1 ── */}
      <div className="rounded-xl border border-xyne-border bg-xyne-surface-sunken p-[14px]">
        <div className="flex items-start gap-[12px]">
          <StepNum n={1} done={seededCount !== null} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-[12px]">
              <div>
                <p className="text-[12px] font-semibold text-xyne-fg-primary">Seed candidates</p>
                <p className="mt-[2px] text-[11px] leading-relaxed text-xyne-fg-tertiary">
                  Uploads a test .md file with memories across all 8 subsystems.
                  They appear immediately in the <Chip>Candidates</Chip> tab.
                </p>
              </div>
              <Button variant="secondary" size="sm" disabled={seeding} onClick={handleSeed}>
                {seeding && <SpinnerGapIcon size={12} className="animate-spin" />}
                {seeding ? "Seeding…" : "Seed"}
              </Button>
            </div>
            {seededCount !== null && (
              <p className="mt-[8px] flex items-center gap-[5px] text-[11px] text-xyne-success-fg">
                <CheckCircleIcon size={12} weight="duotone" />
                {seededCount} candidate{seededCount === 1 ? "" : "s"} created
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Step 2 ── */}
      <div className="rounded-xl border border-xyne-border bg-xyne-surface-sunken p-[14px]">
        <div className="flex items-start gap-[12px]">
          <StepNum n={2} done={approveState.phase === "done"} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-[12px]">
              <div>
                <p className="text-[12px] font-semibold text-xyne-fg-primary">Approve all pending</p>
                <p className="mt-[2px] text-[11px] leading-relaxed text-xyne-fg-tertiary">
                  Auto-approves every pending candidate. The backend creates
                  memories asynchronously — we'll poll until they land.
                  Memories then appear in <Chip>All</Chip>, <Chip>Hot</Chip>, and <Chip>Graph</Chip>.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={isApproving || isPolling || approveState.phase === "done"}
                onClick={handleApproveAll}
              >
                {(isApproving || isPolling) && <SpinnerGapIcon size={12} className="animate-spin" />}
                {isApproving ? "Approving…" : isPolling ? "Waiting…" : "Approve all"}
              </Button>
            </div>

            {/* Status feedback */}
            {isApproving && (
              <p className="mt-[8px] text-[11px] text-xyne-fg-muted">Sending approve requests…</p>
            )}
            {isPolling && (
              <p className="mt-[8px] flex items-center gap-[5px] text-[11px] text-xyne-fg-muted">
                <SpinnerGapIcon size={11} className="animate-spin" />
                Waiting for Hindsight to persist memories…
                <span className="tabular-nums">
                  ({Math.round(approveState.elapsed / 1000)}s)
                </span>
              </p>
            )}
            {approveState.phase === "done" && (
              <p className="mt-[8px] flex items-center gap-[5px] text-[11px] text-xyne-success-fg">
                <CheckCircleIcon size={12} weight="duotone" />
                {approveState.memoryCount} memor{approveState.memoryCount === 1 ? "y" : "ies"} ready
              </p>
            )}
            {approveState.phase === "timeout" && (
              <p className="mt-[8px] flex items-center gap-[5px] text-[11px] text-xyne-warning-fg">
                <WarningCircleIcon size={12} weight="duotone" />
                Timed out — memories may still be processing. Check the All tab in a few seconds.
              </p>
            )}
            {approveState.phase === "error" && (
              <p className="mt-[8px] flex items-center gap-[5px] text-[11px] text-xyne-error-fg">
                <WarningCircleIcon size={12} weight="duotone" />
                {approveState.message}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Step 3 ── */}
      <div className="rounded-xl border border-xyne-border bg-xyne-surface-sunken p-[14px]">
        <div className="flex items-start gap-[12px]">
          <StepNum n={3} />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-xyne-fg-primary">Test recall</p>
            <p className="mt-[2px] text-[11px] leading-relaxed text-xyne-fg-tertiary">
              Open the <Chip>Recall Tester</Chip> tab and try queries like:
            </p>
            <ul className="mt-[6px] flex flex-col gap-[3px]">
              {[
                "What stack does this person use?",
                "Who do they work with?",
                "What are they currently building?",
              ].map((q) => (
                <li key={q} className="text-[11px] text-xyne-fg-secondary">
                  <span className="mr-[4px] text-xyne-fg-muted">·</span>
                  <em>"{q}"</em>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Batches note ── */}
      <div className="rounded-xl border border-dashed border-xyne-border p-[12px]">
        <p className="text-[11px] font-semibold text-xyne-fg-muted">Batches tab</p>
        <p className="mt-[2px] text-[11px] leading-relaxed text-xyne-fg-tertiary">
          Batches are produced by the nightly curation pipeline — they can't be seeded
          via API. Ask a backend engineer to trigger a manual run if you need to test this tab.
        </p>
      </div>
    </Dialog>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StepNum({ n, done }: { n: number; done?: boolean }) {
  return done ? (
    <CheckCircleIcon size={20} weight="duotone" className="mt-[1px] shrink-0 text-xyne-success-fg" />
  ) : (
    <span className="mt-[1px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full bg-xyne-fg-primary text-[10px] font-bold text-xyne-fg-inverse">
      {n}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-xyne-border bg-xyne-surface px-[5px] py-[0.5px] text-[10px] font-medium text-xyne-fg-primary">
      {children}
    </span>
  );
}
