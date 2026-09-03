import { type ReactElement, useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Button } from '../../ui/Button/Button';
import { AppResourceSection } from './AppResourceSection';
import { ATTACHABLE_RESOURCES } from './attachableResources';
import Input from '../../ui/Input/Input';
import Textarea from '../../ui/Textarea/Textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import type { InstalledApps } from '@xyne/shared';
import {
  Upload,
  Copy,
  Trash2,
  Plus,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Check,
  X,
  Lock,
  Zap,
  Info,
  Command,
  Shield,
  Boxes,
  Link2,
} from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { toast } from 'sonner';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import {
  appsService,
  type BotChannel,
  type ProjectBoard,
  type IncomingWebhook,
  type AppCommand,
  type UpsertCommandRequest,
  type AppShortcut,
  type UpsertShortcutRequest,
  type ShortcutType,
  type AppPermission,
} from '../../../services/Apps/appsService';
import { APPS_PUBLIC_BASE_URL } from '../../../config';
import { AppIncomingWebhookAction, CommandAccessibility, CommandType } from '@xyne/shared';

// ─── Inline command row ───────────────────────────────────────────────────────

interface CommandRowProps {
  command: AppCommand;
  onEdit: (command: AppCommand) => void;
  onDelete: (commandName: string) => void;
  readOnly?: boolean;
}

const CommandRow = ({
  command,
  onEdit,
  onDelete,
  readOnly = false,
}: CommandRowProps): ReactElement => (
  <div className='flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30 group'>
    <div className='flex-1 min-w-0'>
      <div className='flex items-center gap-2'>
        <span className='text-sm font-mono font-medium text-foreground'>
          /{command.commandName}
        </span>
        <div className='flex gap-1'>
          {command.isForChat && (
            <span className='text-[10px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'>
              chat
            </span>
          )}
          {command.isForThread && (
            <span className='text-[10px] px-1 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'>
              thread
            </span>
          )}
        </div>
      </div>
      <p className='text-xs text-muted-foreground truncate mt-0.5'>{command.description}</p>
    </div>
    {!readOnly && (
      <div className='flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 w-7 p-0'
          onClick={() => onEdit(command)}
          data-track-category='app-command'
          data-track-name='EDIT_COMMAND'
          title='Edit command'
        >
          <Pencil size={13} />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 w-7 p-0 text-destructive hover:text-destructive'
          onClick={() => onDelete(command.commandName)}
          data-track-category='app-command'
          data-track-name='DELETE_COMMAND'
          title='Delete command'
        >
          <Trash2 size={13} />
        </Button>
      </div>
    )}
  </div>
);

// ─── Inline add / edit form ───────────────────────────────────────────────────

interface CommandFormInlineProps {
  appId: string;
  initial?: AppCommand | null;
  onSaved: (cmd: AppCommand) => void;
  onCancel: () => void;
}

