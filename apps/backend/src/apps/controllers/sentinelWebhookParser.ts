type SentinelNormalizedPayload = {
  accountName: string;
  siteName: string;
  agentDomain: string;
  externalIp: string;
  agentIpV4: string;
  agentIpV6: string;
  loggedInUser: string;
  agentOsName: string;
  agentOsRevision: string;
  agentUuid: string;
  agentVersion: string;
  activeThreats: number | null;
  agentComputerName: string;
  agentNetworkStatus: string;
  rebootRequired: boolean | null;
  scanFinishedAt: string | null;
  scanStartedAt: string | null;
  scanStatus: string;
  internalIps: string[];
  certificateId: string;
  classification: string;
  createdAt: string | null;
  detectionType: string;
  engines: string[];
  filePath: string;
  fileSize: number | null;
  fileVerificationType: string;
  initiatedBy: string;
  processUser: string;
  publisherName: string;
  sha1: string;
  updatedAt: string | null;
  threatName: string;
  threatId: string;
  mitigationStatusDescription: string;
};

type SentinelOneWebhookPayload = {
  agentDetectionInfo?: {
    accountName?: string | null;
    agentDomain?: string | null;
    externalIp?: string | null;
    agentIpV4?: string | null;
    agentIpV6?: string | null;
    agentLastLoggedInUserName?: string | null;
    agentOsName?: string | null;
    agentOsRevision?: string | null;
    agentUuid?: string | null;
    agentVersion?: string | null;
    siteName?: string | null;
  };
  agentRealtimeInfo?: {
    activeThreats?: number | null;
    agentComputerName?: string | null;
    agentNetworkStatus?: string | null;
    rebootRequired?: boolean | null;
    scanFinishedAt?: string | null;
    scanStartedAt?: string | null;
    scanStatus?: string | null;
    siteName?: string | null;
    networkInterfaces?: Array<{
      inet?: string[] | null;
    }> | null;
  };
  threatInfo?: {
    certificateId?: string | null;
    classification?: string | null;
    createdAt?: string | null;
    detectionType?: string | null;
    engines?: string[] | null;
    filePath?: string | null;
    fileSize?: number | null;
    fileVerificationType?: string | null;
    initiatedBy?: string | null;
    initiatedByDescription?: string | null;
    processUser?: string | null;
    publisherName?: string | null;
    rebootRequired?: boolean | null;
    sha1?: string | null;
    updatedAt?: string | null;
    threatName?: string | null;
    threatId?: string | null;
    mitigationStatusDescription?: string | null;
  };
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, char => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return char;
    }
  });
}

function formatUtcTimestamp(value?: string | null): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  }).format(date) + ' UTC';
}

function formatSize(bytes?: number | null): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return 'N/A';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${Number.isInteger(value) ? value : value.toFixed(2)} ${units[unitIndex]}`;
}

function formatLabelValueSection(title: string, rows: Array<[string, string]>): string {
  const filteredRows = rows.filter(([, value]) => value.trim().length > 0);
  if (filteredRows.length === 0) return `## ${title}`;

  return [
    `${title}`,
    '',
    ...filteredRows.map(([label, value]) => `- ${label}: ${value}`),
  ].join('\n');
}

function hasMeaningfulValue(value: string | null | undefined, placeholders?: string[]): boolean {
  if (!value) return false;
  const normalizedValue = value.trim();
  if (!normalizedValue) return false;

  const disallowed = new Set(['N/A', 'Unknown', 'Unknown machine', 'Unknown threat', 'Detected']);
  for (const placeholder of placeholders ?? []) {
    disallowed.add(placeholder);
  }

  return !disallowed.has(normalizedValue);
}

export function createEmptySentinelNormalizedPayload(): SentinelNormalizedPayload {
  return {
    accountName: 'N/A',
    siteName: 'N/A',
    agentDomain: 'N/A',
    externalIp: 'Unknown',
    agentIpV4: 'N/A',
    agentIpV6: 'N/A',
    loggedInUser: 'N/A',
    agentOsName: 'N/A',
    agentOsRevision: '',
    agentUuid: 'N/A',
    agentVersion: 'N/A',
    activeThreats: null,
    agentComputerName: 'Unknown machine',
    agentNetworkStatus: 'N/A',
    rebootRequired: null,
    scanFinishedAt: null,
    scanStartedAt: null,
    scanStatus: 'N/A',
    internalIps: [],
    certificateId: 'N/A',
    classification: 'Unknown',
    createdAt: null,
    detectionType: 'N/A',
    engines: [],
    filePath: 'N/A',
    fileSize: null,
    fileVerificationType: 'N/A',
    initiatedBy: 'N/A',
    processUser: 'N/A',
    publisherName: 'N/A',
    sha1: 'N/A',
    updatedAt: null,
    threatName: 'Unknown threat',
    threatId: 'Unknown',
    mitigationStatusDescription: 'Detected',
  };
}

