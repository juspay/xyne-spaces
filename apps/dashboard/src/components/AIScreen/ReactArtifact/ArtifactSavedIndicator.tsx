/**
 * Tells a chat card two things it otherwise cannot say: that the artifact is
 * already stored as an app, and whether the app has since moved past it.
 *
 * Session-scoping materializes every generation into an app automatically, so
 * the Save button was removed — clicking it would only mint a duplicate. But
 * nothing replaced it, which left no signal that the artifact was saved at all
 * and no way to reach it from the card. This is that signal.
 *
 * The staleness half exists because cards deliberately pin the version their own
 * turn produced: scrolling back through a thread must show what was actually
 * said, not silently re-render the newest build. The cost of that honesty is
 * that an old card looks current, so it needs to say it isn't.
 *
 * Staleness is measured against `headVersionId`, NOT the highest version number.
 * After a restore, head is deliberately an earlier version and the card showing
 * it IS current — calling that stale would be a lie in the opposite direction.
 */

import { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, History } from 'lucide-react';
import { getArtifactApp } from '../../../services/claw/artifactAppsService';

interface ArtifactSavedIndicatorProps {
  appId: string;
  /** The build this card rendered. Absent on artifacts that predate scoping. */
  versionId?: string;
}

export const ArtifactSavedIndicator = ({
  appId,
  versionId,
}: ArtifactSavedIndicatorProps): ReactElement | null => {
  const { workspaceId, appId: routeAppId } = useParams<{
    workspaceId?: string;
    appId?: string;
  }>();

  // The Library's own app page renders this same view, where a link back to the
  // page you are already on says nothing. Detected here rather than threaded
  // through as a prop so a future caller cannot forget to pass it.
  const isAppsOwnPage = routeAppId === appId;

  // Keyed by app, so a thread rendering N cards of the same app issues ONE
  // request rather than N. Owning the query here rather than in
  // ReactArtifactView also keeps the settle out of that component's render —
  // its memoized Sandpack must not be disturbed to draw a header chip.
  const { data } = useQuery({
    queryKey: ['artifact-app', appId],
    queryFn: () => getArtifactApp(appId),
    staleTime: 30_000,
    enabled: !isAppsOwnPage,
  });

  if (isAppsOwnPage) return null;

  const href = workspaceId ? `/${workspaceId}/ai/library/app/${appId}` : `/ai/library/app/${appId}`;

  const head = data?.app.headVersionId ?? null;
  // Until the app loads we know it is saved but not whether it is current.
  // Default to "Saved": flashing a stale warning that resolves away is worse
  // than showing the staleness a moment late.
  const isStale = Boolean(head && versionId && head !== versionId);
  const headNumber = head ? data?.versions.find(v => v.id === head)?.versionNumber : undefined;

  if (isStale) {
    return (
      <Link
        to={href}
        className='flex shrink-0 items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-600 transition-colors hover:bg-sky-500/20 dark:text-sky-400'
        title={
          headNumber
            ? `This app has moved on to version ${headNumber}. Open the current version.`
            : 'A newer version of this app exists. Open the current version.'
        }
        data-track-category='AskAI'
        data-track-name='ReactArtifactOpenNewerVersion'
      >
        <History className='h-3 w-3' aria-hidden='true' />
        {headNumber ? `Newer version (v${headNumber})` : 'Newer version'}
      </Link>
    );
  }

  return (
    <Link
      to={href}
      className='flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400'
      title='Saved to your apps. Open it in the Library.'
      data-track-category='AskAI'
      data-track-name='ReactArtifactOpenSavedApp'
    >
      <Check className='h-3 w-3' aria-hidden='true' />
      Saved
    </Link>
  );
};
