import {
  CLI_NPM_PACKAGE,
  CLI_NPM_MAJOR,
  spacesBaseUrl,
} from '@/routes/AIScreen/library/developers/developerTools';

/** The project folder `spaces app init` creates for an app: its name, kebab-cased. */
export function appFolderName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'xyne-app';
}

/**
 * One line that runs the Spaces CLI from npm, with nothing installed globally,
 * and scaffolds a project pinned to the app. Shown by Create app, and on an app
 * that has nothing built yet.
 *
 * - `npx -y`: no "Ok to proceed?" prompt, which would also hang a terminal that
 *   can't answer it (a coding agent's shell, CI).
 * - `@<major>`: the newest release of this major, so fixes arrive without a
 *   dashboard change and a breaking major never arrives unannounced.
 * - `--url`: this Spaces. The CLI has no default host, and saves this one as its
 *   default the first time, so a later `spaces app push` targets it too.
 *
 * Every part is safe to paste: the folder name is reduced to [a-z0-9-], the app
 * id is a server-issued cuid, and the URL is `spacesBaseUrl()`, this Spaces' own
 * address (its API origin without a leading `app.`).
 */
export function appInitCommand(title: string, appId: string): string {
  return `npx -y ${CLI_NPM_PACKAGE}@${CLI_NPM_MAJOR} app init ${appFolderName(title)} --app-id ${appId} --url ${spacesBaseUrl()}`;
}

/**
 * Pushing from inside the project. Also through npx: the init command installs
 * nothing globally, so a bare `spaces` would be "command not found". It needs no
 * `--url`: init saved this Spaces as the CLI's default host.
 */
export function appPushCommand(): string {
  return `npx -y ${CLI_NPM_PACKAGE}@${CLI_NPM_MAJOR} app push`;
}
