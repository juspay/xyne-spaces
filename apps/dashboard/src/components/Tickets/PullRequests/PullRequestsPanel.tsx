import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ticketPullRequestsApi,
  type TicketPullRequest,
} from '../../../api/ticketPullRequestsApi';
import { branchLabel, statusSwatch, validationSwatch } from './prPresentation';

// PullRequestsPanel — ticket-detail surface for the Bitbucket PR integration
// (SDLCT-0001). Lists PRs linked to a ticket, links an existing PR by URL, and
// creates a PR from the ticket. All actions are feature-flag gated by the
// backend; the panel hides create/link controls when the flags are off.
//
// Self-contained (inline styles + react-query) so it can be dropped into the
// ticket detail view without pulling in board-specific context.

interface PullRequestsPanelProps {
  ticketId: string;
}

const styles = {
  panel: {
    border: '1px solid #eaecf0',
    borderRadius: 8,
    padding: 16,
    fontSize: 13,
    color: '#101828',
    background: '#fff',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontWeight: 600, fontSize: 14 },
  actions: { display: 'flex', gap: 8 },
  button: {
    border: '1px solid #d0d5dd',
    borderRadius: 6,
    padding: '6px 10px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
  },
  primaryButton: {
    border: '1px solid #155eef',
    borderRadius: 6,
    padding: '6px 10px',
    background: '#155eef',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderTop: '1px solid #f2f4f7',
    gap: 12,
  },
  badge: { borderRadius: 12, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
  link: { color: '#155eef', textDecoration: 'none', fontWeight: 500 },
  meta: { color: '#667085', fontSize: 12 },
  empty: { color: '#667085', padding: '12px 0' },
  input: {
    border: '1px solid #d0d5dd',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box',
  },
  form: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 },
  formRow: { display: 'flex', gap: 8 },
  error: { color: '#b42318', fontSize: 12, marginTop: 4 },
} satisfies Record<string, CSSProperties>;

function readError(err: unknown): string {
  const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
  return anyErr?.response?.data?.error ?? anyErr?.message ?? 'Something went wrong';
}

export function PullRequestsPanel({ ticketId }: PullRequestsPanelProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'idle' | 'link' | 'create'>('idle');

  const flagsQuery = useQuery({
    queryKey: ['ticket-pr-flags'],
    queryFn: ticketPullRequestsApi.getFlags,
    staleTime: 5 * 60 * 1000,
  });

  const listQuery = useQuery({
    queryKey: ['ticket-prs', ticketId],
    queryFn: () => ticketPullRequestsApi.list(ticketId),
    enabled: flagsQuery.data?.ticket_pr_panel_enabled ?? false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ticket-prs', ticketId] });

  const refreshMutation = useMutation({
    mutationFn: (prRowId: string) => ticketPullRequestsApi.refresh(ticketId, prRowId),
    onSuccess: invalidate,
  });

  const unlinkMutation = useMutation({
    mutationFn: (prRowId: string) => ticketPullRequestsApi.unlink(ticketId, prRowId),
    onSuccess: invalidate,
  });

  // Panel is fully dark unless the flag is enabled for this workspace/user.
  if (flagsQuery.data && !flagsQuery.data.ticket_pr_panel_enabled) {
    return null;
  }

  const flags = flagsQuery.data;
  const prs = listQuery.data ?? [];

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.title}>Pull Requests</div>
        <div style={styles.actions}>
          {flags?.ticket_pr_link_enabled && (
            <button style={styles.button} onClick={() => setMode(mode === 'link' ? 'idle' : 'link')}>
              Link PR
            </button>
          )}
          {flags?.ticket_pr_create_enabled && (
            <button
              style={styles.primaryButton}
              onClick={() => setMode(mode === 'create' ? 'idle' : 'create')}
            >
              Create PR
            </button>
          )}
        </div>
      </div>

      {listQuery.isLoading && <div style={styles.meta}>Loading pull requests…</div>}
      {listQuery.isError && <div style={styles.error}>{readError(listQuery.error)}</div>}

      {!listQuery.isLoading && prs.length === 0 && (
        <div style={styles.empty}>No pull requests linked to this ticket yet.</div>
      )}

      {prs.map((pr) => (
        <PullRequestRow
          key={pr.id}
          pr={pr}
          onRefresh={() => refreshMutation.mutate(pr.id)}
          onUnlink={() => unlinkMutation.mutate(pr.id)}
          busy={refreshMutation.isPending || unlinkMutation.isPending}
        />
      ))}

      {mode === 'link' && (
        <LinkPrForm ticketId={ticketId} onDone={() => { setMode('idle'); invalidate(); }} />
      )}
      {mode === 'create' && (
        <CreatePrForm ticketId={ticketId} onDone={() => { setMode('idle'); invalidate(); }} />
      )}
    </div>
  );
}

