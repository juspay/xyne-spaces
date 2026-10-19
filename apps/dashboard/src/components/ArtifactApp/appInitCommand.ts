import { cliDownloadUrl } from '@/routes/AIScreen/library/developers/developerTools';

/** The project folder `spaces app init` creates for an app: its name, kebab-cased. */
export function appFolderName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'xyne-app';
}

/**
 * Installs the Spaces CLI from this Spaces, then scaffolds a project pinned to
 * the app. Shown by Create app, and on an app that has nothing built yet.
 */
export function appInitCommand(title: string, appId: string): string {
  return `npm i -g ${cliDownloadUrl()} && spaces app init ${appFolderName(title)} --app-id ${appId}`;
}
