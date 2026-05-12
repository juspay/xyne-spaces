import { createVespaService, type VespaDependencies } from 'vespa/src';
import { logger } from '@/utils/logger';
import { Request, Response } from 'express';
import config from 'vespa/src/config';
import { transformVespaResults } from './resultTransform';
import { db } from '@/database/client';
import { VALID_DOC_TYPES } from '@/utils/idValidator';
import { MatchFeatures, RankProfile, VespaDocType, VespaSearchHit } from '@/vespa/src/types';


// Create dependencies
const dependencies: VespaDependencies = {
  logger: logger,
  config: config
};

// Create vespa service instance
const vespaService = createVespaService(dependencies);

/**
 * Parse Vespa grouped results structure
 * Returns either grouped results or flat results depending on response structure
 */
function parseVespaResults(children: any[]): { grouped: boolean; groups?: any[]; hits?: any[]; cntRemoved?: Number } {
  if (!children || children.length === 0) {
    return { grouped: false, hits: [] };
  }

  // Check if this is a grouped response
  const hasGrouping = children.some(child => 
    child.id && (child.id.startsWith('group:') || child.id.startsWith('grouplist:'))
  );

  if (!hasGrouping) {
    // Regular flat results
    return { grouped: false, hits: children };
  }

  // Parse grouped structure
  const groups: any[] = [];
  let removedCount = 0
  function extractGroups(items: any[], groupByField?: string, groupValue?: string) {
    for (const item of items) {
      if (item.id && item.id.startsWith('grouplist:')) {
        // This is a group list container
        const field = item.label || item.id.replace('grouplist:', '');
        if (item.children) {
          extractGroups(item.children, field);
        }
      } else if (item.id && item.id.startsWith('group:')) {
        // This is a specific group value
        const value = item.value || item.id.split(':').pop();
        if (item.children) {
          extractGroups(item.children, groupByField, value);
        }
      } else if (item.fields) {
        // This is an actual hit - add to current group
        if (groupByField && groupValue) {
          let group = groups.find(g => g.groupBy === groupByField && g.groupValue === groupValue);
          if (!group) {
            group = {
              groupBy: groupByField,
              groupValue: groupValue,
              hits: []
            };
            groups.push(group);
          }
          group.hits.push(item);
        }
      } else if (item.children) {
        // Recurse into nested children
        extractGroups(item.children, groupByField, groupValue);
      }
    }
  }

  extractGroups(children);
  return { grouped: true, groups , cntRemoved:removedCount};
}



