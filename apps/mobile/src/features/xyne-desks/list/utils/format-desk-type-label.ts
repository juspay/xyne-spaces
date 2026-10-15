/** Human label for the metadata line under the desk name. */
export function formatDeskTypeLabel(type: string): string {
  switch (type) {
    case 'EMAIL':
      return 'Email desk';
    case 'SLACK':
      return 'Slack desk';
    case 'APP':
      return 'App desk';
    default:
      return 'Desk';
  }
}
