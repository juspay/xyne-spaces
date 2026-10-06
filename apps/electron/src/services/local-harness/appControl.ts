const APP_TOOLS = new Set([
  'app-navigate',
  'app-describe',
  'app-snapshot',
  'app-click',
  'app-type',
  'app-screenshot',
]);

export function isAppControlTool(toolName: string): boolean {
  return APP_TOOLS.has(toolName);
}