const CommandFormInline = ({
  appId,
  initial,
  onSaved,
  onCancel,
}: CommandFormInlineProps): ReactElement => {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(initial?.commandName ?? '');
  const [desc, setDesc] = useState(initial?.description ?? '');
  const [accessibility, setAccessibility] = useState<CommandAccessibility>(
    initial?.commandAccessibility ?? CommandAccessibility.BOTH,
  );
  const [nameError, setNameError] = useState('');

  const handleSave = async () => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
      setNameError('Command name is required');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(trimmed)) {
      setNameError('Only lowercase letters, numbers, and hyphens');
      return;
    }
    if (!desc.trim()) {
      toast.error('Description is required');
      return;
    }
    setSaving(true);
    try {
      const payload: UpsertCommandRequest = {
        commandName: trimmed,
        description: desc.trim(),
        commandType: CommandType.COMMAND,
        commandAccessibility: accessibility,
      };
      const saved = initial
        ? await appsService.updateCommand(appId, payload)
        : await appsService.createCommand(appId, payload);
      onSaved(saved);
    } catch (e) {
      toast.error('Failed to save command', {
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='p-3 rounded-md border border-ring bg-muted/20 space-y-2'>
      <div className='flex gap-2'>
        <div className='flex-1 space-y-1'>
          <label htmlFor='command-name' className='text-xs font-medium text-foreground'>
            Command name
          </label>
          <div className='relative'>
            <span className='absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm'>
              /
            </span>
            <Input
              id='command-name'
              className='pl-5 text-sm h-8'
              placeholder='e.g. sell'
              value={name}
              onChange={e => {
                setName(e.target.value);
                setNameError('');
              }}
              disabled={!!initial || saving}
            />
          </div>
          {nameError && <p className='text-xs text-destructive'>{nameError}</p>}
        </div>
      </div>
      <div className='space-y-1'>
        <label htmlFor='command-description' className='text-xs font-medium text-foreground'>
          Description
        </label>
        <Input
          id='command-description'
          className='text-sm h-8'
          placeholder='What does this command do?'
          value={desc}
          onChange={e => setDesc(e.target.value)}
          disabled={saving}
        />
      </div>
      <div className='flex gap-4'>
        <label className='flex items-center gap-1.5 text-xs text-foreground cursor-pointer'>
          <input
            type='radio'
            name='command-accessibility'
            checked={accessibility === CommandAccessibility.CHAT}
            onChange={() => setAccessibility(CommandAccessibility.CHAT)}
            disabled={saving}
            data-track-category='app-command'
            data-track-name='toggle-accessibility-chat'
          />
          Chat only
        </label>
        <label className='flex items-center gap-1.5 text-xs text-foreground cursor-pointer'>
          <input
            type='radio'
            name='command-accessibility'
            checked={accessibility === CommandAccessibility.THREAD}
            onChange={() => setAccessibility(CommandAccessibility.THREAD)}
            disabled={saving}
            data-track-category='app-command'
            data-track-name='toggle-accessibility-thread'
          />
          Threads only
        </label>
        <label className='flex items-center gap-1.5 text-xs cursor-pointer'>
          <input
            type='radio'
            name='command-accessibility'
            checked={accessibility === CommandAccessibility.BOTH}
            onChange={() => setAccessibility(CommandAccessibility.BOTH)}
            disabled={saving}
            data-track-category='app-command'
            data-track-name='toggle-accessibility-both'
          />
          Both
        </label>
      </div>
      <div className='flex gap-2 justify-end pt-1'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7'
          onClick={onCancel}
          data-track-category='app-command'
          data-track-name='CANCEL_COMMAND_FORM'
          disabled={saving}
        >
          <X size={13} className='mr-1' /> Cancel
        </Button>
        <Button
          type='button'
          size='sm'
          className='h-7'
          onClick={() => void handleSave()}
          data-track-category='app-command'
          data-track-name='SAVE_COMMAND'
          disabled={saving}
        >
          <Check size={13} className='mr-1' />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
};

// ─── Shortcut row ─────────────────────────────────────────────────────────────

interface ShortcutRowProps {
  shortcut: AppShortcut;
  onEdit: (shortcut: AppShortcut) => void;
  onDelete: (commandName: string) => void;
  readOnly?: boolean;
}

const ShortcutRow = ({
  shortcut,
  onEdit,
  onDelete,
  readOnly = false,
}: ShortcutRowProps): ReactElement => (
  <div className='flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30 group'>
    <div className='flex-shrink-0 w-6 h-6 rounded bg-primary/10 flex items-center justify-center'>
      <Zap className='w-3.5 h-3.5 text-primary' />
    </div>
    <div className='flex-1 min-w-0'>
      <div className='flex items-center gap-2'>
        <span className='text-sm font-mono font-medium text-foreground truncate'>
          {shortcut.commandName}
        </span>
        <span
          className={`text-[10px] px-1 py-0.5 rounded ${
            shortcut.commandAccessibility === CommandAccessibility.GLOBAL
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
          }`}
        >
          {shortcut.commandAccessibility?.toLowerCase() ?? 'global'}
        </span>
      </div>
      <p className='text-xs text-muted-foreground truncate mt-0.5'>{shortcut.description}</p>
    </div>
    {!readOnly && (
      <div className='flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 w-7 p-0'
          onClick={() => onEdit(shortcut)}
          data-track-category='app-shortcut'
          data-track-name='EDIT_SHORTCUT'
          title='Edit shortcut'
        >
          <Pencil size={13} />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 w-7 p-0 text-destructive hover:text-destructive'
          onClick={() => onDelete(shortcut.commandName)}
          data-track-category='app-shortcut'
          data-track-name='DELETE_SHORTCUT'
          title='Delete shortcut'
        >
          <Trash2 size={13} />
        </Button>
      </div>
    )}
  </div>
);

// ─── Inline shortcut form ─────────────────────────────────────────────────────

interface ShortcutFormInlineProps {
  appId: string;
  initial?: AppShortcut | null;
  onSaved: (s: AppShortcut) => void;
  onCancel: () => void;
}

const ShortcutFormInline = ({
  appId,
  initial,
  onSaved,
  onCancel,
}: ShortcutFormInlineProps): ReactElement => {
  const [saving, setSaving] = useState(false);
  const [commandName, setCommandName] = useState(initial?.commandName ?? '');
  const [desc, setDesc] = useState(initial?.description ?? '');
  const [type, setType] = useState<ShortcutType>(
    (initial?.commandAccessibility as ShortcutType) ?? 'GLOBAL',
  );
  const [nameError, setNameError] = useState('');

  const handleSave = async () => {
    const trimmedName = commandName.trim().toLowerCase();
    if (!trimmedName) {
      setNameError('Shortcut ID is required');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(trimmedName)) {
      setNameError('Only lowercase letters, numbers, and underscores');
      return;
    }
    if (!desc.trim()) {
      toast.error('Description is required');
      return;
    }
    setSaving(true);
    try {
      const payload: UpsertShortcutRequest = {
        commandName: trimmedName,
        description: desc.trim(),
        shortcutType: type,
      };
      const saved = initial
        ? await appsService.updateShortcut(appId, payload)
        : await appsService.createShortcut(appId, payload);
      onSaved(saved);
    } catch (e) {
      toast.error('Failed to save shortcut', {
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='p-3 rounded-md border border-ring bg-muted/20 space-y-2'>
      <div className='space-y-1'>
        <label htmlFor='shortcut-command-name' className='text-xs font-medium text-foreground'>
          Shortcut ID
        </label>
        <Input
          id='shortcut-command-name'
          className='text-sm h-8 font-mono'
          placeholder='e.g. create_task'
          value={commandName}
          onChange={e => {
            setCommandName(e.target.value);
            setNameError('');
          }}
          disabled={!!initial || saving}
        />
        {nameError && <p className='text-xs text-destructive'>{nameError}</p>}
      </div>
      <div className='space-y-1'>
        <label htmlFor='shortcut-description' className='text-xs font-medium text-foreground'>
          Description
        </label>
        <Input
          id='shortcut-description'
          className='text-sm h-8'
          placeholder='What does this shortcut do?'
          value={desc}
          onChange={e => setDesc(e.target.value)}
          disabled={saving}
        />
      </div>
      <div className='flex gap-4'>
        <label className='flex items-center gap-1.5 text-xs cursor-pointer'>
          <input
            type='radio'
            name='shortcut-type'
            checked={type === 'GLOBAL'}
            onChange={() => setType('GLOBAL')}
            disabled={saving}
            data-track-category='app-shortcut'
            data-track-name='toggle-type-global'
          />
          Global
        </label>
        <label className='flex items-center gap-1.5 text-xs cursor-pointer'>
          <input
            type='radio'
            name='shortcut-type'
            checked={type === 'MESSAGE'}
            onChange={() => setType('MESSAGE')}
            disabled={saving}
            data-track-category='app-shortcut'
            data-track-name='toggle-type-message'
          />
          Message
        </label>
      </div>
      <div className='flex gap-2 justify-end pt-1'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7'
          onClick={onCancel}
          data-track-category='app-shortcut'
          data-track-name='CANCEL_SHORTCUT_FORM'
          disabled={saving}
        >
          <X size={13} className='mr-1' /> Cancel
        </Button>
        <Button
          type='button'
          size='sm'
          className='h-7'
          onClick={() => void handleSave()}
          data-track-category='app-shortcut'
          data-track-name='SAVE_SHORTCUT'
          disabled={saving}
        >
          <Check size={13} className='mr-1' />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
};

// ─── Permissions section ──────────────────────────────────────────────────────

interface PermissionsSectionProps {
  appId: string;
  isInstalled: boolean;
  // 'template' -> edits app_permission (creator, Org/Marketplace). 'install' -> edits this
  // workspace's installed_app_permissions (admin, Installed screen).
  editMode: 'template' | 'install';
  installedAppId: string | null;
  // true -> render the section but lock every control (app creator on the Installed screen).
  readOnly?: boolean;
}

const PermissionsSection = ({
  appId,
  isInstalled,
  editMode,
  installedAppId,
  readOnly = false,
}: PermissionsSectionProps): ReactElement => {
  const isInstallMode = editMode === 'install' && !!installedAppId;
  const [available, setAvailable] = useState<AppPermission[]>([]);
  // Local selection — always editable regardless of install state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Per-permission status map: scope → 'UNAPPROVED' | 'APPROVED' | 'PENDINGDELETE'
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Everything the `saving` flag already disables should also be disabled when read-only.
  const locked = saving || readOnly;

  // Always load the full registry
  useEffect(() => {
    void appsService
      .getAvailablePermissions()
      .then(setAvailable)
      .catch(() => setAvailable([]));
  }, []);

  const loadGranted = useCallback(() => {
    const fetcher =
      isInstallMode && installedAppId
        ? appsService.getInstalledPermissions(installedAppId)
        : appsService.getGrantedPermissions(appId);
    void fetcher
      .then(({ permissions, statuses }) => {
        // Checked = APPROVED or UNAPPROVED (not PENDINGDELETE)
        const checkedScopes = new Set(
          statuses
            .filter(s => s.status === 'APPROVED' || s.status === 'UNAPPROVED')
            .map(s => s.scope),
        );
        // Fall back to permissions array for pre-install (no statuses)
        if (statuses.length === 0 && permissions.length > 0) {
          permissions.forEach(p => checkedScopes.add(p));
        }
        setSelected(checkedScopes);
        const map: Record<string, string> = {};
        statuses.forEach(s => {
          map[s.scope] = s.status;
        });
        setStatusMap(map);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [appId, isInstallMode, installedAppId]);

  // Pre-fill selection from already-granted permissions
  useEffect(() => {
    loadGranted();
  }, [loadGranted]);

  const getStatusBadge = (scope: string): ReactElement | null => {
    const status = statusMap[scope];
    if (!status) return null;
    if (status === 'UNAPPROVED') {
      return (
        <span className='text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 whitespace-nowrap'>
          Update to activate
        </span>
      );
    }
    if (status === 'PENDINGDELETE') {
      return (
        <span className='text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 whitespace-nowrap'>
          Removes on update
        </span>
      );
    }
    if (status === 'APPROVED') {
      return (
        <span className='text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 whitespace-nowrap'>
          Active
        </span>
      );
    }
    return null;
  };

  const handleToggle = (scope: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(scope);
      else next.delete(scope);
      return next;
    });
  };

  // Select-all reflects every available permission scope; the button toggles between
  // granting them all and clearing the selection.
  const allScopes = useMemo(
    () => available.map(perm => `${perm.name}:${(perm.type ?? '').toLowerCase()}`),
    [available],
  );
  const allSelected = allScopes.length > 0 && allScopes.every(scope => selected.has(scope));
  const handleToggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(allScopes));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isInstallMode && installedAppId) {
        await appsService.setInstalledPermissions(installedAppId, Array.from(selected));
      } else {
        await appsService.setPermissions(appId, Array.from(selected));
      }
      toast.success(`Permissions saved (${selected.size} granted)`);
      // Refresh statuses after save so badges update
      loadGranted();
    } catch (e) {
      toast.error('Failed to save permissions', {
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  };

  // Install-mode permission edits land as UNAPPROVED (or PENDINGDELETE) and only take effect after
  // activation. This activates the admin's pending install edits in place (UNAPPROVED → APPROVED,
  // drop PENDINGDELETE) WITHOUT resetting the install to the app template — unlike updateApp, which
  // re-syncs from the template and would discard the admin's edits.
  const [activating, setActivating] = useState(false);
  const hasPendingChanges = Object.values(statusMap).some(
    s => s === 'UNAPPROVED' || s === 'PENDINGDELETE',
  );
  const handleActivate = async () => {
    if (!installedAppId) return;
    setActivating(true);
    try {
      await appsService.activateInstalledPermissions(installedAppId);
      toast.success('Permission changes applied');
      loadGranted();
    } catch (e) {
      toast.error('Failed to apply permission changes', {
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between'>
        <span className='block text-sm font-medium text-foreground'>Permissions</span>
        <div className='flex items-center gap-2'>
          {!isInstalled && (
            <span className='text-xs text-amber-600 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded'>
              Install app to apply
            </span>
          )}
          {isInstalled && (
            <span className='text-xs text-muted-foreground'>
              {selected.size} / {available.length} granted
            </span>
          )}
          <Button
            type='button'
            size='sm'
            variant='ghost'
            className='h-7 text-xs'
            onClick={handleToggleSelectAll}
            disabled={locked || !loaded || available.length === 0}
            data-track-category='Apps'
            data-track-name='ToggleSelectAllPermissions'
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </Button>
          <Button
            type='button'
            size='sm'
            variant='outline'
            className='h-7 text-xs'
            onClick={() => void handleSave()}
            data-track-category='Apps'
            data-track-name='SAVE_APP'
            disabled={locked || !loaded}
          >
            {saving ? 'Saving…' : 'Save Permissions'}
          </Button>
          {isInstallMode && hasPendingChanges && (
            <Button
              type='button'
              size='sm'
              variant='default'
              className='h-7 text-xs'
              onClick={() => void handleActivate()}
              data-track-category='Apps'
              data-track-name='ACTIVATE_APP_INSTALL'
              disabled={activating || locked}
              title='Re-sync this install to activate pending permission changes'
            >
              {activating ? 'Applying…' : 'Apply & activate'}
            </Button>
          )}
        </div>
      </div>
      <p className='text-[11px] leading-snug text-muted-foreground bg-muted/40 border border-border rounded-md px-2.5 py-2'>
        {isInstallMode
          ? 'Permission changes only affect this app in your workspace. Use “Apply & activate” after saving to re-install with the updated permissions.'
          : 'These permission changes need workspace admin approval before they take effect in the workspace.'}
      </p>
      {!loaded || available.length === 0 ? (
        <p className='text-xs text-muted-foreground py-2'>Loading permissions…</p>
      ) : (
        <div className='border border-border rounded-md divide-y divide-border'>
          {available.map(perm => {
            const scope = `${perm.name}:${(perm.type ?? '').toLowerCase()}`;
            return (
              <div
                key={scope}
                role='button'
                tabIndex={locked ? -1 : 0}
                aria-pressed={selected.has(scope)}
                className={`flex items-start gap-2.5 group px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  locked ? 'cursor-not-allowed' : 'cursor-pointer'
                }`}
                onClick={() => {
                  if (!locked) handleToggle(scope, !selected.has(scope));
                }}
                onKeyDown={e => {
                  if (locked) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleToggle(scope, !selected.has(scope));
                  }
                }}
                data-track-category='Apps'
                data-track-name='TogglePermission'
              >
                {/* Purely visual — the row (role=button) owns all interaction, so
                    pointer-events-none avoids a double toggle from the inner input. */}
                <span className='mt-0.5 pointer-events-none'>
                  <Checkbox
                    checked={selected.has(scope)}
                    disabled={locked}
                    onChange={checked => handleToggle(scope, checked)}
                    label=''
                  />
                </span>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2 flex-wrap'>
                    <span className='text-xs font-mono text-foreground group-hover:text-primary transition-colors'>
                      {scope}
                    </span>
                    {getStatusBadge(scope)}
                  </div>
                  {perm.description && (
                    <p className='text-[11px] text-muted-foreground leading-tight mt-0.5'>
                      {perm.description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Main edit form ───────────────────────────────────────────────────────────

interface EditAppFormData {
  description: string;
  webhookUrl: string;
}

export interface EditAppFormProps {
  appId: string;
  appName: string;
  appDescription: string | null;
  // App-level (template) webhook URL — editable by the creator regardless of install state.
  appWebhookUrl?: string | null;
  appInstallations?: readonly InstalledApps[] | undefined;
  // 'template' = Org/Marketplace edit (creator; edits the app). 'install' = Installed edit
  // (admin; edits this workspace's install — webhook + permissions, commands read-only).
  editMode?: 'template' | 'install';
  installedAppId?: string | null;
  // false = the app's creator viewing their own install: every section still renders, but each
  // control is locked -- Incoming Webhooks is the only editable one. Admins/template edits pass true.
  canEditInstallSettings?: boolean;
  onSave: (data: { description: string; webhookUrl: string }) => Promise<void>;
  onUploadPicture?: ((appId: string, file: File) => Promise<void>) | undefined;
  isLoading?: boolean | undefined;
  onCancel?: (() => void) | undefined;
}

const WEBHOOK_NAME_MAX_LENGTH = 84;
const WEBHOOK_TYPE_OPTIONS = [
  { value: 'SLACK', label: 'Slack' },
  { value: 'SENTINELONE', label: 'SentinelOne' },
  { value: 'AMAZON_SNS', label: 'Amazon SNS' },
  { value: 'PINGDOM', label: 'Pingdom' },
  { value: 'GCP', label: 'GCP Monitoring' },
] as const;
type IncomingWebhookType = (typeof WEBHOOK_TYPE_OPTIONS)[number]['value'];
const WEBHOOK_TYPE_LABELS: Record<IncomingWebhookType, string> = Object.fromEntries(
  WEBHOOK_TYPE_OPTIONS.map(option => [option.value, option.label]),
) as Record<IncomingWebhookType, string>;
const WEBHOOK_ACTION_OPTIONS = [
  { value: AppIncomingWebhookAction.MESSAGE, label: 'Message' },
  { value: AppIncomingWebhookAction.TICKET, label: 'Ticket' },
] as const;
type IncomingWebhookAction = (typeof WEBHOOK_ACTION_OPTIONS)[number]['value'];

function WebhookNameInput({
  value,
  onChange,
  className,
  focusOnMount,
  onKeyDown,
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  focusOnMount?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  id?: string;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus();
  }, [focusOnMount]);
  return (
    <div className='relative'>
      <Input
        ref={inputRef}
        id={id}
        type='text'
        value={value}
        onChange={e => onChange(e.target.value.slice(0, WEBHOOK_NAME_MAX_LENGTH))}
        maxLength={WEBHOOK_NAME_MAX_LENGTH}
        className={`${className ?? ''} pr-12`}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
      <span className='absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none'>
        {value.length}/{WEBHOOK_NAME_MAX_LENGTH}
      </span>
    </div>
  );
}

// ─── Sectioned navigation ─────────────────────────────────────────────────────

type EditAppSection = 'basic' | 'commands' | 'shortcuts' | 'permissions' | 'resources' | 'incoming';

interface EditAppNavItem {
  id: EditAppSection;
  label: string;
  icon: ReactElement;
}

const SectionHeading = ({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): ReactElement => (
  <div>
    <p className='text-base font-semibold text-foreground'>{title}</p>
    {subtitle && <p className='text-sm text-muted-foreground mt-0.5'>{subtitle}</p>}
  </div>
);

export const EditAppForm = ({
  appId,
  appName,
  appDescription,
  appWebhookUrl,
  appInstallations,
  editMode = 'template',
  installedAppId = null,
  canEditInstallSettings = true,
  onSave,
  onUploadPicture,
  isLoading = false,
  onCancel,
}: EditAppFormProps): ReactElement => {
  // Install mode = editing this workspace's install (admin). Template mode = editing the app
  // (creator). In install mode commands and name/description are read-only (template-owned).
  const isInstallMode = editMode === 'install';
  // The app's creator on the Installed screen: everything is locked except Incoming Webhooks, so
  // open on that section rather than dropping them onto a Basic info form they can't submit.
  const [activeSection, setActiveSection] = useState<EditAppSection>(
    canEditInstallSettings ? 'basic' : 'incoming',
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [botChannels, setBotChannels] = useState<BotChannel[]>([]);
  const [webhooks, setWebhooks] = useState<IncomingWebhook[]>([]);
  const [webhookTotal, setWebhookTotal] = useState(0);
  const [webhookOffset, setWebhookOffset] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [webhookName, setWebhookName] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [selectedWebhookType, setSelectedWebhookType] = useState<IncomingWebhookType>('SLACK');
  const [selectedWebhookAction, setSelectedWebhookAction] = useState<IncomingWebhookAction>(
    AppIncomingWebhookAction.MESSAGE,
  );
  const [projectBoards, setProjectBoards] = useState<ProjectBoard[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);
  const WEBHOOK_PAGE_SIZE = 3;

  // Incoming webhooks are install-scoped; in install mode this is the caller's install (prop).
  // In template mode it falls back to the first install only as a best-effort (section hidden).
  const incomingInstalledAppId = installedAppId ?? appInstallations?.[0]?.id ?? null;

  useEffect(() => {
    if (!appId) return;
    void appsService
      .getBotChannels(appId)
      .then(setBotChannels)
      .catch(() => setBotChannels([]));
  }, [appId]);

  const fetchWebhooks = useCallback(
    (offset: number): void => {
      if (!incomingInstalledAppId) return;
      void appsService
        .getIncomingWebhooks(incomingInstalledAppId, { limit: WEBHOOK_PAGE_SIZE, offset })
        .then(data => {
          setWebhooks(data.webhooks);
          setWebhookTotal(data.total);
          setWebhookOffset(offset);
        })
        .catch(() => {
          setWebhooks([]);
          setWebhookTotal(0);
        });
    },
    [incomingInstalledAppId],
  );

  useEffect(() => {
    fetchWebhooks(0);
  }, [fetchWebhooks]);

  useEffect(() => {
    if (
      selectedWebhookType !== 'SENTINELONE' ||
      selectedWebhookAction !== AppIncomingWebhookAction.TICKET ||
      !selectedChannelId
    ) {
      setProjectBoards([]);
      setSelectedBoardId('');
      return;
    }

    const selectedChannel = botChannels.find(channel => channel.id === selectedChannelId);
    if (!selectedChannel?.projectId) {
      setProjectBoards([]);
      setSelectedBoardId('');
      return;
    }

    void appsService
      .getProjectBoards(selectedChannel.projectId)
      .then(boards => {
        setProjectBoards(boards);
        setSelectedBoardId(currentSelectedBoardId =>
          boards.some(board => board.id === currentSelectedBoardId) ? currentSelectedBoardId : '',
        );
      })
      .catch(() => {
        setProjectBoards([]);
        setSelectedBoardId('');
      });
  }, [botChannels, selectedChannelId, selectedWebhookType, selectedWebhookAction]);

  const getFullWebhookUrl = (relativePath: string): string => {
    if (!relativePath) return '';
    const incomingWebhookPath = '/api/apps';
    const suffix = relativePath.startsWith(incomingWebhookPath)
      ? relativePath.slice(incomingWebhookPath.length)
      : relativePath;
    return `${APPS_PUBLIC_BASE_URL}${suffix}`;
  };

  const handleCreateWebhook = async (): Promise<void> => {
    if (!incomingInstalledAppId || !selectedChannelId || !webhookName.trim()) return;

    setIsCreating(true);
    try {
      await appsService.createIncomingWebhook({
        installedAppId: incomingInstalledAppId,
        channelId: selectedChannelId,
        ...(selectedWebhookAction === AppIncomingWebhookAction.TICKET && selectedBoardId
          ? { boardId: selectedBoardId }
          : {}),
        name: webhookName.trim(),
        type: selectedWebhookType,
        action:
          selectedWebhookType === 'SENTINELONE'
            ? selectedWebhookAction
            : AppIncomingWebhookAction.MESSAGE,
      });
      setShowCreateForm(false);
      setWebhookName('');
      setSelectedChannelId('');
      setSelectedWebhookType('SLACK');
      setSelectedWebhookAction(AppIncomingWebhookAction.MESSAGE);
      setProjectBoards([]);
      setSelectedBoardId('');
      toast.success('Incoming webhook created');
      fetchWebhooks(0);
    } catch (error) {
      toast.error('Failed to create webhook', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeWebhook = async (): Promise<void> => {
    if (!revokeTargetId) return;
    const targetId = revokeTargetId;
    setRevokeTargetId(null);
    try {
      await appsService.revokeIncomingWebhook(targetId);
      toast.success('Webhook revoked');
      fetchWebhooks(webhookOffset);
    } catch (error) {
      toast.error('Failed to revoke webhook', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleRenameWebhook = async (webhookId: string): Promise<void> => {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    try {
      await appsService.updateIncomingWebhook(webhookId, { name: trimmed });
      setEditingWebhookId(null);
      setEditingName('');
      toast.success('Webhook renamed');
      fetchWebhooks(webhookOffset);
    } catch (error) {
      toast.error('Failed to rename webhook', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleCopyWebhookUrl = (webhookUrl: string): void => {
    const fullUrl = getFullWebhookUrl(webhookUrl);
    if (!fullUrl) return;
    void copyTextToClipboard(fullUrl);
    toast.success('Webhook URL copied to clipboard');
  };

  // ── Commands state ──
  const [commands, setCommands] = useState<AppCommand[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [showCommandForm, setShowCommandForm] = useState(false);
  const [editingCommand, setEditingCommand] = useState<AppCommand | null>(null);

  // ── Shortcuts state ──
  const [shortcuts, setShortcuts] = useState<AppShortcut[]>([]);
  const [shortcutsLoading, setShortcutsLoading] = useState(false);
  const [showShortcutForm, setShowShortcutForm] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<AppShortcut | null>(null);

  useEffect(() => {
    setCommandsLoading(true);
    // Install mode: read-only snapshot from installed_app_commands. Template mode: app_commands.
    const fetcher =
      isInstallMode && installedAppId
        ? appsService.getInstalledCommands(installedAppId, CommandType.COMMAND)
        : appsService.getCommands(appId);
    fetcher
      .then(setCommands)
      .catch(() => toast.error('Failed to load commands'))
      .finally(() => setCommandsLoading(false));
  }, [appId, isInstallMode, installedAppId]);

  useEffect(() => {
    setShortcutsLoading(true);
    const fetcher =
      isInstallMode && installedAppId
        ? appsService.getInstalledCommands(installedAppId, CommandType.SHORTCUT)
        : appsService.getShortcuts(appId);
    fetcher
      .then(setShortcuts)
      .catch(() => toast.error('Failed to load shortcuts'))
      .finally(() => setShortcutsLoading(false));
  }, [appId, isInstallMode, installedAppId]);

  const handleCommandSaved = (saved: AppCommand) => {
    setCommands(prev => {
      const idx = prev.findIndex(c => c.commandName === saved.commandName);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved].sort((a, b) => a.commandName.localeCompare(b.commandName));
    });
    setShowCommandForm(false);
    setEditingCommand(null);
    toast.success(`Command /${saved.commandName} saved`);
  };

  const handleDeleteCommand = async (commandName: string) => {
    try {
      await appsService.deleteCommand(appId, commandName);
      setCommands(prev => prev.filter(c => c.commandName !== commandName));
      toast.success(`Command /${commandName} deleted`);
    } catch {
      toast.error('Failed to delete command');
    }
  };

  const handleEditCommand = (command: AppCommand) => {
    setEditingCommand(command);
    setShowCommandForm(true);
  };

  const handleShortcutSaved = (saved: AppShortcut) => {
    setShortcuts(prev => {
      const idx = prev.findIndex(s => s.commandName === saved.commandName);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setShowShortcutForm(false);
    setEditingShortcut(null);
    toast.success(`Shortcut "${saved.commandName}" saved`);
  };

  const handleDeleteShortcut = async (commandName: string) => {
    try {
      await appsService.deleteShortcut(appId, commandName);
      setShortcuts(prev => prev.filter(s => s.commandName !== commandName));
      toast.success('Shortcut deleted');
    } catch {
      toast.error('Failed to delete shortcut');
    }
  };

  const handleEditShortcut = (shortcut: AppShortcut) => {
    setEditingShortcut(shortcut);
    setShowShortcutForm(true);
  };

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditAppFormData>({
    defaultValues: {
      description: appDescription || '',
      webhookUrl: '',
    },
    mode: 'onChange',
  });

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!onUploadPicture) {
      toast.error('Upload not available');
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Only JPG, PNG, and WebP are allowed.');
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('File too large. Maximum size is 5MB.');
      return;
    }

    try {
      await onUploadPicture(appId, file);
      toast.success('Profile picture uploaded successfully');
    } catch (error) {
      toast.error('Failed to upload profile picture', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUploadClick = (): void => {
    fileInputRef.current?.click();
  };

  // Install mode edits THIS install's webhook (installed_apps.webhookUrl); template mode edits the
  // app-level (template) URL set by the creator and copied to installs.
  const webhookUrlValue = useMemo(
    () => (isInstallMode ? (appInstallations?.[0]?.webhookUrl ?? '') : (appWebhookUrl ?? '')),
    [isInstallMode, appInstallations, appWebhookUrl],
  );

  const isAppInstalled = useMemo(() => {
    const installations = appInstallations || [];
    return installations.length > 0;
  }, [appInstallations]);

  useEffect(() => {
    reset({
      description: appDescription || '',
      webhookUrl: webhookUrlValue,
    });
  }, [appDescription, webhookUrlValue, reset]);

  const onSubmit = async (formData: EditAppFormData): Promise<void> => {
    // Authoritative gate: the Save button is disabled, but a stray Enter in another section's
    // input can still trigger implicit form submission, so re-check rather than trust the button.
    if (!canEditInstallSettings) return;
    await onSave({
      description: formData.description.trim(),
      webhookUrl: formData.webhookUrl.trim(),
    });
  };

  const hasPrev = webhookOffset > 0;
  const hasNext = webhookOffset + WEBHOOK_PAGE_SIZE < webhookTotal;

  // Incoming webhooks are install-scoped, so the section only appears when editing an install.
  const showIncomingSection = isInstallMode && !!incomingInstalledAppId;
  const navItems: EditAppNavItem[] = [
    { id: 'basic', label: 'Basic info', icon: <Info className='size-4' /> },
    { id: 'commands', label: 'Commands', icon: <Command className='size-4' /> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <Zap className='size-4' /> },
    { id: 'permissions', label: 'Permissions', icon: <Shield className='size-4' /> },
    // Attachments are per-install, like incoming webhooks — meaningless on the template.
    ...(isInstallMode
      ? [
          {
            id: 'resources' as const,
            label: 'Resource access',
            icon: <Boxes className='size-4' />,
          },
        ]
      : []),
    ...(showIncomingSection
      ? [
          {
            id: 'incoming' as const,
            label: 'Incoming Webhooks',
            icon: <Link2 className='size-4' />,
          },
        ]
      : []),
  ];

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        void handleSubmit(onSubmit)(e);
      }}
      className='flex flex-col h-[85vh] max-h-[820px]'
    >
      {/* Header */}
      <div className='flex items-center justify-between px-4 py-3 border-b border-border shrink-0'>
        <p className='text-base font-semibold text-foreground truncate'>Edit {appName}</p>
        <button
          type='button'
          onClick={onCancel}
          className='p-1.5 rounded-md hover:bg-muted transition-colors'
          aria-label='Close'
          data-track-category='Apps'
          data-track-name='CloseEditApp'
        >
          <X className='size-4 text-muted-foreground' />
        </button>
      </div>

      <div className='flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden'>
        {/* Left navigation */}
        <div
          role='tablist'
          aria-label='App settings sections'
          className='flex md:flex-col md:w-52 shrink-0 border-b md:border-b-0 md:border-r border-border p-2 gap-0.5 overflow-x-auto md:overflow-visible'
        >
          {navItems.map(item => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type='button'
                role='tab'
                aria-selected={isActive}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors text-left whitespace-nowrap shrink-0 md:w-full',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                data-track-category='Apps'
                data-track-name={`EditAppSection_${item.id}`}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Section content */}
        <div role='tabpanel' className='flex-1 overflow-y-auto p-6 space-y-6'>
          {!canEditInstallSettings && (
            <div className='bg-amber-500/10 border border-amber-500/30 text-amber-600 px-3 py-2 rounded-md text-sm dark:bg-amber-500/10 dark:text-amber-400'>
              You&apos;re viewing this app as its creator. Only a workspace apps admin can change
              these settings — you can create and manage Incoming Webhooks.
            </div>
          )}

          {activeSection === 'basic' && (
            <>
              <SectionHeading
                title='Basic info'
                subtitle='Set the description, webhook URL, and profile picture for this app.'
              />
              <div className='space-y-2'>
                <label htmlFor='appName' className='block text-md font-medium text-foreground'>
                  App Name
                </label>
                <Input
                  id='appName'
                  type='text'
                  value={appName}
                  disabled={true}
                  className='bg-muted text-foreground'
                />
              </div>

              <div className='space-y-2'>
                <label htmlFor='description' className='block text-sm font-medium text-foreground'>
                  Description
                </label>
                <Controller
                  name='description'
                  control={control}
                  render={({ field }) => (
                    <Textarea
                      id='description'
                      placeholder='Enter app description (optional)'
                      rows={3}
                      disabled={isLoading || isInstallMode}
                      className='text-foreground'
                      {...field}
                    />
                  )}
                />
                {isInstallMode && (
                  <p className='text-xs text-muted-foreground'>
                    Description is set on the app template. Edit it from the Org Apps screen.
                  </p>
                )}
                {errors.description && (
                  <p className='text-xs text-destructive'>{errors.description.message}</p>
                )}
              </div>

              <div className='space-y-2'>
                <label htmlFor='webhookUrl' className='block text-sm font-medium text-foreground'>
                  Webhook URL
                </label>
                <Controller
                  name='webhookUrl'
                  control={control}
                  rules={{
                    validate: value => {
                      if (!value || value.trim() === '') return true;
                      try {
                        new URL(value);
                        return true;
                      } catch {
                        return 'Please enter a valid URL';
                      }
                    },
                  }}
                  render={({ field }) => (
                    <Input
                      id='webhookUrl'
                      type='url'
                      placeholder='https://your-app.com/webhook'
                      disabled={isLoading || !canEditInstallSettings}
                      className='text-foreground'
                      {...field}
                    />
                  )}
                />
                <p className='text-xs text-muted-foreground'>
                  {isInstallMode
                    ? "This install's backend endpoint for your workspace. Overrides the template URL."
                    : "The app's backend endpoint. Editable any time (even before install); installs pick it up on Update."}
                </p>
                {errors.webhookUrl && (
                  <p className='text-xs text-destructive'>{errors.webhookUrl.message}</p>
                )}
              </div>

              {isInstallMode && (
                <div className='space-y-2'>
                  <label
                    htmlFor='profilePicture'
                    className='block text-sm font-medium text-foreground'
                  >
                    Profile Picture
                  </label>
                  <div className='flex gap-2'>
                    <input
                      type='file'
                      ref={fileInputRef}
                      onChange={e => void handleFileSelect(e)}
                      accept='image/jpeg,image/png,image/webp'
                      className='hidden'
                    />
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={handleUploadClick}
                      data-track-category='Apps'
                      data-track-name='UPLOAD_BOT_AVATAR'
                      disabled={isLoading || !canEditInstallSettings}
                      className='gap-1'
                      title='Upload bot profile picture'
                    >
                      <Upload size={14} />
                      Upload Picture
                    </Button>
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    Supported formats: JPG, PNG, WebP. Max size: 5MB.
                  </p>
                </div>
              )}
            </>
          )}

          {activeSection === 'incoming' && showIncomingSection && (
            <div className='space-y-2'>
              <div>
                <SectionHeading
                  title='Incoming Webhooks'
                  subtitle='Generate webhook URLs for external services to post messages as this bot. Supports Slack, SentinelOne, Amazon SNS, Pingdom and GCP Monitoring webhook URL formats.'
                />
                {botChannels.length > 0 && !showCreateForm && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setShowCreateForm(true)}
                    data-track-category='INCOMING_WEBHOOKS'
                    data-track-name='OPEN_CREATE_WEBHOOK_FORM'
                    className='gap-1 w-full mt-2'
                  >
                    <Plus size={14} />
                    Create Incoming Webhook
                  </Button>
                )}
              </div>

              {showCreateForm && botChannels.length > 0 && (
                <div className='border border-border rounded-md p-3 space-y-3'>
                  <div className='space-y-2'>
                    <label
                      htmlFor='webhook-type-select'
                      className='block text-xs font-medium text-foreground'
                    >
                      Webhook Type
                    </label>
                    <Select
                      value={selectedWebhookType}
                      onValueChange={value => setSelectedWebhookType(value as IncomingWebhookType)}
                    >
                      <SelectTrigger id='webhook-type-select' className='w-full'>
                        <SelectValue placeholder='Select a webhook type' />
                      </SelectTrigger>
                      <SelectContent>
                        {WEBHOOK_TYPE_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedWebhookType === 'SENTINELONE' && (
                    <div className='space-y-2'>
                      <label
                        htmlFor='webhook-action-select'
                        className='block text-xs font-medium text-foreground'
                      >
                        Action
                      </label>
                      <Select
                        value={selectedWebhookAction}
                        onValueChange={value =>
                          setSelectedWebhookAction(value as IncomingWebhookAction)
                        }
                      >
                        <SelectTrigger id='webhook-action-select' className='w-full'>
                          <SelectValue placeholder='Select a webhook action' />
                        </SelectTrigger>
                        <SelectContent>
                          {WEBHOOK_ACTION_OPTIONS.map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className='space-y-2'>
                    <label
                      htmlFor='webhook-channel-select'
                      className='block text-xs font-medium text-foreground'
                    >
                      Channel
                    </label>
                    <Select
                      value={selectedChannelId}
                      onValueChange={channelId => {
                        setSelectedChannelId(channelId);
                        const channel = botChannels.find(c => c.id === channelId);
                        if (channel)
                          setWebhookName(`${channel.name}-ich`.slice(0, WEBHOOK_NAME_MAX_LENGTH));
                      }}
                    >
                      <SelectTrigger id='webhook-channel-select' className='w-full'>
                        <SelectValue placeholder='Select a channel' />
                      </SelectTrigger>
                      <SelectContent>
                        {botChannels.map(channel => (
                          <SelectItem key={channel.id} value={channel.id}>
                            <span className='inline-flex items-center gap-1'>
                              <span className='w-3.5 flex-shrink-0 flex items-center justify-center'>
                                {channel.visibility === 'PRIVATE' ? <Lock size={12} /> : '#'}
                              </span>
                              {channel.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedWebhookType === 'SENTINELONE' &&
                    selectedWebhookAction === AppIncomingWebhookAction.TICKET && (
                      <div className='space-y-2'>
                        <label
                          htmlFor='webhook-board-select'
                          className='block text-xs font-medium text-foreground'
                        >
                          Board
                        </label>
                        <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
                          <SelectTrigger
                            id='webhook-board-select'
                            className='w-full'
                            disabled={!selectedChannelId || projectBoards.length === 0}
                          >
                            <SelectValue
                              placeholder={
                                !selectedChannelId
                                  ? 'Select a channel first'
                                  : projectBoards.length === 0
                                    ? 'No boards available'
                                    : 'Select a board'
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {projectBoards.map(board => (
                              <SelectItem key={board.id} value={board.id}>
                                {board.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!selectedChannelId && (
                          <p className='text-xs text-muted-foreground'>
                            Choose a channel first so we can load boards from that project.
                          </p>
                        )}
                        {selectedChannelId && projectBoards.length === 0 && (
                          <p className='text-xs text-muted-foreground'>
                            No boards found for the selected channel&apos;s project.
                          </p>
                        )}
                      </div>
                    )}
                  <div className='space-y-1'>
                    <label
                      htmlFor='webhook-name-input'
                      className='block text-xs font-medium text-foreground'
                    >
                      Webhook Name
                    </label>
                    <WebhookNameInput
                      id='webhook-name-input'
                      value={webhookName}
                      onChange={setWebhookName}
                      placeholder='e.g., GitHub CI, Monitoring'
                      className='text-sm'
                    />
                  </div>
                  <div className='flex gap-2'>
                    <Button
                      type='button'
                      size='sm'
                      onClick={() => void handleCreateWebhook()}
                      data-track-category='INCOMING_WEBHOOKS'
                      data-track-name='CREATE_WEBHOOK'
                      disabled={
                        isCreating ||
                        !webhookName.trim() ||
                        !selectedChannelId ||
                        (selectedWebhookType === 'SENTINELONE' &&
                          selectedWebhookAction === AppIncomingWebhookAction.TICKET &&
                          !selectedBoardId)
                      }
                    >
                      {isCreating ? 'Creating...' : 'Create'}
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={() => {
                        setShowCreateForm(false);
                        setWebhookName('');
                        setSelectedChannelId('');
                        setSelectedWebhookType('SLACK');
                        setSelectedWebhookAction(AppIncomingWebhookAction.MESSAGE);
                        setProjectBoards([]);
                        setSelectedBoardId('');
                      }}
                      data-track-category='INCOMING_WEBHOOKS'
                      data-track-name='CANCEL_CREATE_WEBHOOK'
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {botChannels.length === 0 && (
                <div className='bg-amber-500/10 border border-amber-500/30 text-amber-600 px-3 py-2 rounded-md text-sm dark:bg-amber-500/10 dark:text-amber-400'>
                  Add the bot to a channel first to create incoming webhooks.
                </div>
              )}

              {webhooks.map(webhook => (
                <div key={webhook.id} className='border border-border rounded-md p-3 space-y-2'>
                  {editingWebhookId === webhook.id ? (
                    <div className='flex items-center gap-1.5'>
                      <div className='flex-1 min-w-0'>
                        <WebhookNameInput
                          value={editingName}
                          onChange={setEditingName}
                          onKeyDown={e => {
                            if (e.key === 'Enter') void handleRenameWebhook(webhook.id);
                            if (e.key === 'Escape') {
                              setEditingWebhookId(null);
                              setEditingName('');
                            }
                          }}
                          className='text-sm h-7'
                          focusOnMount
                        />
                      </div>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => void handleRenameWebhook(webhook.id)}
                        disabled={!editingName.trim()}
                        className='h-7 w-7 p-0 flex-shrink-0 text-muted-foreground hover:text-foreground'
                        data-track-category='INCOMING_WEBHOOKS'
                        data-track-name='Confirm_Rename_Webhook'
                      >
                        <Check size={14} />
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => {
                          setEditingWebhookId(null);
                          setEditingName('');
                        }}
                        className='h-7 w-7 p-0 flex-shrink-0 text-muted-foreground hover:text-foreground'
                        data-track-category='INCOMING_WEBHOOKS'
                        data-track-name='Cancel_Rename_Webhook'
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  ) : (
                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-1.5 min-w-0'>
                        <span className='text-sm font-medium text-foreground truncate'>
                          {webhook.name}
                        </span>
                        <span className='text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide'>
                          {WEBHOOK_TYPE_LABELS[webhook.type] ?? webhook.type}
                        </span>
                        <span className='text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide'>
                          {webhook.action === AppIncomingWebhookAction.TICKET
                            ? 'Ticket'
                            : 'Message'}
                        </span>
                        <span className='text-xs text-muted-foreground inline-flex items-center gap-0.5'>
                          <span className='w-3 flex-shrink-0 flex items-center justify-center'>
                            {webhook.channelVisibility === 'PRIVATE' ? <Lock size={10} /> : '#'}
                          </span>
                          {webhook.channelName}
                        </span>
                        {webhook.boardName && (
                          <span className='text-xs text-muted-foreground'>
                            Board: {webhook.boardName}
                          </span>
                        )}
                      </div>
                      <div className='flex items-center gap-0.5'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => {
                            setEditingWebhookId(webhook.id);
                            setEditingName(webhook.name);
                          }}
                          className='h-7 w-7 p-0 text-muted-foreground hover:text-foreground'
                          title='Rename'
                          data-track-category='INCOMING_WEBHOOKS'
                          data-track-name='Edit_Webhook_Name'
                        >
                          <Pencil size={11} />
                        </Button>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => setRevokeTargetId(webhook.id)}
                          className='h-7 w-7 p-0 text-muted-foreground hover:text-destructive'
                          title='Revoke webhook'
                          data-track-category='INCOMING_WEBHOOKS'
                          data-track-name='Revoke_Webhook'
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className='flex items-center gap-2'>
                    <Input
                      type='text'
                      value={getFullWebhookUrl(webhook.webhookUrl)}
                      readOnly
                      className='text-xs bg-muted font-mono'
                    />
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => handleCopyWebhookUrl(webhook.webhookUrl)}
                      data-track-category='INCOMING_WEBHOOKS'
                      data-track-name='COPY_WEBHOOK_URL'
                      className='shrink-0'
                    >
                      <Copy size={14} />
                    </Button>
                  </div>
                </div>
              ))}

              {(hasPrev || hasNext) && (
                <div className='flex items-center justify-between'>
                  <span className='text-xs text-muted-foreground'>
                    {webhookOffset + 1}–{Math.min(webhookOffset + WEBHOOK_PAGE_SIZE, webhookTotal)}{' '}
                    of {webhookTotal}
                  </span>
                  <div className='flex gap-1'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={!hasPrev}
                      onClick={() => fetchWebhooks(webhookOffset - WEBHOOK_PAGE_SIZE)}
                      data-track-category='INCOMING_WEBHOOKS'
                      data-track-name='WEBHOOKS_PREV_PAGE'
                      className='h-7 w-7 p-0'
                    >
                      <ChevronLeft size={14} />
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={!hasNext}
                      onClick={() => fetchWebhooks(webhookOffset + WEBHOOK_PAGE_SIZE)}
                      data-track-category='INCOMING_WEBHOOKS'
                      data-track-name='WEBHOOKS_NEXT_PAGE'
                      className='h-7 w-7 p-0'
                    >
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Commands */}
          {activeSection === 'commands' && (
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <label htmlFor='app-commands' className='block text-sm font-medium text-foreground'>
                  Commands
                </label>
                {!showCommandForm && !isInstallMode && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='gap-1 h-7 text-xs'
                    onClick={() => {
                      setEditingCommand(null);
                      setShowCommandForm(true);
                    }}
                    data-track-category='app-command'
                    data-track-name='OPEN_CREATE_COMMAND_FORM'
                  >
                    <Plus size={12} /> Add Command
                  </Button>
                )}
              </div>

              {showCommandForm && (
                <CommandFormInline
                  appId={appId}
                  initial={editingCommand}
                  onSaved={handleCommandSaved}
                  onCancel={() => {
                    setShowCommandForm(false);
                    setEditingCommand(null);
                  }}
                />
              )}

              {isInstallMode && (
                <p className='text-xs text-muted-foreground'>
                  Commands come from the app template. Click Update to sync the latest.
                </p>
              )}
              {commandsLoading ? (
                <p className='text-xs text-muted-foreground py-2'>Loading commands…</p>
              ) : commands.length === 0 && !showCommandForm ? (
                <p className='text-xs text-muted-foreground py-2'>
                  No commands yet. Add one to let users trigger actions with{' '}
                  <span className='font-mono'>/commandname</span>.
                </p>
              ) : (
                <div className='space-y-1.5'>
                  {commands.map(cmd => (
                    <CommandRow
                      key={cmd.commandName}
                      command={cmd}
                      onEdit={handleEditCommand}
                      onDelete={commandName => void handleDeleteCommand(commandName)}
                      readOnly={isInstallMode}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Shortcuts */}
          {activeSection === 'shortcuts' && (
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='block text-sm font-medium text-foreground'>Shortcuts</span>
                {!showShortcutForm && !isInstallMode && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='gap-1 h-7 text-xs'
                    onClick={() => {
                      setEditingShortcut(null);
                      setShowShortcutForm(true);
                    }}
                    data-track-category='app-shortcut'
                    data-track-name='OPEN_CREATE_SHORTCUT_FORM'
                  >
                    <Plus size={12} /> Add Shortcut
                  </Button>
                )}
              </div>

              {showShortcutForm && (
                <ShortcutFormInline
                  appId={appId}
                  initial={editingShortcut}
                  onSaved={handleShortcutSaved}
                  onCancel={() => {
                    setShowShortcutForm(false);
                    setEditingShortcut(null);
                  }}
                />
              )}

              {shortcutsLoading ? (
                <p className='text-xs text-muted-foreground py-2'>Loading shortcuts…</p>
              ) : shortcuts.length === 0 && !showShortcutForm ? (
                <p className='text-xs text-muted-foreground py-2'>
                  No shortcuts yet. Add a <span className='font-semibold'>Global</span> shortcut
                  (accessible from the ⚡ button in the composer) or a{' '}
                  <span className='font-semibold'>Message</span> shortcut (accessible from the
                  message action menu).
                </p>
              ) : (
                <div className='space-y-1.5'>
                  {shortcuts.map(s => (
                    <ShortcutRow
                      key={s.commandName}
                      shortcut={s}
                      onEdit={handleEditShortcut}
                      onDelete={callbackId => void handleDeleteShortcut(callbackId)}
                      readOnly={isInstallMode}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeSection === 'resources' && installedAppId && (
            <div className='flex flex-col gap-6'>
              {ATTACHABLE_RESOURCES.map(resource => (
                <AppResourceSection
                  key={resource.resourceType}
                  installedAppId={installedAppId}
                  resourceType={resource.resourceType}
                  noun={resource.noun}
                  requiredPermission={resource.requiredPermission}
                  loadOptions={resource.loadOptions}
                  readOnly={!canEditInstallSettings}
                />
              ))}
            </div>
          )}

          {/* Permissions */}
          {activeSection === 'permissions' && (
            <PermissionsSection
              appId={appId}
              isInstalled={isInstallMode || isAppInstalled}
              editMode={editMode}
              installedAppId={installedAppId}
              readOnly={!canEditInstallSettings}
            />
          )}
        </div>
      </div>

      <div className='flex gap-2 justify-end p-4 border-t border-border bg-background shrink-0'>
        <Button
          variant='outline'
          onClick={onCancel}
          data-track-category='Apps'
          data-track-name='CANCEL_APP_FORM'
          disabled={isLoading}
          type='button'
        >
          {activeSection === 'basic' ? 'Cancel' : 'Close'}
        </Button>
        {/* Save Changes only persists the Basic info fields (description + webhook URL); the other
            sections manage their own saves inline, so the button is scoped to Basic info. */}
        {activeSection === 'basic' && (
          <Button
            type='submit'
            disabled={isLoading || !canEditInstallSettings}
            data-track-category='Apps'
            data-track-name='EditApp'
          >
            {isLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        )}
      </div>

      <Dialog
        open={revokeTargetId !== null}
        onOpenChange={open => {
          if (!open) setRevokeTargetId(null);
        }}
      >
        <div className='p-6 space-y-4'>
          <div className='space-y-1'>
            <h2 className='text-base font-semibold text-foreground'>Revoke webhook?</h2>
            <p className='text-sm text-muted-foreground'>
              This webhook URL will stop working immediately and cannot be re-enabled. Create a new
              webhook to replace it.
            </p>
          </div>
          <div className='flex gap-2 justify-end'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setRevokeTargetId(null)}
              data-track-category='Apps'
              data-track-name='CANCEL_REVOKE_INSTALL'
            >
              Cancel
            </Button>
            <Button
              type='button'
              variant='destructive'
              size='sm'
              onClick={() => void handleRevokeWebhook()}
              data-track-category='INCOMING_WEBHOOKS'
              data-track-name='Confirm_Revoke_Webhook'
            >
              Revoke
            </Button>
          </div>
        </div>
      </Dialog>
    </form>
  );
};

export default EditAppForm;
