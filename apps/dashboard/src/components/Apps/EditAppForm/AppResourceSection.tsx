import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import { EntityMultiSelector } from '../../ui/EntitySelector/EntityMultiSelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { appsService, type AttachedResource } from '../../../services/Apps/appsService';
import { cn } from '../../../utils/classNames';

interface AppResourceSectionProps {
  installedAppId: string;
  /** Backend `attachableResources` kind — the URL segment. */
  resourceType: string;
  /** Plural, lowercase, for the prose: "workflows", "projects". */
  noun: string;
  /** Omitted when read-only, so the full inventory is never fetched. */
  loadOptions?: () => Promise<AttachedResource[]>;
  requiredPermission: string;
  readOnly?: boolean;
}

/**
 * Generic over `resourceType`, like the storage and routes behind it — a second kind is a
 * registry entry and another instance of this, not another screen.
 *
 * Read-only never fetches the inventory: someone with only XYNE-APPS READ should see what
 * an app is attached to without being handed a list of everything that exists.
 */
export const AppResourceSection = ({
  installedAppId,
  resourceType,
  noun,
  loadOptions,
  requiredPermission,
  readOnly = false,
}: AppResourceSectionProps): ReactElement => {
  const [attached, setAttached] = useState<AttachedResource[]>([]);
  /** What the server had at load — the delta is measured against this, not the options. */
  const [baseline, setBaseline] = useState<string[]>([]);
  const [options, setOptions] = useState<AttachedResource[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const current = await appsService.getInstalledResources(installedAppId, resourceType);
        const all = readOnly || !loadOptions ? [] : await loadOptions();
        if (cancelled) return;
        const currentIds = current.map(item => item.id);
        setAttached(current);
        setOptions(all);
        setSelected(currentIds);
        setBaseline(currentIds);
      } catch {
        if (!cancelled) toast.error(`Could not load attached ${noun}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    return (): void => {
      cancelled = true;
    };
  }, [installedAppId, resourceType, noun, readOnly, loadOptions]);

  const added = selected.filter(id => !baseline.includes(id));
  const removed = baseline.filter(id => !selected.includes(id));
  const dirty = added.length > 0 || removed.length > 0;

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      const items = await appsService.updateInstalledResources(installedAppId, resourceType, {
        added,
        removed,
      });
      const ids = items.map(item => item.id);
      setAttached(items);
      setSelected(ids);
      setBaseline(ids);
      toast.success(`Updated the ${noun} this app can use`);
    } catch {
      toast.error(`Could not update ${noun}`);
    } finally {
      setSaving(false);
    }
  }, [installedAppId, resourceType, noun, added, removed]);

  const selectorOptions: SelectorOption[] = options.map(item => ({
    value: item.id,
    label: item.name,
    icon: null,
  }));

  // Attached items outside the fetched options still resolve, so a chip never falls back
  // to a bare id just because the inventory was truncated.
  const nameById = new Map([...options, ...attached].map(item => [item.id, item.name]));
  const chips = (readOnly ? attached.map(item => item.id) : selected).map(id => ({
    id,
    name: nameById.get(id) ?? id,
  }));

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between gap-2 flex-wrap'>
        <h3 className='text-sm font-medium capitalize'>{noun}</h3>
        <div className='flex items-center gap-2'>
          <span className='text-xs text-muted-foreground'>
            {selected.length} attached
            {dirty ? ` · +${added.length} / −${removed.length}` : ''}
          </span>
          {!readOnly && (
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='h-7 text-xs'
              onClick={() => void handleSave()}
              disabled={saving || !loaded || !dirty}
              data-track-category='Apps'
              data-track-name='SaveAppResourceAccess'
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      <p className='text-[11px] leading-snug text-muted-foreground bg-muted/40 border border-border rounded-md px-2.5 py-2'>
        This app can only use the {noun} listed here, and changes take effect immediately — there is
        nothing to activate. It also needs the{' '}
        <code className='font-mono'>{requiredPermission}</code> permission, which an app update can
        reset.
      </p>

      {!loaded ? (
        <p className='text-xs text-muted-foreground'>Loading…</p>
      ) : (
        <div className={cn('grid gap-4 items-start', !readOnly && 'md:grid-cols-2')}>
          {!readOnly && (
            <EntityMultiSelector
              options={selectorOptions}
              selectedValues={selected}
              onMultiSelect={setSelected}
              placeholder={`Select ${noun}…`}
              searchPlaceholder={`Search ${noun}`}
              showSearch
              collapseSelectedAfter={0}
              collapsedLabel={noun}
            />
          )}

          <div className='flex flex-col gap-2 min-w-0'>
            <h4 className='text-xs font-medium text-muted-foreground'>
              {dirty ? 'Selected' : 'Attached'} ({chips.length})
            </h4>
            {chips.length === 0 ? (
              <p className='text-xs text-muted-foreground'>
                No {noun} attached. This app cannot use any {noun}.
              </p>
            ) : (
              <div className='flex flex-wrap gap-1.5'>
                {chips.map(chip => (
                  <span
                    key={chip.id}
                    className='text-xs bg-muted border border-border rounded px-2 py-0.5 max-w-full truncate'
                    title={chip.name}
                  >
                    {chip.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
