import type { CredentialField, McpServer } from '@/services/claw/clawMcpTypes';

// The prompt is sent to a model and can end up in web-search queries, so nothing
// secret may reach it. The user's typed values never do: this module has no input
// for them. What can is a secret saved on the connector definition itself.

const TEMPLATE_REF = /\{\{\s*[\w.-]+\s*\}\}/g;
// Auth-scheme words that legitimately sit next to a template ref.
const SCHEME_WORDS = /\b(?:Bearer|Basic|Token|Bot|ApiKey)\b/gi;
const HIDDEN = '<set by connector>';
const REDACTED = '<redacted>';

// A template value is shown only when it is nothing but field refs, scheme words
// and separators (`Bearer {{token}}`, `{{user}}:{{pass}}`). Any other text left
// over may be a secret baked into the connector, so the whole value is hidden.
const isPureTemplate = (value: string): boolean => {
  if (!value.match(TEMPLATE_REF)) {
    return false;
  }
  return /^[\s:;,]*$/.test(value.replace(TEMPLATE_REF, '').replace(SCHEME_WORDS, ''));
};

const redactValues = (values: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, isPureTemplate(value) ? value : HIDDEN]),
  );

// Shapes of real credentials, for text a connector author wrote freely
// (description, labels, placeholders). Placeholders like `dapi_xxxx` don't match:
// the generic rule needs a long run that mixes letters and digits.
const SECRET_SHAPES = [
  /\b(?:sk|pk|rk)-[\w-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
  /\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{32,}\b/g,
];

const scrub = (text: string): string =>
  SECRET_SHAPES.reduce((out, shape) => out.replace(shape, REDACTED), text);

// Only the origin: credentials can ride in the userinfo, query string or path
// (some hosted MCPs embed the key in the path).
const describeEndpoint = (url: string): string | null => {
  if (!url.trim()) {
    return null;
  }
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
};

const describeTemplate = (server: McpServer): Record<string, unknown> | null => {
  const http = server.httpConfigTemplate;
  if (http?.headers && Object.keys(http.headers).length > 0) {
    return { headers: redactValues(http.headers) };
  }
  const launch = server.launchConfigTemplate;
  if (launch?.env && Object.keys(launch.env).length > 0) {
    return { env: redactValues(launch.env) };
  }
  return null;
};

const describeField = (field: CredentialField): string => {
  const traits = [field.type === 'password' ? 'secret' : 'text', field.optional && 'optional'];
  const example = field.placeholder ? `, e.g. "${scrub(field.placeholder)}"` : '';
  return `- ${scrub(field.label)} (\`${field.name}\`, ${traits.filter(Boolean).join(', ')}${example})`;
};

/**
 * The question Ask AI is sent when the user asks how to fill a connector's
 * credential form. It carries the connector's definition only — never what the
 * user has typed — and asks for researched, step-by-step instructions.
 */
export const buildMcpSetupPrompt = (
  server: McpServer,
  label: string,
  fields: readonly CredentialField[],
): string => {
  const endpoint = describeEndpoint(server.url);
  const transport = server.transport ? `transport: ${server.transport}` : null;
  const template = describeTemplate(server);
  return [
    `I'm connecting the "${scrub(label)}" MCP connector in Xyne and need help finding the values it asks for.`,
    endpoint
      ? `Endpoint: ${endpoint}${transport ? ` (${transport})` : ''}`
      : transport && `Runs as a ${server.transport} connector.`,
    server.description ? `About: ${scrub(server.description)}` : null,
    `Fields it asks for:\n${fields.map(describeField).join('\n')}`,
    template
      ? `How the connector uses them:\n\`\`\`json\n${JSON.stringify(template, null, 2)}\n\`\`\``
      : null,
    `Research the official ${scrub(label)} documentation and give me step-by-step instructions to get each value: where to click, which plan, role or scopes it needs, and the exact format to paste. Cite the doc links you used.`,
  ]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join('\n\n');
};