// Export search handler function
export const searchHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      q,
      apps = 'slack,ticket,user,file,mail',
      offset = 0,
      limit = 20,
      rankProfile,
      // Frontend-compatible filters
      type,        // 'messages' | 'attachments' | 'channels' | 'tickets' | 'files'
      subApp,      // 'canvas' | 'transcript' | 'RCA' - sub-app filter for files
      from,        // User name or ID
      withUser,    // User ID for participant filter
      in: inChannel, // Channel name or ID (renamed to avoid 'in' keyword)
      // Unified filters (work for both slack and ticket)
      projectId,   // Project ID(s) - comma-separated
      // Ticket-specific filters
      status,      // Ticket status(es) - comma-separated
      ticketId,     // Specific ticket ID(s) - comma-separated
      priority,    // Priority (HIGH, MEDIUM, LOW) - comma-separated
      searchId,
      board,       // Board name/ID
      tags,        // Comma-separated tags
      before,      // Created before date (multiple formats)
      after,       // Created after date (multiple formats)
      on,          // Created on specific date (multiple formats)
      range,       // Time keyword filter (today, yesterday, etc.)
      stage,       // Ticket stage
      assignee,    // Assigned user name
      filterOnly,  // Flag for filter-only search (no query text)
      callType,   // Call type filter (e.g. HEADLESS for recordings)
      presentationSummary, // Optional Vespa presentation.summary profile (e.g. 'lean')
      includeBotMessages,  // 'true'|'false' string from cmd-K toggle; default behavior excludes BOT messages
      // Note: subApp was moved up to be with other frontend filters
    } = req.query;

    const userId = (req as any).user?.id;
    const userEmail = (req as any).user?.email;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    
    // Allow empty query if filterOnly is true
    if (!q && filterOnly !== 'true') {
      res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
      return;
    }
    // Build options object
    const options: any = {
      offset: Number(offset),
      limit: Number(limit),
      slack: {},
      ticket: {},
      file: {},
      mail: { userEmail }
    };
    
     if (rankProfile) {
      options.rankProfile = rankProfile as string;
    }

    // Checks if "search" is in the string and extracts the last number
    const userAgent = req.get('User-Agent') || '';
    if (userAgent.includes('search')) {
      // Regex matches digits (\d+) at the end of the string ($)
      const match = userAgent.match(/(\d+)$/);
      
      if (match && match.length > 1) {
        const scoreInt = match[1]; // The captured number
        options.rankProfile = `${RankProfile.nativeRank}_${scoreInt}`;
        logger.info(`[vespa-search, ${searchId?searchId:""}] User-Agent contained 'search'. Switched rankProfile to: ${options.rankProfile}`);
        if(parseInt(scoreInt) == 50){
          options.rankProfile = RankProfile.personalizedRank;
        }
      }

    }

    // Determine which apps to search based on type filter
    let searchApps = (apps as string).split(',');

    const validTypes = VALID_DOC_TYPES as readonly string[];

    // Map frontend 'type' filter to docType and subApp
    if (type) {
      // Frontend sends exact type names only (prefix expansion is handled client-side)
      const types = (type as string).split(',').map(t => t.trim().toLowerCase()).filter(t => validTypes.includes(t));

      // Unified type mapping — includes subApp types (canvas, transcript, rca)
      // Types filtered locally (users, people, channels) have null app so they don't trigger a Vespa search
      const typeMapping: Record<string, { app: 'chat' | 'ticket' | 'file' | 'mail' | null, optionsKey: 'slack' | 'ticket' | 'file' | 'mail', docType: string, subApp?: string }> = {
        'messages': { app: 'chat', optionsKey: 'slack', docType: VespaDocType.MESSAGE },
        'attachments': { app: 'chat', optionsKey: 'slack', docType: VespaDocType.ATTACHMENT },
        'channels': { app: null, optionsKey: 'slack', docType: VespaDocType.CHANNEL },
        'tickets': { app: 'ticket', optionsKey: 'ticket', docType: VespaDocType.TICKET },
        'files': { app: 'file', optionsKey: 'file', docType: VespaDocType.FILE },
        'users': { app: null, optionsKey: 'slack', docType: VespaDocType.USER },
        'people': { app: null, optionsKey: 'slack', docType: VespaDocType.USER },
        'canvas': { app: 'file', optionsKey: 'file', docType: VespaDocType.FILE, subApp: 'canvas' },
        'transcript': { app: 'file', optionsKey: 'file', docType: VespaDocType.FILE, subApp: 'transcript' },
        'rca': { app: 'file', optionsKey: 'file', docType: VespaDocType.FILE, subApp: 'RCA' },
        'emails': { app: 'mail', optionsKey: 'mail', docType: VespaDocType.MAIL },
      };

      const mappedApps = new Set<'chat' | 'ticket' | 'file' | 'mail'>();
      const subApps: string[] = [];

      types.forEach(t => {
        const mapped = typeMapping[t];
        if (mapped) {
          if (mapped.app) {
            mappedApps.add(mapped.app);
          }
          if (!options[mapped.optionsKey].docType) {
            options[mapped.optionsKey].docType = [];
          }
          options[mapped.optionsKey].docType!.push(mapped.docType);
          if (mapped.subApp) {
            subApps.push(mapped.subApp);
          }
        }
      });

      if (subApps.length > 0) {
        options.file.subApp = subApps;
      }

      // Restrict apps to only those needed for the type filter
      // If only local types (users/people/channels) were requested, search all apps
      if (mappedApps.size > 0) {
        searchApps = Array.from(mappedApps);
      }
    }
    
    // Map frontend 'from' filter to senderId (messages), createdBy (tickets), and createdBy (files)
    if (from) {
      options.slack.senderId = from;
      options.ticket.createdBy = from;
      options.file.createdBy = from;
    }

    if (withUser) {
      options.slack.participants = withUser
    }

    // Map frontend 'in' filter to channelId
    if (inChannel) {
      options.slack.channelId = inChannel;
      options.ticket.channelId = inChannel;
    }
    
    // Add unified filters (apply to both slack and ticket)
    if (projectId) {
      const projectIds = (projectId as string).split(',');
      options.slack.projectId = projectIds;
      options.ticket.projectId = projectIds;
    }
    
    // Add ticket-specific filters
    if (status) {
      options.ticket.status = (status as string).split(',');
    }

    if (ticketId) {
      options.ticket.ticketId = (ticketId as string).split(',');
    }

    if (priority) {
      options.ticket.priority = (priority as string).split(',');
    }

    // New ticket filters
    if (board) {
      options.ticket.boardId = (board as string).split(',');
    }

    if (tags) {
      options.ticket.tags = (tags as string).split(',');
    }

    // Date filters (apply to both slack and ticket)
    if (before) {
      options.slack.createdBefore = before as string;
      options.ticket.createdBefore = before as string;
    }

    if (after) {
      options.slack.createdAfter = after as string;
      options.ticket.createdAfter = after as string;
    }

    if (on) {
      options.slack.createdOn = on as string;
      options.ticket.createdOn = on as string;
    }

    if (range) {
      options.slack.createdRange = range as string;
      options.ticket.createdRange = range as string;
    }

    if (stage) {
      options.ticket.stage = (stage as string).split(',');
    }

    if (assignee) {
      options.ticket.assignedTo = (assignee as string).split(',');
    }

    if (subApp) {
      options.file.subApp = (subApp as string).split(',');
    }

    if (callType) {
      options.file.callType = (callType as string).split(',');
    }

    if (presentationSummary) {
      options.presentationSummary = presentationSummary as string;
    }

    // Bot-message toggle: default OFF (exclude). Frontend opts-in by sending
    // includeBotMessages=true. Anything else → exclude bot messages.
    if (includeBotMessages !== 'true') {
      options.slack.excludeBotMessages = true;
    }

    // Call vespa search
    const results = await vespaService.searchService.searchVespa(
      q as string,
      userId,
      searchApps,
      options,
      searchId as string
    );

    // Create a map of docId -> matchfeatures from children
    const matchFeaturesMap = new Map<string, MatchFeatures>();
    (results.root.children || []).forEach((child: any) => {
      if (child.fields?.docId && child.fields?.matchfeatures) {
        matchFeaturesMap.set(child.fields.docId, child.fields.matchfeatures);
      }
    });

    // Parse Vespa results (grouped or flat)
    const parsedResults = parseVespaResults(results.root.children || []);

    if (parsedResults.grouped && parsedResults.groups) {
      // Grouped result don't have matchFeatures
      // Need to be added explicitly
      // Return grouped results
     
      const groupedResults = await Promise.all(
        parsedResults.groups.map(async (group) => {
          // Attach matchfeatures to each hit's fields before transformation
          const hitsWithMatchFeatures = group.hits.map((hit: VespaSearchHit) => ({
            ...hit,
            fields: {
              ...hit.fields,
              matchfeatures: matchFeaturesMap.get(hit.fields?.docId) || null
            }
          }));
          const transformedHits = await transformVespaResults(hitsWithMatchFeatures, db);
          return {
            groupBy: group.groupBy,
            groupValue: group.groupValue,
            count: transformedHits.length,
            results: transformedHits
          };
        })
      );

      res.json({
        success: true,
        data: {
          grouped: true,
          groups: groupedResults,
          totalCount: (parsedResults.cntRemoved && groupedResults.length > 0) ? (Number(offset) + groupedResults[0].count) : results.root.fields?.totalCount,
          offset: Number(offset),
          limit: Number(limit)
        }
      });
    } else {
      // Return flat results (backward compatible)
      // flat results will have matchFeatures returned by vespa.
      // No need to add.
      const hits = parsedResults.hits || [];
      const transformedResults = await transformVespaResults(hits, db);

      res.json({
        success: true,
        data: {
          grouped: false,
          results: transformedResults,
          totalCount: results.root.fields?.totalCount || 0,
          offset: Number(offset),
          limit: Number(limit)
        }
      });
    }
  } catch (error: any) {
    logger.error('Search error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
};

// Export vespa service and client for other uses
export { vespaService };
export const vespaClient = vespaService.vespaClient;
