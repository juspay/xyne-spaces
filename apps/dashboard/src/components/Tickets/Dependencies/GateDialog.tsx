import { useEffect, useState, useSyncExternalStore } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { useAuth } from '../../../hooks/useAuth';
import {
  dependencyConsent,
  validDependencyConsent,
  type DependencyConsentRequest,
} from '../../../services/dependencies/gate';

function GateDialogContent({ request }: { request: DependencyConsentRequest }) {
  const [reason, setReason] = useState('');
  const [adminOverride, setAdminOverride] = useState(false);
  const hard = request.gate.hardCount > 0;
  const canProceed = validDependencyConsent(request.gate, { reason, adminOverride });
  return (
    <Dialog
      open
      title={hard ? 'Stage move blocked' : 'Unresolved dependencies'}
      description='The stage has not changed. Dependency permissions will be checked again when you confirm.'
      zIndexClassName='z-[10001]'
      mobileVariant='dialog'
      onOpenChange={open => {
        if (!open) dependencyConsent.finish(request.token, null);
      }}
    >
      <form
        className='space-y-4'
        onSubmit={event => {
          event.preventDefault();
          if (canProceed)
            dependencyConsent.finish(request.token, { reason, ...(hard ? { adminOverride } : {}) });
        }}
      >
        <p className='text-sm text-muted-foreground'>
          {request.gate.hardCount} hard and {request.gate.softCount} soft dependencies remain
          unresolved. Restricted tickets are included; their details are not disclosed.
        </p>
        {(!hard || request.gate.canAdminOverride) && (
          <>
            <label className='block text-sm'>
              Reason
              {/* eslint-disable-next-line local-rules/require-tracking-on-click -- Private override reasons must never enter analytics. */}
              <textarea
                className='ph-no-capture mt-2 w-full rounded border border-border bg-background p-2'
                autoComplete='off'
                value={reason}
                maxLength={2000}
                required
                onChange={event => setReason(event.target.value)}
              />
            </label>
            {hard && (
              <label className='flex items-center gap-2 text-sm'>
                <input
                  type='checkbox'
                  checked={adminOverride}
                  data-track-category='TICKET_DEPENDENCIES'
                  data-track-name='GateAdminConsent'
                  onChange={event => setAdminOverride(event.target.checked)}
                />
                Override hard dependencies as a board administrator
              </label>
            )}
          </>
        )}
        {hard && !request.gate.canAdminOverride && (
          <p role='alert' className='text-sm'>
            Only a board administrator can override this move.
          </p>
        )}
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            data-track-category='TICKET_DEPENDENCIES'
            data-track-name='GateCancel'
            onClick={() => dependencyConsent.finish(request.token, null)}
          >
            Cancel
          </Button>
          {(!hard || request.gate.canAdminOverride) && (
            <Button
              type='submit'
              disabled={!canProceed}
              data-track-category='TICKET_DEPENDENCIES'
              data-track-name='GateConfirm'
            >
              {hard ? 'Override and move' : 'Move anyway'}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

export function DependencyGateHost() {
  const { user, isAuthenticated } = useAuth();
  const request = useSyncExternalStore(
    dependencyConsent.subscribe,
    dependencyConsent.getSnapshot,
    () => null,
  );
  const identity = isAuthenticated && user ? [user.workspaceId, user.id] : null;
  const matches = !!(
    request &&
    identity &&
    request.scope.startsWith(JSON.stringify(identity).slice(0, -1) + ',')
  );
  useEffect(() => {
    if (request && !matches) dependencyConsent.finish(request.token, null);
  }, [request, matches]);
  useEffect(() => () => dependencyConsent.cancel(), []);
  return request && matches ? <GateDialogContent key={request.token} request={request} /> : null;
}
