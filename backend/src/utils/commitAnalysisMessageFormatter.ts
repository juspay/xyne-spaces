import { CommitAnalysisResult } from '@/services/commitAnalysisService';
import { config } from '@/config/env';
import { logger } from './logger';

export function formatCommitAnalysisMessage(
  results: CommitAnalysisResult[],
  workspace?: string,
  repoSlug?: string,
  maxLength: number = 9500,
  conversationId?: string,
  channelId?: string,
  affectedApplications?: Array<{
    id: string;
    name: string;
    subTicketId?: string;
    subTicketXyneId?: string;
    mappedTicketId?: string;
  }>,
  ticketContext?: {
    isSubTicket?: boolean;
    ticketId?: string;
    xyneId?: string;
    conversationId?: string;
    messageId?: string;
    parentTicketId?: string;
    parentXyneId?: string;
    parentConversationId?: string;
    parentMessageId?: string;
  },
  envChanges?: Array<{
    filePath: string;
    fileName: string;
    newValue: string;
  }>,
  migrationLinks?: Array<{
    filePath: string;
    diffUrl: string;
  }>,
): string {
  if (results.length === 0) {
    return 'No commits analyzed.';
  }

  const totalCommits = results.length;
  const commitsWithPR = results.filter((r) => r.pullRequest !== null).length;
  const commitsWithTicket = results.filter((r) => r.ticket !== null).length;
  // const _commitsWithError = results.filter((r) => r.error !== null).length;

  // Build message using basic HTML tags that the renderer supports
  let text = '';

  // Header section with ticket context
  text += `<p class="m-0 leading-6"><strong class="font-semibold">📦 Release Analysis Report</strong></p>`;

  // Add ticket context header
  if (ticketContext?.isSubTicket && channelId && ticketContext.parentTicketId && ticketContext.parentXyneId) {
    // Posted in sub-ticket thread - show link to parent ticket
    const parentTicketUrl = `${config.slackFrontendUrl}/chat/${channelId}?tab=tickets&ticketId=${ticketContext.parentTicketId}`;
    text += `<p class="m-0 leading-6"><em class="text-gray-600">Main Ticket: <a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${parentTicketUrl}">${ticketContext.parentXyneId}</a>`;
    if (ticketContext.parentConversationId && ticketContext.parentMessageId) {
      const parentConvUrl = `${config.slackFrontendUrl}/chat/${channelId}/${ticketContext.parentConversationId}/${ticketContext.parentMessageId}?selectedTab=thread`;
      text += ` - <a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${parentConvUrl}">View Thread →</a>`;
    }
    text += `</em></p>`;
  } else if (ticketContext?.ticketId && ticketContext.xyneId && channelId && !ticketContext.isSubTicket) {
    // Posted in parent ticket thread (coming from sub-ticket) - show link to sub-ticket
    const subTicketUrl = `${config.slackFrontendUrl}/chat/${channelId}?tab=tickets&ticketId=${ticketContext.ticketId}`;
    text += `<p class="m-0 leading-6"><em class="text-gray-600">Sub-Ticket: <a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${subTicketUrl}">${ticketContext.xyneId}</a>`;
    if (ticketContext.conversationId && ticketContext.messageId) {
      const subConvUrl = `${config.slackFrontendUrl}/chat/${channelId}/${ticketContext.conversationId}/${ticketContext.messageId}?selectedTab=thread`;
      text += ` - <a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${subConvUrl}">View Thread →</a>`;
    }
    text += `</em></p>`;
  }

  if (workspace && repoSlug) {
    text += `<p class="m-0 leading-6"><em class="text-gray-600">${workspace}/${repoSlug}</em></p>`;
  }

  // Check if there are any env or migration changes
  const hasEnvChanges = envChanges && envChanges.length > 0;
  const hasMigrationChanges = migrationLinks && migrationLinks.length > 0;

  text += `<p class="m-0 leading-6"><em class="text-gray-600">${totalCommits} commits analyzed • ${commitsWithPR} with PRs • ${commitsWithTicket} with tickets`;

  text += `</em></p>`;
  // Services to be deployed section
  if (affectedApplications && affectedApplications.length > 0) {
    text += `<p class="m-0 leading-6"><strong class="font-semibold">Services to be deployed:</strong></p>`;
    text += `<blockquote class="border-l-4 border-gray-400 pl-4 text-gray-700">`;
    for (const app of affectedApplications) {
      text += `<p class="m-0 leading-6"><strong class="font-semibold">${app.name}</strong>`;
      if (app.mappedTicketId && channelId) {
        const subTicketUrl = `${config.slackFrontendUrl}/chat/${channelId}?tab=tickets&ticketId=${app.mappedTicketId}&conversationId=${conversationId || ''}`;
        text += ` - <a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${subTicketUrl}">Ticket →</a>`;
      }
      text += `</p>`;
    }
    text += `</blockquote>`;
    text += `<p class="m-0 leading-6"><br/></p>`;
  }


  // Add boolean flags for env and migration changes
  text += `<p class="m-0 leading-6"><strong class="font-semibold">Migration Change: ${hasMigrationChanges ? 'Yes' : 'No'}</strong></p>`;
  text += `<p class="m-0 leading-6"><strong class="font-semibold">Env Change: ${hasEnvChanges ? 'Yes' : 'No'}</strong></p>`;
  text += `<p class="m-0 leading-6"><br/></p>`;

  // PRs and Tickets section
  text += `<p class="m-0 leading-6"><strong class="font-semibold">Pull Requests & Tickets:</strong></p>`;

  // Create maps for env and migration changes by filePath
  const envChangesByPath = new Map<string, { fileName: string; newValue: string }>();
  if (envChanges) {
    for (const change of envChanges) {
      if (change.filePath && change.fileName && change.newValue) {
        envChangesByPath.set(change.filePath, { fileName: change.fileName, newValue: change.newValue });
      }
    }
  }

  const migrationLinksByPath = new Map<string, { diffUrl: string }>();
  if (migrationLinks) {
    for (const link of migrationLinks) {
      migrationLinksByPath.set(link.filePath, { diffUrl: link.diffUrl });
    }
  }

  // Group results by PR (unique PRs only)
  const uniquePRs = new Map<number, CommitAnalysisResult>();
  for (const result of results) {
    if (result.pullRequest) {
      if (!uniquePRs.has(result.pullRequest.id)) {
        uniquePRs.set(result.pullRequest.id, result);
      }
    }
  }

  for (const [prId, result] of uniquePRs) {
    const pr = result.pullRequest!;
    text += `<p class="m-0 leading-6"><strong class="font-semibold">PR <a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${pr.url}">#${prId}</a>:</strong> ${pr.title}</p>`;

    // Show ticket if linked
    if (result.ticket) {
      const ticket = result.ticket;
      if (channelId) {
        const ticketUrl = `${config.slackFrontendUrl}/chat/${channelId}?tab=tickets&ticketId=${ticket.id}&conversationId=${conversationId || ''}`;
        text += `<p class="m-0 leading-6"><strong class="font-semibold">Ticket <a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${ticketUrl}">${ticket.xyneId}</a>:</strong> ${ticket.title} (${ticket.status})</p>`;
      } else {
        text += `<p class="m-0 leading-6"><strong class="font-semibold">Ticket ${ticket.xyneId}:</strong> ${ticket.title} (${ticket.status})</p>`;
      }
    }

    // Display env changes for this PR
    const prEnvChanges = result.filePaths.filter(fp => envChangesByPath.has(fp));
    if (prEnvChanges.length > 0) {
      // Parse env variables from diffs
      const envVarStatusMap = new Map<string, { added: boolean; removed: boolean }>();
      // Match env vars with = or : assignment (e.g., KEY=value or KEY: value)
      const envVarRegex = /^([+-])\s*([A-Z][A-Z0-9_]+)(?:\s*=|\s*:)/gm;

      prEnvChanges.forEach((filePath) => {
        const change = envChangesByPath.get(filePath);
        if (change?.newValue) {
          let match;
          envVarRegex.lastIndex = 0;

          while ((match = envVarRegex.exec(change.newValue)) !== null) {
            const sign = match[1];
            const varName = match[2];

            if (!envVarStatusMap.has(varName)) {
              envVarStatusMap.set(varName, { added: false, removed: false });
            }

            const status = envVarStatusMap.get(varName)!;
            if (sign === '+') status.added = true;
            if (sign === '-') status.removed = true;
          }
        }
      });

      const envVarList = Array.from(envVarStatusMap.entries())
        .map(([name, flags]) => {
          let status = 'MODIFIED';
          if (flags.added && !flags.removed) status = 'ADDED';
          else if (!flags.added && flags.removed) status = 'DELETED';
          return { name, status };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      if (envVarList.length > 0) {
        text += `<p class="m-0 leading-6"><strong class="font-semibold">Env Changes:</strong></p>`;
        text += `<ul class="list-decimal pl-6 my-2">`;
        text += envVarList.map((item) => {
          let badgeClass = 'bg-gray-100 text-gray-800';
          let label = 'MODIFIED';

          if (item.status === 'ADDED') {
            badgeClass = 'bg-green-100 text-green-800';
            label = 'ADDED';
          } else if (item.status === 'DELETED') {
            badgeClass = 'bg-red-100 text-red-800';
            label = 'DELETED';
          } else {
            badgeClass = 'bg-yellow-100 text-yellow-800';
          }

          return `<li class="my-1"><p class="m-0 leading-6"><code class="bg-blue-50 rounded px-1 py-0.5 text-blue-800 font-mono text-[0.85em]">${item.name}</code> <span class="${badgeClass} inline-block px-2 py-0.5 rounded text-xs font-bold ml-2">${label}</span></p></li>`;
        }).join('');
        text += `</ul>`;
      }
    }

    // Display migration changes for this PR
    const prMigrationChanges = result.filePaths.filter(fp => migrationLinksByPath.has(fp));
    if (prMigrationChanges.length > 0) {
      text += `<p class="m-0 leading-6"><strong class="font-semibold">Migration Changes:</strong></p>`;
      text += `<ul class="list-decimal pl-6 my-2">`;
      for (const filePath of prMigrationChanges) {
        const fileName = filePath.split('/').pop() || filePath;
        const link = migrationLinksByPath.get(filePath);
        if (link) {
          text += `<li class="my-1"><p class="m-0 leading-6"><a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${link.diffUrl}">${fileName}</a></p></li>`;
        }
      }
      text += `</ul>`;
    }

    text += `<p class="m-0 leading-6"><em class="text-gray-600">Owner: ${pr.author.displayName}</em></p>`;

    text += `<p class="m-0 leading-6"><br/></p>`;

    // Check length limit
    if (text.length > maxLength - 500) {
      break;
    }
  }

  // Close container (no div needed for markdown)
  // Final safety check
  if (text.length > maxLength) {
    logger.warn('Commit analysis message truncated due to length limits', { originalLength: text.length, maxLength });
    text = text.substring(0, maxLength - 50);
  }

  return text;
}

