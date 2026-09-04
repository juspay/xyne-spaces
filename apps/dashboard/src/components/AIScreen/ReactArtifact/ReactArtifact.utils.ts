import { SANDBOX_TEMPLATES } from '@codesandbox/sandpack-react';
import { apiInstance } from '../../../services/clients/apiClient';
import type { ReactArtifactPayload, ReactArtifactRef } from './ReactArtifact.types';
import { artifactAppPayloadUrl } from '../../../services/claw/artifactAppsService';
import { clawRequest } from '../../../services/claw/clawRequest';
import { SHADCN_FILES, SHADCN_DEPENDENCIES } from './shadcnPreamble.generated';
import { XYNE_DATA_RUNTIME_CODE, XYNE_DATA_RUNTIME_PATH } from './xyneDataRuntime';

/** Bundler entry Sandpack boots from. Distinct from the artifact's `entry`,
 *  which names the root *component* file. */
export const SANDPACK_ENTRY = '/index.tsx';

/** Sandpack's HTML shell. Overriding the template's copy is how the Tailwind
 *  theme block gets into the document. */
export const TAILWIND_SHELL = '/public/index.html';

/**
 * Stock shadcn tokens (neutral base), as a `text/tailwindcss` source that
 * Tailwind v4's browser build compiles at runtime — there is no build step
 * inside the preview, so the usual `@import "tailwindcss"` processed by PostCSS
 * is not available.
 *
 * This is injected from JS at boot rather than relying on the HTML shell: the
 * bundler serves its own preview document, so a `<style>` we put in
 * /public/index.html is not guaranteed to survive. Building the element
 * ourselves works either way.
 */
const TAILWIND_THEME_CSS = `@import "tailwindcss";

@theme {
  --color-border: hsl(240 5.9% 90%);
  --color-input: hsl(240 5.9% 90%);
  --color-ring: hsl(240 10% 3.9%);
  --color-background: hsl(0 0% 100%);
  --color-foreground: hsl(240 10% 3.9%);
  --color-primary: hsl(240 5.9% 10%);
  --color-primary-foreground: hsl(0 0% 98%);
  --color-secondary: hsl(240 4.8% 95.9%);
  --color-secondary-foreground: hsl(240 5.9% 10%);
  --color-muted: hsl(240 4.8% 95.9%);
  --color-muted-foreground: hsl(240 3.8% 46.1%);
  --color-accent: hsl(240 4.8% 95.9%);
  --color-accent-foreground: hsl(240 5.9% 10%);
  --color-destructive: hsl(0 84.2% 60.2%);
  --color-destructive-foreground: hsl(0 0% 98%);
  --color-card: hsl(0 0% 100%);
  --color-card-foreground: hsl(240 10% 3.9%);
  --color-popover: hsl(0 0% 100%);
  --color-popover-foreground: hsl(240 10% 3.9%);
  --radius: 0.5rem;
}

/* shadcn's base layer. Tailwind v4 changed the default border colour from
   gray-200 to currentColor, so without this every bare 'border' class
   inherits the foreground colour and renders near-black. shadcn's own
   globals.css does the same thing via @apply border-border. */
@layer base {
  *,
  ::after,
  ::before,
  ::backdrop,
  ::file-selector-button {
    border-color: var(--color-border);
  }

  body {
    background-color: var(--color-background);
    color: var(--color-foreground);
  }
}
`;