function PullRequestRow({
  pr,
  onRefresh,
  onUnlink,
  busy,
}: {
  pr: TicketPullRequest;
  onRefresh: () => void;
  onUnlink: () => void;
  busy: boolean;
}) {
  const status = statusSwatch(pr.status);
  const validation = validationSwatch(pr.validation.state);
  return (
    <div style={styles.row}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {pr.prUrl ? (
            <a style={styles.link} href={pr.prUrl} target="_blank" rel="noreferrer">
              {pr.repoName} #{pr.prId}
            </a>
          ) : (
            <span style={styles.link}>{pr.repoName} #{pr.prId}</span>
          )}
          <span style={{ ...styles.badge, color: status.color, background: status.background }}>
            {status.label}
          </span>
          <span
            style={{ ...styles.badge, color: validation.color, background: validation.background }}
            title={pr.validation.message}
          >
            {validation.label}
          </span>
        </div>
        <div style={styles.meta}>{branchLabel(pr)}</div>
        {pr.validation.message && pr.validation.state !== 'valid' && (
          <div style={{ ...styles.meta, color: validation.color }}>{pr.validation.message}</div>
        )}
      </div>
      <div style={styles.actions}>
        <button style={styles.button} disabled={busy} onClick={onRefresh}>
          Refresh
        </button>
        <button style={styles.button} disabled={busy} onClick={onUnlink}>
          Unlink
        </button>
      </div>
    </div>
  );
}

function LinkPrForm({ ticketId, onDone }: { ticketId: string; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const mutation = useMutation({
    mutationFn: () => ticketPullRequestsApi.link(ticketId, url.trim()),
    onSuccess: onDone,
  });
  return (
    <div style={styles.form}>
      <input
        style={styles.input}
        placeholder="Paste a Bitbucket pull-request URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      {mutation.isError && <div style={styles.error}>{readError(mutation.error)}</div>}
      <div style={styles.formRow}>
        <button
          style={styles.primaryButton}
          disabled={!url.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Linking…' : 'Link'}
        </button>
        <button style={styles.button} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function CreatePrForm({ ticketId, onDone }: { ticketId: string; onDone: () => void }) {
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [sourceBranchName, setSourceBranchName] = useState('');
  const [destinationBranchName, setDestinationBranchName] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      ticketPullRequestsApi.create(ticketId, {
        repositoryUrl: repositoryUrl.trim(),
        sourceBranchName: sourceBranchName.trim(),
        destinationBranchName: destinationBranchName.trim(),
      }),
    onSuccess: onDone,
  });
  const ready =
    repositoryUrl.trim() && sourceBranchName.trim() && destinationBranchName.trim();
  return (
    <div style={styles.form}>
      <input
        style={styles.input}
        placeholder="Repository URL (https://bitbucket…/projects/KEY/repos/slug)"
        value={repositoryUrl}
        onChange={(e) => setRepositoryUrl(e.target.value)}
      />
      <div style={styles.formRow}>
        <input
          style={styles.input}
          placeholder="Source branch"
          value={sourceBranchName}
          onChange={(e) => setSourceBranchName(e.target.value)}
        />
        <input
          style={styles.input}
          placeholder="Destination branch"
          value={destinationBranchName}
          onChange={(e) => setDestinationBranchName(e.target.value)}
        />
      </div>
      {mutation.isError && <div style={styles.error}>{readError(mutation.error)}</div>}
      <div style={styles.formRow}>
        <button
          style={styles.primaryButton}
          disabled={!ready || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Creating…' : 'Create pull request'}
        </button>
        <button style={styles.button} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default PullRequestsPanel;
