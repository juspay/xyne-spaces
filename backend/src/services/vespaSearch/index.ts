import { createVespaService, type VespaDependencies } from 'vespa/src';
import { logger } from '@/utils/logger';
import { Request, Response } from 'express';
import config from 'vespa/src/config';
import { transformVespaResults } from './resultTransform';
import { db } from '@/database/client';
import { RankProfile, VespaDocType } from '@/vespa/src/types';


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
          if(item.fields.rankfeatures.nativeRank > config.nativeRankThreshold)
          group.hits.push(item)
          else{
            removedCount++
          }
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
      apps = 'slack,ticket,user', 
      offset = 0, 
      limit = 20,
      rankProfile,
      // Frontend-compatible filters
      type,        // 'messages' | 'attachments' | 'channels' | 'tickets'
      from,        // User name or ID
      in: inChannel, // Channel name or ID (renamed to avoid 'in' keyword)     
      // Unified filters (work for both slack and ticket)
      channelId,   // Channel ID(s) - comma-separated
      projectId,   // Project ID(s) - comma-separated
      docType,     // Document type(s) - comma-separated
      senderId,    // Sender/User ID(s) - comma-separated
      // Ticket-specific filters
      groupId,     // User group ID(s) - comma-separated
      status,      // Ticket status(es) - comma-separated
      ticketId,     // Specific ticket ID(s) - comma-separated
      searchId     
    } = req.query;

    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    
    if (!q) {
      res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
      return;
    }
    // Build options object
    const options: any = {
      offset: Number(offset),
      limit: Number(limit),
      slack: {},
      ticket: {}
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

    // Map frontend 'type' filter to docType
    if (type) {
      const typeMapping: Record<string, string[]> = {
        'messages': [VespaDocType.MESSAGE],
        'attachments': [VespaDocType.ATTACHMENT],
        'channels': [VespaDocType.CHANNEL],
        'tickets': [VespaDocType.TICKET]
      };
      const mappedTypes = typeMapping[type as string];
      if (mappedTypes) {
        options.slack.docType = mappedTypes;
      }
    }
    
    // Map frontend 'from' filter to senderId
    if (from) {
      options.slack.senderId = from;
    }
    
    // Map frontend 'in' filter to channelId
    if (inChannel) {
      options.slack.channelId = inChannel;
      options.ticket.channelId = inChannel;
    }
    
    // Add unified filters (apply to both slack and ticket)
    if (channelId) {
      const channelIds = (channelId as string).split(',');
      options.slack.channelId = channelIds;
      options.ticket.channelId = channelIds;
    }
    
    if (projectId) {
      const projectIds = (projectId as string).split(',');
      options.slack.projectId = projectIds;
      options.ticket.projectId = projectIds;
    }
    
    if (docType) {
      options.slack.docType = (docType as string).split(',');
    }
    
    if (senderId) {
      options.slack.senderId = (senderId as string).split(',');
    }
    
    // Add ticket-specific filters
    if (groupId) {
      options.ticket.groupId = (groupId as string).split(',');
    }
    
    if (status) {
      options.ticket.status = (status as string).split(',');
    }
    
    if (ticketId) {
      options.ticket.ticketId = (ticketId as string).split(',');
    }
    
    // Call vespa search
    const results = await vespaService.searchService.searchVespa(
      q as string,
      userId,
      (apps as string).split(','),
      options,
      searchId as string
    );

    // Parse Vespa results (grouped or flat)
    const parsedResults = parseVespaResults(results.root.children || []);

    if (parsedResults.grouped && parsedResults.groups) {
      // Return grouped results
     
      const groupedResults = await Promise.all(
        parsedResults.groups.map(async (group) => {
          const transformedHits = await transformVespaResults(group.hits, db);
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

// Export vespa service for other uses
export { vespaService };