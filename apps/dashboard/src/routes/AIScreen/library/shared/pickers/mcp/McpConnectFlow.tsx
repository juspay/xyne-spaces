import { useEffect, useRef, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { FAKE_MCP_CONNECT } from '@/services/claw/fakeMcpConnect';
import { McpConnectForm } from './McpConnectForm';
import type { McpConnect } from './useMcpConnect';

/**
 * The step after Connect: OAuth connectors explain the browser sign-in and
 * continue to it; the rest ask for their credential fields. Shared by the MCP
 * detail panel and the connect card in the Build chat.
 */
export function McpConnectFlow({
  label,
  connect,
  onCancel,
  trackPrefix,
}: {
  label: string;
  connect: McpConnect;
  onCancel: () => void;
  /** Analytics name prefix, e.g. "Create agent v2". */
  trackPrefix: string;
}): ReactElement {
  if (FAKE_MCP_CONNECT) return <FakeConnectStep label={label} connect={connect} />;
  if (connect.strategy !== 'oauth') {
    return (
      <McpConnectForm
        fields={connect.fields}
        isPending={connect.isPending}
        error={connect.error}
        onCancel={onCancel}
        onSubmit={connect.connect}
      />
    );
  }
  return (
    <>
      <p className='text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
        {label} signs in through your browser. You will come back here once it is done.
      </p>
      {connect.error && <p className='text-xs leading-4 text-destructive'>{connect.error}</p>}
      <div className='flex items-center justify-end gap-1.5'>
        <button
          type='button'
          onClick={onCancel}
          data-track-category='Claw Agents'
          data-track-name={`${trackPrefix}: cancel MCP oauth`}
          className='flex h-7 items-center justify-center rounded-lg bg-card px-2 py-1.5 text-sm font-medium leading-5 text-foreground transition-colors hover:bg-muted'
        >
          Cancel
        </button>
        <button
          type='button'
          disabled={connect.isPending}
          onClick={() => connect.connect({})}
          data-track-category='Claw Agents'
          data-track-name={`${trackPrefix}: start MCP oauth`}
          className='flex h-7 items-center justify-center rounded-lg bg-foreground/[0.06] px-2 py-1.5 text-sm font-medium leading-5 text-foreground transition-colors hover:bg-foreground/[0.09] disabled:cursor-not-allowed disabled:opacity-50'
        >
          {connect.isPending ? 'Redirecting…' : 'Continue'}
        </button>
      </div>
    </>
  );
}

/** Local development (fakeMcpConnect.ts): no sign-in or form, it just connects. */
function FakeConnectStep({ label, connect }: { label: string; connect: McpConnect }): ReactElement {
  // Once, when the step opens: `connect.connect` is a new function every render.
  const start = useRef(connect.connect);
  useEffect(() => {
    start.current({});
  }, []);
  return (
    <p className='flex items-center gap-1.5 text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
      <Loader2 className='size-3 animate-spin' aria-hidden />
      Connecting {label}…
    </p>
  );
}