export function parseExactSentinelPayload(raw: unknown): SentinelNormalizedPayload | null {
  const payload = (raw ?? {}) as SentinelOneWebhookPayload;
  if (!payload.agentDetectionInfo || !payload.agentRealtimeInfo || !payload.threatInfo) {
    return null;
  }

  const interfaceIps = (payload.agentRealtimeInfo.networkInterfaces ?? [])
    .flatMap(networkInterface => networkInterface.inet ?? [])
    .map(ip => ip.trim())
    .filter(Boolean);
  const ipv4List = payload.agentDetectionInfo.agentIpV4
    ?.split(',')
    .map(item => item.trim())
    .filter(Boolean) ?? [];
  const internalIps = [...new Set([...ipv4List, ...interfaceIps])];

  return {
    accountName: payload.agentDetectionInfo.accountName?.trim() || 'N/A',
    siteName:
      payload.agentRealtimeInfo.siteName?.trim() ||
      payload.agentDetectionInfo.siteName?.trim() ||
      'N/A',
    agentDomain: payload.agentDetectionInfo.agentDomain?.trim() || 'N/A',
    externalIp: payload.agentDetectionInfo.externalIp?.trim() || 'Unknown',
    agentIpV4: ipv4List.join(', ') || 'N/A',
    agentIpV6: payload.agentDetectionInfo.agentIpV6?.trim() || 'N/A',
    loggedInUser: payload.agentDetectionInfo.agentLastLoggedInUserName?.trim() || 'N/A',
    agentOsName: payload.agentDetectionInfo.agentOsName?.trim() || 'N/A',
    agentOsRevision: payload.agentDetectionInfo.agentOsRevision?.trim() || '',
    agentUuid: payload.agentDetectionInfo.agentUuid?.trim() || 'N/A',
    agentVersion: payload.agentDetectionInfo.agentVersion?.trim() || 'N/A',
    activeThreats: payload.agentRealtimeInfo.activeThreats ?? null,
    agentComputerName: payload.agentRealtimeInfo.agentComputerName?.trim() || 'Unknown machine',
    agentNetworkStatus: payload.agentRealtimeInfo.agentNetworkStatus?.trim() || 'N/A',
    rebootRequired:
      payload.agentRealtimeInfo.rebootRequired ?? payload.threatInfo.rebootRequired ?? null,
    scanFinishedAt: payload.agentRealtimeInfo.scanFinishedAt ?? null,
    scanStartedAt: payload.agentRealtimeInfo.scanStartedAt ?? null,
    scanStatus: payload.agentRealtimeInfo.scanStatus?.trim() || 'N/A',
    internalIps,
    certificateId: payload.threatInfo.certificateId?.trim() || 'N/A',
    classification: payload.threatInfo.classification?.trim() || 'Unknown',
    createdAt: payload.threatInfo.createdAt ?? null,
    detectionType: payload.threatInfo.detectionType?.trim() || 'N/A',
    engines:
      payload.threatInfo.engines?.filter(Boolean).map(item => item.trim()).filter(Boolean) ?? [],
    filePath: payload.threatInfo.filePath?.trim() || 'N/A',
    fileSize: payload.threatInfo.fileSize ?? null,
    fileVerificationType: payload.threatInfo.fileVerificationType?.trim() || 'N/A',
    initiatedBy:
      payload.threatInfo.initiatedByDescription?.trim() ||
      payload.threatInfo.initiatedBy?.trim() ||
      'N/A',
    processUser: payload.threatInfo.processUser?.trim() || 'N/A',
    publisherName: payload.threatInfo.publisherName?.trim() || 'N/A',
    sha1: payload.threatInfo.sha1?.trim() || 'N/A',
    updatedAt: payload.threatInfo.updatedAt ?? null,
    threatName: payload.threatInfo.threatName?.trim() || 'Unknown threat',
    threatId: payload.threatInfo.threatId?.trim() || 'Unknown',
    mitigationStatusDescription:
      payload.threatInfo.mitigationStatusDescription?.trim() || 'Detected',
  };
}

function pickInternalIp(payload: SentinelNormalizedPayload): string | null {
  const candidateIps = payload.internalIps;

  if (candidateIps.includes('127.0.0.1')) {
    return '127.0.0.1';
  }

  const firstPrivateIp = candidateIps.find(ip =>
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip),
  );

  return firstPrivateIp ?? candidateIps[0] ?? null;
}

