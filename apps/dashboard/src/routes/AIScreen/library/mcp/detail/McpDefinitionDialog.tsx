import { type ReactElement, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button/Button';
import {
  mcpEditNeedsReview,
  updateMcpDefinition,
  type McpDefinitionPatch,
} from '@/services/claw/clawMcpService';
import type { McpServer } from '@/services/claw/clawMcpTypes';
import { V2Dialog } from '../../shared/primitives/V2Dialog';

/**
 * Edits a connector's own definition — what the connector IS, as opposed to the
 * credentials one user connects with.
 *
 * Deliberately limited to name, description and endpoint. The remaining
 * definition fields (credential schema, launch/http config templates,
 * healthcheck, write-tool policy) decide how the gateway executes a connector —
 * `servers.ts` hard-blocks stdio launch templates for exactly that reason — so
 * they are not editable from here.
 *
 * Access mirrors the server rule: connector author or CLAW_ADMIN. For a global
 * connector the submit queues an admin review instead of applying, which the
 * footer note says up front so nobody expects an immediate change.
 */
interface McpDefinitionDialogProps {
  server: McpServer;
  label: string;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (queuedForReview: boolean) => void;
}

export const McpDefinitionDialog = ({
  server,
  label,
  userId,
  open,
  onOpenChange,
  onSaved,
}: McpDefinitionDialogProps): ReactElement => {
  const needsReview = mcpEditNeedsReview(server);
  const [patch, setPatch] = useState<McpDefinitionPatch>({ name: server.name });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPatch({
        name: server.name,
        description: server.description ?? '',
        url: server.url ?? '',
      });
      setError(null);
    }
  }, [open, server.name, server.description, server.url]);

  const handleSubmit = async (): Promise<void> => {
    if (submitting || !patch.name.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      await updateMcpDefinition(userId, server, patch);
      onSaved(needsReview);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the definition.');
    } finally {
      setSubmitting(false);
    }
  };

  const field = (
    key: keyof McpDefinitionPatch,
    fieldLabel: string,
    placeholder: string,
  ): ReactElement => (
    <div className='flex flex-col gap-2'>
      <label htmlFor={`mcp-def-${key}`} className='text-sm font-medium leading-5 text-foreground'>
        {fieldLabel}
      </label>
      <input
        id={`mcp-def-${key}`}
        type='text'
        value={patch[key] ?? ''}
        placeholder={placeholder}
        onChange={(e): void => setPatch(prev => ({ ...prev, [key]: e.target.value }))}
        className='h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary'
        data-testid={`mcp-def-${key}`}
        data-track-category='Claw MCP'
        data-track-name='EditMcpDefinitionField'
      />
    </div>
  );

  return (
    <V2Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${label} definition`}
      description='Changes what this connector is for everyone who uses it.'
      testId='mcp-definition-dialog'
      footer={
        <>
          <Button
            variant='ghost'
            onClick={(): void => onOpenChange(false)}
            data-track-category='Claw MCP'
            data-track-name='CancelEditMcpDefinition'
          >
            Cancel
          </Button>
          <Button
            onClick={(): void => void handleSubmit()}
            disabled={submitting || !patch.name.trim()}
            data-track-category='Claw MCP'
            data-track-name='SubmitEditMcpDefinition'
          >
            {submitting ? 'Saving…' : needsReview ? 'Submit for review' : 'Save'}
          </Button>
        </>
      }
    >
      {needsReview && (
        <p className='rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-4 text-muted-foreground'>
          This is an org-wide connector, so your change goes to an admin review queue rather than
          applying straight away.
        </p>
      )}

      {field('name', 'Name', 'Grafana')}
      {field('description', 'Description', 'What this connector is for')}
      {field('url', 'Endpoint', 'https://example.com/mcp')}

      {error && <p className='text-sm leading-5 text-destructive'>{error}</p>}
    </V2Dialog>
  );
};
