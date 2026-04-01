import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import type { TeamIntelligenceSerializedReport } from './types';

type ReportJson = {
  title?: string;
  overview?: string;
  perPersonActivity?: Array<{
    userId?: string;
    name?: string;
    summary?: string;
    themes?: string[];
    workloadSignals?: string[];
  }>;
  teamDistribution?: {
    summary?: string;
    hotspots?: string[];
    gaps?: string[];
  };
  overlaps?: Array<{
    people?: string[];
    summary?: string;
    evidence?: string[];
    riskLevel?: string;
  }>;
  conflicts?: Array<{
    summary?: string;
    severity?: string;
    evidence?: string[];
  }>;
};

type ReportSourceSummary = {
  totalMembers?: number;
  totalEmails?: number;
  totalTranscripts?: number;
  perUserLimit?: number;
};

type NormalizedPersonCard = {
  userId: string;
  name: string;
  role: string;
  initials: string;
  summary: string;
  themes: string[];
  workloadSignals: string[];
  signalLevel: 'low' | 'medium' | 'high';
  activityScore: number;
  activityPercent: number;
};

type NormalizedOverlap = {
  people: [string, string];
  summary: string;
  evidence: string[];
  riskLevel: 'low' | 'medium' | 'high';
};

type NormalizedConflict = {
  summary: string;
  severity: 'low' | 'medium' | 'high';
  evidence: string[];
};

type RenderModel = {
  title: string;
  orgName: string;
  orgId: string;
  generatedAt: string;
  timeRangeLabel: string;
  summaryBlurb: string;
  overview: string;
  includeTranscripts: boolean;
  sourceSummary: ReportSourceSummary;
  people: NormalizedPersonCard[];
  distributionSummary: string;
  hotspots: string[];
  gaps: string[];
  overlaps: NormalizedOverlap[];
  conflicts: NormalizedConflict[];
  themeCloud: string[];
  markdown: string | null;
};

type PersonRoleMap = Map<string, string>;

const pdfLogger = logger.child({ module: 'team-intelligence-report-pdf' });

const PAGE_MARGIN = 48;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const BODY_FONT_SIZE = 11;
const HEADING_FONT_SIZE = 18;
const SECTION_FONT_SIZE = 14;
const LINE_HEIGHT = 15;
const SECTION_SPACING = 18;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getReportJson = (report: TeamIntelligenceSerializedReport): ReportJson => {
  if (!isObject(report.report)) {
    return {};
  }

  return report.report as ReportJson;
};

const getSourceSummary = (report: TeamIntelligenceSerializedReport): ReportSourceSummary => {
  if (!isObject(report.sourceSummary)) {
    return {};
  }

  return report.sourceSummary as ReportSourceSummary;
};

const normalizeLine = (line: string): string =>
  line
    .replace(/\r/g, '')
    .replace(/\t/g, '  ')
    .replace(/\s+/g, ' ')
    .trim();

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date);
};

const formatDateRange = (start: string, end: string): string => {
  return `${formatDateTime(start)} - ${formatDateTime(end)}`;
};

const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(token => token[0]?.toUpperCase() + token.slice(1))
    .join(' ');

const getInitials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || 'TM';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

const summarizeOverview = (overview: string): string => {
  const compact = normalizeLine(overview);
  if (!compact) {
    return 'A concise intelligence snapshot for leadership, highlighting workload distribution, overlap risk, and emerging focus areas across the scoped team.';
  }

  if (compact.length <= 220) {
    return compact;
  }

  return `${compact.slice(0, 217).trimEnd()}...`;
};

const inferActivityScore = (person: {
  summary?: string;
  themes?: string[];
  workloadSignals?: string[];
}): number => {
  const themeScore = asStringArray(person.themes).length * 18;
  const workloadScore = asStringArray(person.workloadSignals).length * 22;
  const summaryScore = Math.min((person.summary?.length || 0) / 8, 36);
  return Math.round(clamp(24 + themeScore + workloadScore + summaryScore, 18, 100));
};

const getSignalLevel = (score: number): 'low' | 'medium' | 'high' => {
  if (score >= 72) return 'high';
  if (score >= 46) return 'medium';
  return 'low';
};

const getThemeTone = (
  theme: string
): 'infra' | 'product' | 'compliance' | 'operations' | 'neutral' => {
  const normalized = theme.toLowerCase();
  if (/(infra|platform|backend|api|data|migration|pipeline|storage|search|vespa|index|sync)/.test(normalized)) {
    return 'infra';
  }
  if (/(product|feature|growth|dashboard|ui|ux|experience|launch|roadmap|report)/.test(normalized)) {
    return 'product';
  }
  if (/(risk|security|audit|compliance|privacy|fraud|legal|conflict|incident)/.test(normalized)) {
    return 'compliance';
  }
  if (/(ops|support|workflow|process|runbook|sla|oncall|operations)/.test(normalized)) {
    return 'operations';
  }
  return 'neutral';
};