function buildSentinelThreatUrl(payload: SentinelNormalizedPayload): string | null {
  const threatId = payload.threatId.trim();
  if (!threatId || threatId === 'Unknown') return null;

  return `https://apso1-1003.sentinelone.net/incidents/threats/${threatId}/overview`;
}

export function buildSentinelRawFallbackMessage(
  raw: unknown,
  payload: SentinelNormalizedPayload,
): string {
  const topLevelKeys =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.keys(raw as Record<string, unknown>).slice(0, 12)
      : [];

  const summaryLines = [
    '<strong>SentinelOne webhook received</strong>',
    'The payload shape did not fully match the expected format, so posting a raw summary.',
  ];

  const extractedFields = [
    ['Threat Name', payload.threatName],
    ['Threat ID', payload.threatId],
    ['Status', payload.mitigationStatusDescription],
    ['Hostname', payload.agentComputerName],
    ['External IP', payload.externalIp],
    ['File Path', payload.filePath],
  ].filter(([, value]) => hasMeaningfulValue(value, ['Unknown', 'Unknown machine', 'N/A']));

  if (extractedFields.length > 0) {
    summaryLines.push('', '<strong>Extracted fields</strong>');
    summaryLines.push(
      ...extractedFields.map(
        ([label, value]) => `• ${escapeHtml(label)}: ${escapeHtml(value)}`,
      ),
    );
  }

  if (topLevelKeys.length > 0) {
    summaryLines.push('', '<strong>Top-level keys</strong>', escapeHtml(topLevelKeys.join(', ')));
  }

  try {
    const rawPreview = JSON.stringify(raw, null, 2);
    const truncatedPreview = rawPreview.length > 1800 ? `${rawPreview.slice(0, 1800)}\n…` : rawPreview;
    summaryLines.push('', '<strong>Raw payload preview</strong>', `<pre>${escapeHtml(truncatedPreview)}</pre>`);
  } catch {
    summaryLines.push('', '<strong>Raw payload preview</strong>', '<pre>Unable to serialize payload</pre>');
  }

  return summaryLines.join('<br/>');
}

export function buildSentinelRawFallbackTicketDescription(raw: unknown): string {
  const topLevelKeys =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.keys(raw as Record<string, unknown>).slice(0, 12)
      : [];

  const lines = [
    'SentinelOne webhook received in an unexpected payload format.',
    '',
    'Raw Payload Summary',
  ];

  if (topLevelKeys.length > 0) {
    lines.push(`- Top-level keys: ${topLevelKeys.join(', ')}`);
  }

  try {
    const rawPreview = JSON.stringify(raw, null, 2);
    const truncatedPreview = rawPreview.length > 3000 ? `${rawPreview.slice(0, 3000)}\n…` : rawPreview;
    lines.push('', 'Raw Payload Preview', truncatedPreview);
  } catch {
    lines.push('', 'Raw Payload Preview', 'Unable to serialize payload');
  }

  return lines.join('\n');
}

export function buildSentinelRawFallbackTicketText(): string {
  return 'SentinelOne webhook received with an unexpected payload format.';
}

export function formatSentinelOneMessage(payload: SentinelNormalizedPayload): string {
  const machineName = payload.agentComputerName || 'Unknown machine';
  const mitigationStatus = payload.mitigationStatusDescription || 'Detected';
  const mitigationStatusLower = mitigationStatus.toLowerCase();
  const detectedAt = formatUtcTimestamp(payload.createdAt);
  const mitigatedAt = formatUtcTimestamp(payload.updatedAt);
  const threatName = payload.threatName || 'Unknown threat';
  const threatId = payload.threatId || 'Unknown';
  const filePath = payload.filePath || 'Unknown';
  const fileName = filePath.split('/').filter(Boolean).pop() || threatName;
  const classification = payload.classification || 'Unknown';
  const externalIp = payload.externalIp || 'Unknown';
  const internalIp = pickInternalIp(payload) || 'Unknown';
  const threatUrl = buildSentinelThreatUrl(payload);
  const operatingSystem = [payload.agentOsName, payload.agentOsRevision].filter(Boolean).join(' ') || 'Unknown';

  const lines = [
    `<strong>New ${escapeHtml(mitigationStatusLower)} threat - machine ${escapeHtml(machineName)}</strong>`,
    `SentinelOne detected <strong>${escapeHtml(threatName)}</strong> on <strong>${escapeHtml(machineName)}</strong>.`,
    ``,
    `<strong>Threat details</strong>`,
    `• Status: ${escapeHtml(mitigationStatus)}`,
    `• Classification: ${escapeHtml(classification)}`,
    `• File: ${escapeHtml(fileName)}`,
    `• Threat ID: ${escapeHtml(threatId)}`,
    ``,
    `<strong>Endpoint details</strong>`,
    `• Hostname: ${escapeHtml(machineName)}`,
    `• OS: ${escapeHtml(operatingSystem)}`,
    `• External IP: ${escapeHtml(externalIp)}`,
    `• Internal IP: ${escapeHtml(internalIp)}`,
  ];

  if (detectedAt) {
    lines.push('', `• Detected at: ${escapeHtml(detectedAt)}`);
  }

  if (mitigatedAt) {
    lines.push(`• Updated at: ${escapeHtml(mitigatedAt)}`);
  }

  if (threatUrl) {
    const escapedUrl = escapeHtml(threatUrl);
    lines.push('', `Open threat details: <a href="${escapedUrl}">${escapedUrl}</a>`);
  }

  return lines.join('<br/>');
}

