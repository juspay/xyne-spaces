/**
 * The Settings tab of a saved app — the chat pane and the full-page library
 * screen render the same one.
 *
 * Two different things live here and they are deliberately kept apart:
 *
 *  - **The app** — icon, owner, visibility, dates, version history. Properties
 *    of the saved row, the same for everyone who opens it.
 *  - **This build** — what the version currently on screen reads, whether it
 *    writes, which agents it runs, what it is made of. Read off that version's
 *    manifest, so it changes as you move through the version dropdown. It is
 *    labelled with the version number for exactly that reason: it describes a
 *    build, not the app forever.
 *
 * Everything except the icon is read-only. The rest is either the server's to
 * decide (owner, dates, publication) or the agent's (what the code does), and
 * offering a control the API would reject is worse than offering none.
 *
 * Takes the rows themselves rather than a host's state object, because the two
 * callers have nothing else in common: the pane holds an `AppCreationMode` keyed
 * to a conversation, the library screen holds a bare query. Everything shown is
 * derivable from the app row plus the version list, so that is the whole prop
 * surface.
 */

import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AppIcon } from '../../AppIcon/AppIcon';
import { IconPicker } from '../../AppIcon/IconPicker';
import UserAvatar, { AvatarShape, AvatarSize } from '../../UserAvatar/UserAvatar';
import { formatDate, formatRelativeTime } from '../../../utils/dateUtils';
import { formatFileSize } from '../../ui/utils/files';
import type { ReactArtifactDataRequirement } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import type {
  ArtifactAppDetail,
  ArtifactAppVersionSummary,
} from '../../../services/claw/artifactAppsService';

/** One label → value line. The value sits right so the labels form a column. */
const Fact = ({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string | undefined;
}): ReactElement => (
  <div className='flex items-start justify-between gap-6'>
    <span className='shrink-0 text-xs text-muted-foreground'>{label}</span>
    <span className='flex min-w-0 flex-col items-end gap-0.5 text-right text-xs text-foreground'>
      {children}
      {hint && <span className='text-[11px] text-muted-foreground'>{hint}</span>}
    </span>
  </div>
);

const Section = ({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode | undefined;
  children: ReactNode;
}): ReactElement => (
  <div className='flex flex-col gap-3 border-t border-border pt-4'>
    <div className='flex items-baseline justify-between gap-3'>
      <h3 className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
        {title}
      </h3>
      {aside}
    </div>
    {children}
  </div>
);

/**
 * Where one declared requirement gets its rows from, in the viewer's terms.
 *
 * Named queries and direct model reads are two different promises — one is a
 * curated query the server owns, the other is a filtered read of a model — so
 * they are not flattened into a single "reads data" line. `take` is included
 * because a row cap is the difference between "the open tickets" and "some
 * tickets".
 */
function sourceLabel(requirement: ReactArtifactDataRequirement, t: TFunction): string {
  const { source } = requirement;
  if (!source) return t('artifactAppSettings.sourceNotDeclared');
  if (source.kind === 'query') return t('artifactAppSettings.namedQuery', { query: source.query });
  const parts = [source.model, source.operation ?? 'findMany'];
  if (source.take) parts.push(t('artifactAppSettings.upToRows', { count: source.take }));
  return t('artifactAppSettings.directRead', { parts: parts.join(' · ') });
}

export interface ArtifactAppSettingsProps {
  /** The saved row. Null while it loads, which renders nothing. */
  app: ArtifactAppDetail | null;
  /** The build on screen — the one whose manifest the capability section
   *  describes. Callers must pass what they actually render, not the newest
   *  version, or Settings reports a build the preview is not showing. */
  viewing: ArtifactAppVersionSummary | null;
  /** Every version the caller may see: the full history for an owner, the
   *  pinned build alone for anyone else. */
  versions: ArtifactAppVersionSummary[];
  /** Owner-only write. Omitted where the caller cannot persist the change,
   *  which leaves the icon read-only rather than offering a dead control. */
  onIconChange?: ((icon: string | null) => void) | undefined;
}