const TAILWIND_SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style type="text/tailwindcss">
      @import "tailwindcss";

      @theme {
        --color-border: hsl(240 5.9% 90%);
        --color-input: hsl(240 5.9% 90%);
        --color-ring: hsl(240 10% 3.9%);
        --color-background: hsl(0 0% 100%);
        --color-foreground: hsl(240 10% 3.9%);
        --color-primary: hsl(240 5.9% 10%);
        --color-primary-foreground: hsl(0 0% 98%);
        --color-secondary: hsl(240 4.8% 95.9%);
        --color-secondary-foreground: hsl(240 5.9% 10%);
        --color-muted: hsl(240 4.8% 95.9%);
        --color-muted-foreground: hsl(240 3.8% 46.1%);
        --color-accent: hsl(240 4.8% 95.9%);
        --color-accent-foreground: hsl(240 5.9% 10%);
        --color-destructive: hsl(0 84.2% 60.2%);
        --color-destructive-foreground: hsl(0 0% 98%);
        --color-card: hsl(0 0% 100%);
        --color-card-foreground: hsl(240 10% 3.9%);
        --color-popover: hsl(0 0% 100%);
        --color-popover-foreground: hsl(240 10% 3.9%);
        --radius: 0.5rem;
      }

      body {
        background-color: var(--color-background);
        color: var(--color-foreground);
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

/** Always installed, so the agent never spends output tokens declaring them. */
const BASE_DEPENDENCIES: Record<string, string> = {
  ...SHADCN_DEPENDENCIES,
  // eslint-disable-next-line @typescript-eslint/naming-convention -- npm package name
  '@tailwindcss/browser': 'latest',
};

/** "/components/App.tsx" -> "./components/App" (extension stripped for the import). */
function toModuleSpecifier(path: string): string {
  return `.${path.replace(/\.[jt]sx?$/, '')}`;
}

/**
 * Sandpack wants `{ "/App.tsx": { code } }`; the payload stores an ordered array.
 *
 * The agent's `entry` is the file default-exporting the root component — it does
 * NOT mount anything. Sandpack needs a bundler entry that calls `createRoot`, so
 * one is synthesized unless the agent supplied its own.
 */
export function toSandpackFiles(
  payload: ReactArtifactPayload,
): Record<string, { code: string; active?: boolean; hidden?: boolean }> {
  const files: Record<string, { code: string; active?: boolean; hidden?: boolean }> = {};

  // Preamble first, so an agent that supplies its own copy of a path wins.
  for (const [path, code] of Object.entries(SHADCN_FILES)) {
    files[path] = { code, hidden: true };
  }
  files[TAILWIND_SHELL] = { code: TAILWIND_SHELL_HTML, hidden: true };

  for (const file of payload.files) {
    files[file.path] = {
      code: file.content,
      ...(file.path === payload.entry ? { active: true } : {}),
    };
  }

  // Injected AFTER the agent's files, deliberately overwriting — the opposite of
  // the preamble rule above. The bridge endpoint must be ours: a payload saved
  // before this path was reserved could otherwise ship its own /lib/xyne-data.
  // Always injected: the synthesized entry imports it for the root boundary,
  // and a stray import from agent code can never break the build.
  files[XYNE_DATA_RUNTIME_PATH] = { code: XYNE_DATA_RUNTIME_CODE, hidden: true };

  if (!files[SANDPACK_ENTRY]) {
    files[SANDPACK_ENTRY] = {
      code: [
        "import { StrictMode } from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "import { XyneErrorBoundary } from './lib/xyne-data';",
        `import Root from '${toModuleSpecifier(payload.entry)}';`,
        '',
        '// Install the theme BEFORE Tailwind compiles. A static',
        "// `import '@tailwindcss/browser'` would be hoisted above this and run",
        '// first, finding no source to compile — hence the dynamic import below.',
        "const themeStyle = document.createElement('style');",
        "themeStyle.setAttribute('type', 'text/tailwindcss');",
        'themeStyle.textContent = ' + JSON.stringify(TAILWIND_THEME_CSS) + ';',
        'document.head.appendChild(themeStyle);',
        '',
        'function mount() {',
        "  const el = document.getElementById('root');",
        '  // The boundary reports a throw during render to the host, which is',
        '  // what turns a blank frame into an error the agent can be asked to fix.',
        '  if (el) {',
        '    createRoot(el).render(',
        '      <StrictMode>',
        '        <XyneErrorBoundary>',
        '          <Root />',
        '        </XyneErrorBoundary>',
        '      </StrictMode>,',
        '    );',
        '  }',
        '}',
        '',
        '// Mount after Tailwind has generated its stylesheet so the first paint is',
        '// styled; still mount if it fails, so a CSS problem never blanks the app.',
        "import('@tailwindcss/browser').then(mount).catch(mount);",
        '',
      ].join('\n'),
      hidden: true,
    };
  }
  return files;
}

/**
 * Peer dependencies that packages import at runtime but that Sandpack's bundler
 * will not fetch on its own: it installs exactly the versions listed in
 * `customSetup.dependencies` and does not walk a package's own peerDependencies.
 * The agent only declares what it imports directly, so without this a
 * `recharts` artifact dies on "Could not find dependency: 'react-is'".
 */
const IMPLICIT_PEER_DEPS: Record<string, Record<string, string>> = {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- npm package names
  recharts: { 'react-is': 'latest' },
};

/**
 * Resolve the dependency set Sandpack installs: what the agent declared, plus
 * the packages the injected shadcn preamble and Tailwind runtime need, plus any
 * peer deps the bundler won't discover on its own. The agent never has to list
 * the base stack, which is what makes every artifact come out looking alike.
 * Agent-declared pins win, so it can still ask for a specific version.
 */
export function withImplicitPeerDeps(dependencies: Record<string, string>): Record<string, string> {
  const resolved = { ...BASE_DEPENDENCIES, ...dependencies };
  for (const pkg of Object.keys(resolved)) {
    for (const [peer, version] of Object.entries(IMPLICIT_PEER_DEPS[pkg] ?? {})) {
      if (!resolved[peer]) resolved[peer] = version;
    }
  }
  return resolved;
}

/**
 * The project exactly as the bundler compiles it: Sandpack merges
 * `{ ...template.files, ...ourFiles }` and regenerates package.json from the
 * merged dependency set, so neither the template's files nor the real
 * dependency list appear in what we hand it. This reconstructs the whole thing
 * for display, so the code browser shows a genuine React project rather than
 * the fragment we happen to pass in.
 */
export function toProjectFiles(
  payload: ReactArtifactPayload,
): Record<string, { code: string; injected: boolean }> {
  const ours = toSandpackFiles(payload);
  const template = SANDBOX_TEMPLATES['react-ts'];
  const authored = new Set(payload.files.map(f => f.path));
  const project: Record<string, { code: string; injected: boolean }> = {};

  const templateFiles = (template.files ?? {}) as Record<string, { code?: string } | string>;
  for (const [path, file] of Object.entries(templateFiles)) {
    const code = typeof file === 'string' ? file : (file.code ?? '');
    project[path] = { code, injected: true };
  }
  for (const [path, file] of Object.entries(ours)) {
    project[path] = { code: file.code, injected: !authored.has(path) };
  }

  // Sandpack rebuilds package.json from template + customSetup dependencies, so
  // the template's copy is stale by the time anything runs. Show the real one.
  // The react-ts template declares its dependencies inside its own
  // /package.json file rather than as fields on the template object, so read
  // them back out of the file we just copied.
  let templateDeps: Record<string, string> = {};
  let templateDevDeps: Record<string, string> = {};
  try {
    const raw = project['/package.json']?.code;
    if (raw) {
      const parsed = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      templateDeps = parsed.dependencies ?? {};
      templateDevDeps = parsed.devDependencies ?? {};
    }
  } catch {
    // Malformed template package.json — fall back to just our own dependencies.
  }

  const dependencies: Record<string, string> = {
    ...templateDeps,
    ...withImplicitPeerDeps(payload.dependencies),
  };
  project['/package.json'] = {
    code: JSON.stringify(
      {
        name:
          payload.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'artifact-app',
        version: '1.0.0',
        private: true,
        main: SANDPACK_ENTRY,
        dependencies,
        devDependencies: templateDevDeps,
      },
      null,
      2,
    ),
    injected: true,
  };

  return project;
}

function decodeBase64(data: string): string {
  const binary = atob(data);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isPayload(value: unknown): value is ReactArtifactPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ReactArtifactPayload>;
  return typeof candidate.entry === 'string' && Array.isArray(candidate.files);
}

/**
 * Resolve an artifact's full source. Two sources, because the artifact is
 * addressable differently depending on when it is opened: immediately after the
 * run the bytes ride the completion event (`inlineData`) and the attachment id
 * is still a client-side placeholder, while on a reloaded thread only the
 * persisted id exists and the bytes must be fetched.
 */
export async function loadSavedArtifactPayload(
  savedAppId: string,
  versionId?: string,
): Promise<ReactArtifactPayload> {
  const parsed = await clawRequest<unknown>(artifactAppPayloadUrl(savedAppId, versionId));
  if (!isPayload(parsed)) throw new Error('Artifact payload is malformed.');
  return parsed;
}

export async function loadArtifactPayload(
  artifact: Pick<ReactArtifactRef, 'attachmentId' | 'inlineData'>,
): Promise<ReactArtifactPayload> {
  if (artifact.inlineData) {
    const parsed: unknown = JSON.parse(decodeBase64(artifact.inlineData));
    if (!isPayload(parsed)) throw new Error('Artifact payload is malformed.');
    return parsed;
  }

  const { data } = await apiInstance.get<unknown>(
    `/xyne-ai/v2/attachments/${encodeURIComponent(artifact.attachmentId)}/download`,
  );
  const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : data;
  if (!isPayload(parsed)) throw new Error('Artifact payload is malformed.');
  return parsed;
}

/**
 * Sandpack ships `light`/`dark` presets. The app themes its own surfaces via a
 * `data-theme` attribute, where `midnight` is the only dark one.
 */
export function sandpackThemeName(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'midnight' ? 'dark' : 'light';
}