export function formatSentinelOneTicketDescription(payload: SentinelNormalizedPayload): string {
  const threatName = payload.threatName || 'Unknown threat';
  const threatUrl = buildSentinelThreatUrl(payload) ?? 'N/A';
  const threatId = payload.threatId || 'Unknown';
  const mitigationStatus = payload.mitigationStatusDescription.toLowerCase() || 'detected';
  const filePath = payload.filePath || 'N/A';
  const fileName = filePath.split('/').filter(Boolean).pop() || threatName;
  const detectedAt = formatUtcTimestamp(payload.createdAt) || 'Unknown';
  const mitigatedAt = formatUtcTimestamp(payload.updatedAt) || 'N/A';
  const operatingSystem = [payload.agentOsName, payload.agentOsRevision].filter(Boolean).join(' ') || 'N/A';

  const threatSection = formatLabelValueSection('Threat Details', [
    ['Threat Name', threatName],
    ['Threat URL', threatUrl],
    ['Threat ID', threatId],
    ['Threat Status', mitigationStatus],
    ['Threat Filename', fileName],
    ['Threat Filepath', filePath],
    ['SHA', payload.sha1 || 'N/A'],
    ['Process User', payload.processUser || 'N/A'],
    ['Publisher Name', payload.publisherName || 'N/A'],
    ['Signer Identity', payload.certificateId || 'N/A'],
    ['Signature Verification', payload.fileVerificationType || 'N/A'],
    ['Initiated By', payload.initiatedBy || 'N/A'],
    ['Engines', payload.engines.filter(Boolean).join(', ') || 'N/A'],
    ['Detection Type', payload.detectionType || 'N/A'],
    ['Classification', payload.classification || 'N/A'],
    ['File Size', formatSize(payload.fileSize)],
  ]);

  const endpointSection = formatLabelValueSection('Endpoint (Agent) Details', [
    ['Account Name', payload.accountName || 'N/A'],
    ['Site Name', payload.siteName || 'N/A'],
    ['Connectivity', payload.agentNetworkStatus || 'N/A'],
    ['Full Disk Scan', payload.scanStartedAt ? 'Yes' : 'No'],
    ['Pending Reboot', payload.rebootRequired ? 'Yes' : 'No'],
    ['Number of not mitigated threats', payload.activeThreats?.toString() || '0'],
    ['Scan Status', payload.scanStatus || 'N/A'],
    ['Network Status', payload.agentNetworkStatus || 'N/A'],
    ['Endpoint Hostname', payload.agentComputerName || 'Unknown'],
  ]);

  const detectionSection = formatLabelValueSection('Detection Time Details', [
    ['Detected At', detectedAt],
    ['Mitigated At', mitigatedAt],
    ['OS Version', operatingSystem],
    ['Agent Version', payload.agentVersion || 'N/A'],
    ['Logged in User', payload.loggedInUser || 'N/A'],
    ['UUID', payload.agentUuid || 'N/A'],
    ['Domain', payload.agentDomain || 'N/A'],
    ['IPV4 Address', payload.agentIpV4 || 'N/A'],
    ['IPV6 Address', payload.agentIpV6 || 'N/A'],
    ['Console Visible IP', payload.externalIp || 'N/A'],
  ]);

  return [
    `SentinelOne detected a threat on ${payload.agentComputerName || 'Unknown machine'}.`,
    '',
    threatSection,
    '',
    endpointSection,
    '',
    detectionSection,
  ].join('\n');
}

export function formatSentinelOneTicketText(payload: SentinelNormalizedPayload): string {
  const machineName = payload.agentComputerName || 'Unknown machine';
  const mitigationStatus = payload.mitigationStatusDescription || 'Detected';
  const threatName = payload.threatName || 'Unknown threat';

  return `SentinelOne threat detected: ${threatName} on ${machineName} (${mitigationStatus})`;
}