const riskLabel = (value: string | undefined): 'low' | 'medium' | 'high' => {
  if (value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'medium';
};

const buildRenderModel = (
  report: TeamIntelligenceSerializedReport,
  orgName: string,
  personRoles: PersonRoleMap
): RenderModel => {
  const reportJson = getReportJson(report);
  const sourceSummary = getSourceSummary(report);
  const title =
    (typeof reportJson.title === 'string' && reportJson.title.trim()) ||
    'Team Intelligence Report';
  const overview =
    (typeof reportJson.overview === 'string' && reportJson.overview.trim()) ||
    'Data is limited for this time window. Use this report as a directional snapshot rather than a definitive team audit.';

  const rawPeople = Array.isArray(reportJson.perPersonActivity) ? reportJson.perPersonActivity : [];
  const peopleWithScores = rawPeople.map(person => ({
    userId: person.userId || '',
    name: person.name?.trim() || 'Unknown Team Member',
    role:
      titleCase(personRoles.get(person.userId || '') || 'Team Member'),
    initials: getInitials(person.name?.trim() || 'Unknown Team Member'),
    summary: person.summary?.trim() || 'No summary available.',
    themes: unique(asStringArray(person.themes)),
    workloadSignals: unique(asStringArray(person.workloadSignals)),
    activityScore: inferActivityScore(person),
  }));

  const totalActivity = peopleWithScores.reduce((sum, person) => sum + person.activityScore, 0);
  const people: NormalizedPersonCard[] = peopleWithScores.map(person => ({
    ...person,
    activityPercent:
      totalActivity > 0
        ? Math.max(8, Math.round((person.activityScore / totalActivity) * 100))
        : 100,
    signalLevel: getSignalLevel(person.activityScore),
  }));

  const overlaps: NormalizedOverlap[] = (Array.isArray(reportJson.overlaps) ? reportJson.overlaps : [])
    .map(overlap => ({
      people: [
        asStringArray(overlap.people)[0] || 'Unknown',
        asStringArray(overlap.people)[1] || 'Unknown',
      ] as [string, string],
      summary: overlap.summary?.trim() || 'Potential overlap detected.',
      evidence: unique(asStringArray(overlap.evidence)).slice(0, 3),
      riskLevel: riskLabel(overlap.riskLevel),
    }));

  const conflicts: NormalizedConflict[] = (
    Array.isArray(reportJson.conflicts) ? reportJson.conflicts : []
  ).map(conflict => ({
    summary: conflict.summary?.trim() || 'Potential risk detected.',
    evidence: unique(asStringArray(conflict.evidence)).slice(0, 3),
    severity: riskLabel(conflict.severity),
  }));

  const hotspots = unique(asStringArray(reportJson.teamDistribution?.hotspots));
  const gaps = unique(asStringArray(reportJson.teamDistribution?.gaps));
  const themeCloud = unique([
    ...people.flatMap(person => person.themes),
    ...hotspots,
    ...gaps,
  ]).slice(0, 24);

  return {
    title,
    orgName,
    orgId: report.orgId,
    generatedAt: formatDateTime(report.completedAt || report.updatedAt),
    timeRangeLabel: formatDateRange(report.timeRangeStart, report.timeRangeEnd),
    summaryBlurb: summarizeOverview(overview),
    overview,
    includeTranscripts: report.includeTranscripts,
    sourceSummary,
    people,
    distributionSummary:
      reportJson.teamDistribution?.summary?.trim() ||
      'Distribution signals are synthesized from recent activity and theme density.',
    hotspots,
    gaps,
    overlaps,
    conflicts,
    themeCloud,
    markdown: report.markdown,
  };
};

const renderThemeBadge = (theme: string): string => {
  return `<span class="badge badge-${getThemeTone(theme)}">${escapeHtml(theme)}</span>`;
};

const renderSignalPill = (level: 'low' | 'medium' | 'high'): string => {
  return `<span class="signal-pill signal-${level}">${escapeHtml(titleCase(level))} Activity</span>`;
};

const renderWorkloadSignals = (signals: string[]): string => {
  if (signals.length === 0) {
    return `<div class="empty-state small">No workload signals captured for this person in the selected window.</div>`;
  }

  return `
    <ul class="signal-list">
      ${signals
        .slice(0, 4)
        .map(signal => `<li><span class="signal-icon"></span><span>${escapeHtml(signal)}</span></li>`)
        .join('')}
    </ul>
  `;
};

const renderPersonCards = (people: NormalizedPersonCard[]): string => {
  if (people.length === 0) {
    return `<div class="placeholder-card">No per-person activity was available for this report window.</div>`;
  }

  return `
    <div class="people-grid">
      ${people
        .map(
          person => `
            <article class="person-card">
              <div class="person-card-header">
                <div class="avatar">${escapeHtml(person.initials)}</div>
                <div class="person-title-block">
                  <div class="person-name-row">
                    <h3>${escapeHtml(person.name)}</h3>
                    ${renderSignalPill(person.signalLevel)}
                  </div>
                  <p class="person-role">${escapeHtml(person.role)}</p>
                </div>
              </div>
              <p class="person-summary">${escapeHtml(person.summary)}</p>
              <div class="subsection-label">Themes</div>
              <div class="badge-grid">
                ${
                  person.themes.length > 0
                    ? person.themes.map(renderThemeBadge).join('')
                    : '<span class="empty-inline">No themes extracted</span>'
                }
              </div>
              <div class="subsection-label">Workload signals</div>
              ${renderWorkloadSignals(person.workloadSignals)}
            </article>
          `
        )
        .join('')}
    </div>
  `;
};

const renderDistributionChart = (model: RenderModel): string => {
  if (model.people.length <= 1) {
    const tiles = (model.themeCloud.length > 0 ? model.themeCloud : ['Focused execution', 'No additional topics'])
      .slice(0, 8)
      .map((topic, index) => {
        const opacity = (0.18 + index * 0.08).toFixed(2);
        return `
          <div class="heat-tile" style="background: rgba(79, 70, 229, ${opacity});">
            <span>${escapeHtml(topic)}</span>
          </div>
        `;
      })
      .join('');

    return `
      <div class="distribution-card">
        <div class="distribution-summary">${escapeHtml(model.distributionSummary)}</div>
        <div class="heatmap-caption">Single-member view: intensity reflects the concentration of detected themes and focus areas.</div>
        <div class="heatmap-grid">${tiles}</div>
      </div>
    `;
  }

  return `
    <div class="distribution-card">
      <div class="distribution-summary">${escapeHtml(model.distributionSummary)}</div>
      <div class="bar-chart">
        ${model.people
          .map(
            person => `
              <div class="bar-row">
                <div class="bar-meta">
                  <span class="bar-label">${escapeHtml(person.name)}</span>
                  <span class="bar-value">${person.activityPercent}%</span>
                </div>
                <div class="bar-track">
                  <div class="bar-fill bar-${person.signalLevel}" style="width:${person.activityPercent}%"></div>
                </div>
                <div class="bar-caption">${escapeHtml(titleCase(person.signalLevel))} signal</div>
              </div>
            `
          )
          .join('')}
      </div>
    </div>
  `;
};

const renderFocusLists = (title: string, values: string[], tone: 'warm' | 'cool'): string => {
  return `
    <div class="focus-card focus-${tone}">
      <div class="focus-title">${escapeHtml(title)}</div>
      ${
        values.length > 0
          ? `<div class="focus-pill-grid">${values
              .slice(0, 8)
              .map(value => `<span class="focus-pill">${escapeHtml(value)}</span>`)
              .join('')}</div>`
          : `<div class="empty-state small">Not available in this report.</div>`
      }
    </div>
  `;
};

const renderOverlaps = (overlaps: NormalizedOverlap[]): string => {
  if (overlaps.length === 0) {
    return `<div class="status-banner status-success">No overlaps detected. The current dataset does not show meaningful redundancy or conflicts between team tracks.</div>`;
  }

  return `
    <div class="connection-grid">
      ${overlaps
        .map(
          overlap => `
            <div class="connection-card risk-${overlap.riskLevel}">
              <div class="connection-bridge">
                <span class="person-pill">${escapeHtml(overlap.people[0])}</span>
                <span class="bridge-pill">${escapeHtml(overlap.summary)}</span>
                <span class="person-pill">${escapeHtml(overlap.people[1])}</span>
              </div>
              <div class="connection-evidence">
                ${
                  overlap.evidence.length > 0
                    ? overlap.evidence
                        .map(item => `<span class="evidence-pill">${escapeHtml(item)}</span>`)
                        .join('')
                    : '<span class="empty-inline">No supporting evidence snippets were included.</span>'
                }
              </div>
            </div>
          `
        )
        .join('')}
    </div>
  `;
};

const renderConflicts = (conflicts: NormalizedConflict[]): string => {
  if (conflicts.length === 0) {
    return `<div class="status-banner status-success">No conflict or redundancy flags were raised for this report window.</div>`;
  }

  return `
    <div class="conflict-list">
      ${conflicts
        .map(
          conflict => `
            <div class="conflict-card severity-${conflict.severity}">
              <div class="conflict-header">
                <span class="severity-chip severity-${conflict.severity}">${escapeHtml(titleCase(conflict.severity))}</span>
                <h4>${escapeHtml(conflict.summary)}</h4>
              </div>
              ${
                conflict.evidence.length > 0
                  ? `<ul class="evidence-list">${conflict.evidence
                      .map(item => `<li>${escapeHtml(item)}</li>`)
                      .join('')}</ul>`
                  : '<div class="empty-state small">No explicit evidence attached.</div>'
              }
            </div>
          `
        )
        .join('')}
    </div>
  `;
};

const renderThemeCloud = (themes: string[]): string => {
  if (themes.length === 0) {
    return `<div class="placeholder-card">No reusable themes were extracted for the selected scope.</div>`;
  }

  return `
    <div class="theme-cloud">
      ${themes.map(renderThemeBadge).join('')}
    </div>
  `;
};

const buildFooterTemplate = (title: string, generatedAt: string): string => `
  <div style="width:100%; font-size:9px; color:#6b7280; padding:0 16px 8px; box-sizing:border-box; font-family:Arial, sans-serif;">
    <div style="border-top:1px solid #e5e7eb; padding-top:6px; display:flex; justify-content:space-between; align-items:center; width:100%;">
      <span>${escapeHtml(title)}</span>
      <span>Generated ${escapeHtml(generatedAt)}</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>
  </div>
`;

const buildReportHtml = (model: RenderModel): string => {
  const coverStats = [
    { label: 'Org ID', value: model.orgId },
    { label: 'Generated', value: model.generatedAt },
    { label: 'Time Range', value: model.timeRangeLabel },
    {
      label: 'Sources',
      value: model.includeTranscripts ? 'Email + Transcripts' : 'Email only',
    },
    {
      label: 'Members',
      value: String(model.sourceSummary.totalMembers ?? model.people.length),
    },
    {
      label: 'Emails',
      value: String(model.sourceSummary.totalEmails ?? 0),
    },
    {
      label: 'Transcripts',
      value: String(model.sourceSummary.totalTranscripts ?? 0),
    },
    {
      label: 'Per-user limit',
      value: String(model.sourceSummary.perUserLimit ?? '-'),
    },
  ];

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(model.title)}</title>
        <style>
          @page {
            size: A4;
            margin: 14mm 12mm 22mm 12mm;
          }

          :root {
            --primary: #4f46e5;
            --primary-soft: #eef2ff;
            --primary-deep: #312e81;
            --success: #059669;
            --success-soft: #ecfdf5;
            --warning: #d97706;
            --warning-soft: #fffbeb;
            --danger: #e11d48;
            --danger-soft: #fff1f2;
            --card: #f9fafb;
            --border: #e5e7eb;
            --text: #111827;
            --muted: #6b7280;
            --slate-soft: #f8fafc;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            color: var(--text);
            font-family: Inter, "Segoe UI", Arial, sans-serif;
            background: #ffffff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .page-root {
            width: 100%;
          }

          .cover-page {
            min-height: 250mm;
            page-break-after: always;
            display: flex;
            flex-direction: column;
            gap: 20px;
          }

          .hero {
            position: relative;
            overflow: hidden;
            border-radius: 28px;
            padding: 30px;
            border: 1px solid #c7d2fe;
            background:
              radial-gradient(circle at top right, rgba(14, 165, 233, 0.18), transparent 38%),
              linear-gradient(135deg, #eef2ff 0%, #ffffff 56%, #eff6ff 100%);
          }

          .hero::before {
            content: "";
            position: absolute;
            right: -70px;
            top: -70px;
            width: 180px;
            height: 180px;
            border-radius: 50%;
            background: rgba(79, 70, 229, 0.08);
          }

          .hero-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 16px;
            margin-bottom: 22px;
          }

          .eyebrow {
            display: inline-block;
            margin-bottom: 10px;
            padding: 6px 12px;
            border-radius: 999px;
            background: rgba(79, 70, 229, 0.12);
            color: var(--primary-deep);
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            font-weight: 700;
          }

          .cover-title {
            font-size: 34px;
            line-height: 1.06;
            font-weight: 800;
            margin: 0;
            max-width: 430px;
          }

          .cover-subtitle {
            margin: 10px 0 0;
            color: var(--muted);
            font-size: 14px;
            max-width: 420px;
          }

          .logo-chip {
            min-width: 70px;
            height: 70px;
            border-radius: 20px;
            background: linear-gradient(135deg, #312e81 0%, #4f46e5 100%);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            font-weight: 800;
            box-shadow: 0 18px 36px rgba(49, 46, 129, 0.22);
          }

          .summary-callout {
            border-radius: 22px;
            padding: 20px 22px;
            background: rgba(255, 255, 255, 0.72);
            border: 1px solid rgba(79, 70, 229, 0.14);
            box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
          }

          .summary-callout-label {
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--primary);
            font-weight: 700;
            margin-bottom: 8px;
          }

          .summary-callout p {
            margin: 0;
            font-size: 15px;
            line-height: 1.6;
          }

          .metadata-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
          }

          .meta-card {
            border-radius: 18px;
            padding: 14px 14px 12px;
            background: #ffffff;
            border: 1px solid var(--border);
          }

          .meta-card-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--muted);
            margin-bottom: 8px;
            font-weight: 700;
          }

          .meta-card-value {
            font-size: 13px;
            line-height: 1.45;
            font-weight: 600;
          }

          .section {
            margin-top: 22px;
            page-break-inside: avoid;
          }

          .section-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 14px;
          }

          .section-header::before {
            content: "";
            width: 6px;
            height: 30px;
            border-radius: 999px;
            background: linear-gradient(180deg, #4f46e5 0%, #22c55e 100%);
          }

          .section-header h2 {
            margin: 0;
            font-size: 21px;
            line-height: 1.2;
          }

          .section-subtitle {
            color: var(--muted);
            font-size: 13px;
            margin: 4px 0 0;
          }

          .overview-card,
          .distribution-card,
          .placeholder-card,
          .status-banner {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 18px 20px;
          }

          .overview-grid {
            display: grid;
            grid-template-columns: 1.7fr 1fr;
            gap: 16px;
          }

          .overview-copy {
            font-size: 14px;
            line-height: 1.72;
            color: #1f2937;
          }

          .overview-insights {
            display: grid;
            gap: 12px;
          }

          .insight-card {
            background: #ffffff;
            border: 1px solid var(--border);
            border-radius: 18px;
            padding: 14px;
          }

          .insight-card-title {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--muted);
            font-weight: 700;
            margin-bottom: 6px;
          }

          .insight-card-copy {
            font-size: 13px;
            line-height: 1.55;
          }

          .people-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
          }

          .person-card {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 18px;
            box-shadow: 0 12px 28px rgba(15, 23, 42, 0.04);
          }

          .person-card-header {
            display: flex;
            gap: 14px;
            align-items: flex-start;
            margin-bottom: 12px;
          }

          .avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, #312e81 0%, #4f46e5 100%);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            font-size: 18px;
            flex-shrink: 0;
          }

          .person-title-block {
            flex: 1;
            min-width: 0;
          }

          .person-name-row {
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
          }

          .person-name-row h3 {
            margin: 0;
            font-size: 18px;
            line-height: 1.2;
          }

          .person-role {
            margin: 6px 0 0;
            color: var(--muted);
            font-size: 12px;
          }

          .signal-pill {
            border-radius: 999px;
            padding: 5px 10px;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }

          .signal-high { background: #dcfce7; color: #166534; }
          .signal-medium { background: #fef3c7; color: #92400e; }
          .signal-low { background: #e5e7eb; color: #374151; }

          .person-summary {
            margin: 0 0 14px;
            font-size: 13px;
            line-height: 1.65;
          }

          .subsection-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--muted);
            font-weight: 700;
            margin-bottom: 8px;
          }

          .badge-grid,
          .theme-cloud,
          .focus-pill-grid,
          .connection-evidence {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }

          .badge,
          .focus-pill,
          .evidence-pill,
          .person-pill,
          .bridge-pill,
          .severity-chip {
            display: inline-flex;
            align-items: center;
            border-radius: 999px;
            padding: 7px 11px;
            font-size: 11px;
            font-weight: 700;
            line-height: 1;
          }

          .badge-infra { background: #dbeafe; color: #1d4ed8; }
          .badge-product { background: #ede9fe; color: #6d28d9; }
          .badge-compliance { background: #ffedd5; color: #c2410c; }
          .badge-operations { background: #dcfce7; color: #15803d; }
          .badge-neutral { background: #e5e7eb; color: #374151; }

          .signal-list {
            margin: 0;
            padding: 0;
            list-style: none;
            display: grid;
            gap: 8px;
          }

          .signal-list li {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            font-size: 12px;
            color: #1f2937;
          }

          .signal-icon {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: var(--primary);
            margin-top: 5px;
            flex-shrink: 0;
          }

          .empty-inline {
            color: var(--muted);
            font-size: 12px;
          }

          .empty-state.small {
            font-size: 12px;
            line-height: 1.5;
            color: var(--muted);
          }

          .distribution-grid {
            display: grid;
            grid-template-columns: 1.5fr 1fr 1fr;
            gap: 14px;
            align-items: start;
          }

          .distribution-summary {
            font-size: 13px;
            line-height: 1.65;
            margin-bottom: 14px;
          }

          .bar-chart {
            display: grid;
            gap: 12px;
          }

          .bar-row {
            display: grid;
            gap: 6px;
          }

          .bar-meta,
          .bar-caption {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: var(--muted);
          }

          .bar-label {
            color: var(--text);
            font-weight: 700;
          }

          .bar-track {
            width: 100%;
            height: 14px;
            border-radius: 999px;
            background: #e5e7eb;
            overflow: hidden;
          }

          .bar-fill {
            height: 100%;
            border-radius: 999px;
          }

          .bar-high { background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%); }
          .bar-medium { background: linear-gradient(90deg, #f59e0b 0%, #f97316 100%); }
          .bar-low { background: linear-gradient(90deg, #94a3b8 0%, #64748b 100%); }

          .heatmap-caption {
            font-size: 12px;
            color: var(--muted);
            margin-bottom: 10px;
          }

          .heatmap-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .heat-tile {
            min-height: 72px;
            border-radius: 18px;
            color: #ffffff;
            padding: 12px;
            display: flex;
            align-items: flex-end;
            font-size: 12px;
            font-weight: 700;
          }

          .focus-card {
            border-radius: 20px;
            padding: 16px;
            border: 1px solid var(--border);
            min-height: 160px;
          }

          .focus-warm { background: var(--warning-soft); }
          .focus-cool { background: #eff6ff; }

          .focus-title {
            font-size: 12px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-bottom: 10px;
          }

          .focus-pill {
            background: #ffffff;
            color: #1f2937;
            border: 1px solid rgba(17, 24, 39, 0.08);
          }

          .connection-grid,
          .conflict-list {
            display: grid;
            gap: 14px;
          }

          .connection-card,
          .conflict-card {
            background: #ffffff;
            border-radius: 24px;
            padding: 18px;
            border: 1px solid var(--border);
          }

          .connection-card.risk-low { background: #fffbeb; }
          .connection-card.risk-medium { background: #fff7ed; }
          .connection-card.risk-high { background: #fff1f2; border-color: #fecdd3; }

          .connection-bridge {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            gap: 10px;
            align-items: center;
            margin-bottom: 12px;
          }

          .person-pill {
            justify-content: center;
            background: #eef2ff;
            color: #312e81;
          }

          .bridge-pill {
            justify-content: center;
            background: rgba(17, 24, 39, 0.08);
            color: #111827;
            max-width: 260px;
            text-align: center;
            line-height: 1.3;
          }

          .status-banner {
            font-size: 13px;
            line-height: 1.6;
          }

          .status-success {
            background: var(--success-soft);
            border-color: #a7f3d0;
            color: #166534;
          }

          .conflict-card.severity-low { background: #fffaf0; }
          .conflict-card.severity-medium { background: #fff7ed; }
          .conflict-card.severity-high { background: #fff1f2; border-color: #fecdd3; }

          .conflict-header {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 10px;
          }

          .conflict-header h4 {
            margin: 0;
            font-size: 14px;
            line-height: 1.5;
          }

          .severity-low { background: #fef3c7; color: #92400e; }
          .severity-medium { background: #fed7aa; color: #c2410c; }
          .severity-high { background: #fecdd3; color: #be123c; }

          .evidence-list {
            margin: 0;
            padding-left: 18px;
            color: #374151;
            font-size: 12px;
            line-height: 1.6;
          }

          .theme-cloud {
            gap: 10px;
          }

          .placeholder-card {
            color: var(--muted);
            font-size: 13px;
            line-height: 1.6;
          }

          .markdown-fallback {
            margin-top: 10px;
            font-size: 12px;
            line-height: 1.7;
            color: #374151;
            white-space: pre-wrap;
            background: #ffffff;
            border-radius: 18px;
            padding: 14px;
            border: 1px solid var(--border);
          }
        </style>
      </head>
      <body>
        <main class="page-root">
          <section class="cover-page">
            <div class="hero">
              <div class="hero-top">
                <div>
                  <span class="eyebrow">Manager Intelligence Brief</span>
                  <h1 class="cover-title">${escapeHtml(model.orgName)}</h1>
                  <p class="cover-subtitle">${escapeHtml(model.title)}</p>
                </div>
                <div class="logo-chip">XS</div>
              </div>

              <div class="summary-callout">
                <div class="summary-callout-label">Report Summary</div>
                <p>${escapeHtml(model.summaryBlurb)}</p>
              </div>
            </div>

            <div class="metadata-grid">
              ${coverStats
                .map(
                  stat => `
                    <div class="meta-card">
                      <div class="meta-card-label">${escapeHtml(stat.label)}</div>
                      <div class="meta-card-value">${escapeHtml(stat.value)}</div>
                    </div>
                  `
                )
                .join('')}
            </div>
          </section>

          <section class="section">
            <div class="section-header">
              <div>
                <h2>Overview</h2>
                <p class="section-subtitle">Executive framing of the team’s current focus and momentum.</p>
              </div>
            </div>
            <div class="overview-card overview-grid">
              <div class="overview-copy">${escapeHtml(model.overview)}</div>
              <div class="overview-insights">
                <div class="insight-card">
                  <div class="insight-card-title">Coverage</div>
                  <div class="insight-card-copy">${escapeHtml(
                    `${model.sourceSummary.totalMembers ?? model.people.length} members, ${model.sourceSummary.totalEmails ?? 0} emails, ${model.sourceSummary.totalTranscripts ?? 0} transcripts.`
                  )}</div>
                </div>
                <div class="insight-card">
                  <div class="insight-card-title">Hotspots</div>
                  <div class="insight-card-copy">${escapeHtml(
                    model.hotspots.length > 0 ? model.hotspots.slice(0, 3).join(', ') : 'No major hotspots surfaced.'
                  )}</div>
                </div>
                <div class="insight-card">
                  <div class="insight-card-title">Potential Risks</div>
                  <div class="insight-card-copy">${escapeHtml(
                    model.conflicts.length > 0 ? `${model.conflicts.length} conflict signal(s) detected.` : 'No explicit conflict signals in this window.'
                  )}</div>
                </div>
              </div>
            </div>
          </section>

          <section class="section">
            <div class="section-header">
              <div>
                <h2>Per Person Activity</h2>
                <p class="section-subtitle">Card-based summary of current focus areas, themes, and workload signals.</p>
              </div>
            </div>
            ${renderPersonCards(model.people)}
          </section>

          <section class="section">
            <div class="section-header">
              <div>
                <h2>Team Distribution</h2>
                <p class="section-subtitle">Relative workload signal across the scoped team, with hotspots and gaps called out separately.</p>
              </div>
            </div>
            <div class="distribution-grid">
              ${renderDistributionChart(model)}
              ${renderFocusLists('Hotspots', model.hotspots, 'warm')}
              ${renderFocusLists('Gaps', model.gaps, 'cool')}
            </div>
          </section>

          <section class="section">
            <div class="section-header">
              <div>
                <h2>Overlaps & Similar Tracks</h2>
                <p class="section-subtitle">Connections between people whose work appears semantically adjacent or potentially redundant.</p>
              </div>
            </div>
            ${renderOverlaps(model.overlaps)}
          </section>

          <section class="section">
            <div class="section-header">
              <div>
                <h2>Conflicts & Redundancy Signals</h2>
                <p class="section-subtitle">Conservative flags where the evidence suggests risk, duplication, or coordination friction.</p>
              </div>
            </div>
            ${renderConflicts(model.conflicts)}
          </section>

          <section class="section">
            <div class="section-header">
              <div>
                <h2>Themes & Tags</h2>
                <p class="section-subtitle">Reusable theme cloud across the report, color-coded heuristically for faster scanning.</p>
              </div>
            </div>
            ${renderThemeCloud(model.themeCloud)}
          </section>

          ${
            model.markdown
              ? `
                <section class="section">
                  <div class="section-header">
                    <div>
                      <h2>Appendix</h2>
                      <p class="section-subtitle">Plain-text fallback of the generated report for raw reference.</p>
                    </div>
                  </div>
                  <div class="markdown-fallback">${escapeHtml(model.markdown)}</div>
                </section>
              `
              : ''
          }
        </main>
      </body>
    </html>
  `;
};

const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const normalized = normalizeLine(text);
  if (!normalized) {
    return [''];
  }

  const words = normalized.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    const nextWidth = font.widthOfTextAtSize(nextLine, size);

    if (nextWidth <= maxWidth || !currentLine) {
      currentLine = nextLine;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
};

const buildFallbackReportLines = (report: TeamIntelligenceSerializedReport): {
  title: string;
  sections: Array<{ heading: string; lines: string[] }>;
} => {
  const reportJson = getReportJson(report);
  const title =
    (typeof reportJson.title === 'string' && reportJson.title.trim()) ||
    'Team Intelligence Report';

  const sections: Array<{ heading: string; lines: string[] }> = [
    {
      heading: 'Report Info',
      lines: [
        `Org ID: ${report.orgId}`,
        `Generated: ${report.completedAt || report.updatedAt}`,
        `Time Range: ${report.timeRangeStart} to ${report.timeRangeEnd}`,
        `Include Transcripts: ${report.includeTranscripts ? 'Yes' : 'No'}`,
      ],
    },
  ];

  if (typeof reportJson.overview === 'string' && reportJson.overview.trim()) {
    sections.push({
      heading: 'Overview',
      lines: [reportJson.overview.trim()],
    });
  }

  const perPersonActivity = Array.isArray(reportJson.perPersonActivity)
    ? reportJson.perPersonActivity
    : [];
  if (perPersonActivity.length > 0) {
    sections.push({
      heading: 'Per Person Activity',
      lines: perPersonActivity.flatMap(person => {
        const themes = asStringArray(person.themes);
        const workloadSignals = asStringArray(person.workloadSignals);
        return [
          `${person.name || 'Unknown'}: ${person.summary || 'No summary available.'}`,
          ...(themes.length > 0 ? [`Themes: ${themes.join(', ')}`] : []),
          ...(workloadSignals.length > 0
            ? [`Workload Signals: ${workloadSignals.join(', ')}`]
            : []),
          '',
        ];
      }),
    });
  }

  if (isObject(reportJson.teamDistribution)) {
    sections.push({
      heading: 'Team Distribution',
      lines: [
        reportJson.teamDistribution.summary || 'No team distribution summary available.',
        ...(
          asStringArray(reportJson.teamDistribution.hotspots).length > 0
            ? [`Hotspots: ${asStringArray(reportJson.teamDistribution.hotspots).join(', ')}`]
            : []
        ),
        ...(
          asStringArray(reportJson.teamDistribution.gaps).length > 0
            ? [`Gaps: ${asStringArray(reportJson.teamDistribution.gaps).join(', ')}`]
            : []
        ),
      ],
    });
  }

  if (report.markdown) {
    sections.push({
      heading: 'Report',
      lines: report.markdown
        .split('\n')
        .map(line => normalizeLine(line.replace(/^#+\s*/, '')))
        .filter(Boolean),
    });
  }

  return { title, sections };
};

const createPage = (pdfDoc: PDFDocument): PDFPage => pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

const renderFallbackPdfBuffer = async (report: TeamIntelligenceSerializedReport): Promise<Buffer> => {
  const pdfDoc = await PDFDocument.create();
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const { title, sections } = buildFallbackReportLines(report);

  let page = createPage(pdfDoc);
  let cursorY = PAGE_HEIGHT - PAGE_MARGIN;

  const ensureSpace = (requiredHeight: number): void => {
    if (cursorY - requiredHeight >= PAGE_MARGIN) {
      return;
    }

    page = createPage(pdfDoc);
    cursorY = PAGE_HEIGHT - PAGE_MARGIN;
  };

  const drawWrappedBlock = (
    text: string,
    font: PDFFont,
    fontSize: number,
    color: ReturnType<typeof rgb>
  ): void => {
    const lines = wrapText(text, font, fontSize, PAGE_WIDTH - PAGE_MARGIN * 2);
    ensureSpace(lines.length * LINE_HEIGHT);
    for (const line of lines) {
      page.drawText(line, {
        x: PAGE_MARGIN,
        y: cursorY,
        size: fontSize,
        font,
        color,
      });
      cursorY -= LINE_HEIGHT;
    }
  };

  drawWrappedBlock(title, boldFont, HEADING_FONT_SIZE, rgb(0.1, 0.1, 0.1));
  cursorY -= 8;

  for (const section of sections) {
    ensureSpace(SECTION_SPACING + LINE_HEIGHT * 2);
    drawWrappedBlock(section.heading, boldFont, SECTION_FONT_SIZE, rgb(0.16, 0.28, 0.53));
    cursorY -= 4;
    for (const line of section.lines) {
      if (!line.trim()) {
        cursorY -= 6;
        continue;
      }
      drawWrappedBlock(line, bodyFont, BODY_FONT_SIZE, rgb(0.15, 0.15, 0.15));
    }
    cursorY -= SECTION_SPACING;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
};

const loadPersonRoles = async (
  orgId: string,
  userIds: string[]
): Promise<PersonRoleMap> => {
  if (userIds.length === 0) {
    return new Map();
  }

  const memberships = await db.orgMember.findMany({
    where: {
      orgId,
      userId: { in: userIds },
    },
    select: {
      userId: true,
      role: true,
    },
  });

  return new Map(
    memberships.map(membership => [membership.userId, membership.role])
  );
};

const loadOrgName = async (orgId: string): Promise<string> => {
  const organization = await db.organization.findUnique({
    where: { orgId },
    select: { name: true },
  });

  return organization?.name || 'Organization';
};

const renderWithPlaywright = async (html: string, title: string, generatedAt: string): Promise<Buffer> => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'screen' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildFooterTemplate(title, generatedAt),
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '18mm',
        left: '10mm',
      },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
};

export class TeamIntelligenceReportPdfService {
  async generatePdfBuffer(report: TeamIntelligenceSerializedReport): Promise<Buffer> {
    const orgName = await loadOrgName(report.orgId);
    const personRoles = await loadPersonRoles(report.orgId, report.teamMemberIds);
    const model = buildRenderModel(report, orgName, personRoles);

    try {
      const html = buildReportHtml(model);
      return await renderWithPlaywright(html, model.title, model.generatedAt);
    } catch (error) {
      pdfLogger.warn('[TEAM_INTELLIGENCE] Playwright PDF rendering failed, falling back to pdf-lib', {
        reportId: report.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return renderFallbackPdfBuffer(report);
    }
  }
}

export const teamIntelligenceReportPdfService = new TeamIntelligenceReportPdfService();