export const ArtifactAppSettings = ({
  app,
  viewing,
  versions,
  onIconChange,
}: ArtifactAppSettingsProps): ReactElement | null => {
  const { t } = useTranslation('common');
  if (!app || !viewing) return null;

  const manifest = viewing.manifest;
  const isOwner = app.isOwner;
  const canEditIcon = isOwner && Boolean(onIconChange);
  const isPublished = app.visibility === 'WORKSPACE';
  const head = versions.find(v => v.id === app.headVersionId) ?? versions[0];
  // A non-owner is only ever served the pinned build, so this resolves for them
  // too — it is their one version.
  const publishedVersion = versions.find(v => v.id === app.publishedVersionId);
  const reads = manifest.dataRequirements ?? [];
  const packages = manifest.dependencies ?? [];

  return (
    <div className='mx-auto flex w-full max-w-xl flex-col gap-6 px-5 py-6'>
      <div className='flex flex-col gap-1'>
        <h2 className='text-sm font-medium text-foreground'>
          {t('artifactAppSettings.settingsTitle')}
        </h2>
        <p className='text-xs text-muted-foreground'>
          {canEditIcon
            ? t('artifactAppSettings.onlyYouCanChange')
            : t('artifactAppSettings.onlyOwnerCanChange')}
        </p>
      </div>

      <div className='flex items-start justify-between gap-6 border-t border-border pt-4'>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <span className='text-sm text-foreground'>{t('artifactAppSettings.iconLabel')}</span>
          <span className='text-xs text-muted-foreground'>{t('artifactAppSettings.iconHint')}</span>
        </div>
        {canEditIcon && onIconChange ? (
          <IconPicker value={app.icon} onChange={onIconChange} size={20} className='shrink-0' />
        ) : (
          <AppIcon
            name={app.icon}
            size={20}
            className='shrink-0 text-muted-foreground'
            aria-hidden='true'
          />
        )}
      </div>

      <Section title={t('artifactAppSettings.aboutSectionTitle')}>
        <div className='flex flex-col gap-2.5'>
          <Fact label={t('artifactAppSettings.createdByLabel')}>
            <span className='flex min-w-0 items-center gap-1.5'>
              <UserAvatar
                userId={app.ownerUserId}
                size={AvatarSize.SM}
                shape={AvatarShape.CIRCULAR}
                showActiveStatus={false}
              />
              <span className='truncate'>
                {app.ownerName ??
                  (isOwner
                    ? t('artifactAppSettings.youLabel')
                    : t('artifactAppSettings.unknownLabel'))}
              </span>
            </span>
          </Fact>
          <Fact
            label={t('artifactAppSettings.visibilityLabel')}
            hint={
              isPublished
                ? `${t('artifactAppSettings.published')}${publishedVersion ? ` v${publishedVersion.versionNumber}` : ''}${
                    app.publishedAt
                      ? ` ${t('artifactAppSettings.onDate', { date: formatDate(new Date(app.publishedAt)) })}`
                      : ''
                  }`
                : t('artifactAppSettings.onlyYouCanOpen')
            }
          >
            {isPublished
              ? t('artifactAppSettings.anyoneInWorkspace')
              : t('artifactAppSettings.privateLabel')}
          </Fact>
          <Fact label={t('artifactAppSettings.createdLabel')}>
            {formatDate(new Date(app.createdAt))}
          </Fact>
          <Fact label={t('artifactAppSettings.lastUpdatedLabel')}>
            {formatRelativeTime(new Date(app.updatedAt))}
          </Fact>
          {app.description && (
            <Fact label={t('artifactAppSettings.descriptionLabel')}>
              <span className='whitespace-pre-wrap'>{app.description}</span>
            </Fact>
          )}
        </div>
      </Section>

      <Section title={t('artifactAppSettings.versionsSectionTitle')}>
        <div className='flex flex-col gap-2.5'>
          <Fact
            label={t('artifactAppSettings.currentFactLabel')}
            hint={
              head
                ? t('artifactAppSettings.builtHint', {
                    time: formatRelativeTime(new Date(head.createdAt)),
                  })
                : undefined
            }
          >
            {head ? `v${head.versionNumber}` : '—'}
          </Fact>
          {/* Owners see the whole history; a non-owner's list is the pin alone,
              so counting it would report "1 build" for an app with twenty. */}
          {isOwner && (
            <Fact label={t('artifactAppSettings.savedBuildsLabel')}>
              {t('artifactAppSettings.buildCount', { count: versions.length })}
            </Fact>
          )}
          <Fact
            label={t('artifactAppSettings.viewingLabel')}
            hint={viewing.id === head?.id ? undefined : t('artifactAppSettings.earlierBuildHint')}
          >
            {t('artifactAppSettings.viewingValue', {
              number: viewing.versionNumber,
              date: formatDate(new Date(viewing.createdAt)),
            })}
          </Fact>
        </div>
      </Section>

      <Section
        title={t('artifactAppSettings.whatBuildCanDoTitle')}
        aside={<span className='text-[11px] text-muted-foreground'>v{viewing.versionNumber}</span>}
      >
        {/* Declarations, not enforcement. The host passes `canWrite` and
            `canInvokeAgents` unconditionally — there is no mutation allowlist —
            so these two say what the build ANNOUNCED about itself. A build that
            writes without declaring it would read as a flat "No", which is why
            the absent case says "Not declared" rather than claiming read-only.
            The reads below are the opposite: nothing undeclared can be fetched. */}
        <div className='flex flex-col gap-2.5'>
          <Fact
            label={t('artifactAppSettings.changesDataLabel')}
            hint={
              manifest.writes
                ? t('artifactAppSettings.writesImmediateHint')
                : t('artifactAppSettings.notDeclaredNoGuaranteeHint')
            }
          >
            {manifest.writes
              ? t('artifactAppSettings.declaredCanEdit')
              : t('artifactAppSettings.notDeclared')}
          </Fact>
          <Fact
            label={t('artifactAppSettings.runsAgentsLabel')}
            hint={
              manifest.invokesAgents
                ? manifest.agents?.length
                  ? manifest.agents.join(', ')
                  : t('artifactAppSettings.runsAsYouHint')
                : t('artifactAppSettings.notDeclaredByBuild')
            }
          >
            {manifest.invokesAgents
              ? t('artifactAppSettings.declared')
              : t('artifactAppSettings.notDeclared')}
          </Fact>
        </div>

        <div className='flex flex-col gap-2'>
          <span className='text-xs text-muted-foreground'>
            {reads.length === 0
              ? t('artifactAppSettings.readsNoData')
              : t('artifactAppSettings.readsDatasets', { count: reads.length })}
          </span>
          {reads.map(r => (
            <div
              key={r.name}
              className='flex flex-col gap-0.5 rounded-md border border-border bg-muted/30 px-2.5 py-2'
            >
              <span className='truncate text-xs font-medium text-foreground'>{r.name}</span>
              {r.description && (
                <span className='text-[11px] text-muted-foreground'>{r.description}</span>
              )}
              <span className='truncate font-mono text-[11px] text-muted-foreground'>
                {sourceLabel(r, t)}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('artifactAppSettings.buildSectionTitle')}>
        <div className='flex flex-col gap-2.5'>
          <Fact label={t('artifactAppSettings.sizeLabel')}>
            {formatFileSize(viewing.sizeBytes)}
          </Fact>
          <Fact
            label={t('artifactAppSettings.filesLabel')}
            hint={t('artifactAppSettings.entryHint', { entry: manifest.entry })}
          >
            {t('artifactAppSettings.fileCount', { count: manifest.fileCount })}
          </Fact>
        </div>
        <div className='flex flex-col gap-1.5'>
          <span className='text-xs text-muted-foreground'>
            {packages.length === 0
              ? t('artifactAppSettings.noPackages')
              : t('artifactAppSettings.packagesPullIn')}
          </span>
          {packages.length > 0 && (
            <div className='flex flex-wrap gap-1'>
              {packages.map(name => (
                <span
                  key={name}
                  className='rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground'
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
};
