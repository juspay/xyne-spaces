import { logger, Event as LogEvent } from '../../../../utils/logger';
/**
 * Utility functions for generating contextual status messages based on tool inputs
 */

// Helper: Convert snake_case to Title Case
const snakeToTitle = (str: string): string => {
  return str
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

// Helper: Get display name for domain
const getDomainDisplayName = (domain: string): string => {
  // Sanitize input first
  const sanitizedDomain = sanitizeString(domain).toLowerCase();

  const domainMap: Record<string, string> = {
    payments: 'Payments',
    refunds: 'Refunds',
    transactions: 'Transactions',
    merchants: 'Merchants',
    // Add more domains as needed
  };
  return domainMap[sanitizedDomain] || snakeToTitle(sanitizedDomain);
};

// Helper: Sanitize string to prevent XSS
const sanitizeString = (str: string): string => {
  return str.replace(/[<>]/g, '');
};

// Helper: Format interval string
const formatInterval = (interval: string): string => {
  // Sanitize input first
  const sanitized = sanitizeString(interval);

  // Handle different interval formats
  if (sanitized.toLowerCase().includes('today')) return 'today';
  if (sanitized.toLowerCase().includes('yesterday')) return 'yesterday';
  if (sanitized.toLowerCase().includes('this week')) return 'this week';
  if (sanitized.toLowerCase().includes('last week')) return 'last week';
  if (sanitized.toLowerCase().includes('this month')) return 'this month';
  if (sanitized.toLowerCase().includes('last month')) return 'last month';

  // Validate date string format before parsing
  // Only accept ISO 8601 format or common date patterns
  const datePattern = /^\d{4}-\d{2}-\d{2}|^\d{2}\/\d{2}\/\d{4}$/;
  if (!datePattern.test(sanitized)) {
    return sanitized;
  }

  // Try to format as date
  try {
    const date = new Date(sanitized);
    // Validate date is valid and reasonable (not in far future/past)
    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const oneYearAhead = now + 365 * 24 * 60 * 60 * 1000;

    if (!isNaN(date.getTime()) && date.getTime() >= oneYearAgo && date.getTime() <= oneYearAhead) {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (date.toDateString() === today.toDateString()) return 'today';
      if (date.toDateString() === yesterday.toDateString()) return 'yesterday';

      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  } catch {
    // Ignore parsing errors
  }

  return sanitized;
};

// Helper: Safely parse and validate JSON input
const parseToolInput = (toolInput: unknown): Record<string, unknown> | null => {
  try {
    let parsed: unknown;

    if (typeof toolInput === 'string') {
      // Validate JSON string length to prevent DoS
      if (toolInput.length > 10000) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('Tool input string too large, truncating'),
        });
        return null;
      }
      parsed = JSON.parse(toolInput);
    } else {
      parsed = toolInput;
    }

    // Validate parsed result is an object
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to parse tool input:'),
      error: error,
    });
    return null;
  }
};

// Helper: Safely extract string from unknown value with sanitization
const extractSafeString = (value: unknown): string => {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '';
};

/**
 * Generate contextual status message based on tool name and input.
 * Returns a single string for quick tools, or an array of rotating phrases for long-running tools.
 */
export const generateToolInputStatus = (
  toolName: string,
  toolInput: unknown,
): string | string[] => {
  try {
    const input = parseToolInput(toolInput);
    if (!input) {
      return 'Processing...';
    }

    switch (toolName) {
      case 'info': {
        const domain = extractSafeString(input['domain']);
        const domainName = getDomainDisplayName(domain);
        return `Fetching metrics, dimensions and filters for ${domainName}`;
      }

      case 'field_value_discovery': {
        const requests = input['requests'];
        const allQueries: string[] = [];

        if (Array.isArray(requests)) {
          requests.forEach((request: unknown) => {
            if (typeof request === 'object' && request !== null) {
              const queries = (request as Record<string, unknown>)['queries'];
              if (Array.isArray(queries)) {
                queries.forEach((q: unknown) => {
                  if (typeof q === 'string') {
                    allQueries.push(sanitizeString(q));
                  }
                });
              }
            }
          });
        }

        const queryText = allQueries.length > 0 ? allQueries.join(', ') : 'fields';
        return `Finding values for ${sanitizeString(queryText)}`;
      }

      case 'q_api':
      case 'q_api_gemini': {
        const metric = snakeToTitle(extractSafeString(input['metric']) || 'data');
        const dimensions = input['dimensions'];
        const intervalObj = input['interval'];

        let fromInterval = 'start';
        let toInterval = 'end';

        if (typeof intervalObj === 'object' && intervalObj !== null) {
          const interval = intervalObj as Record<string, unknown>;
          if (interval['start']) {
            fromInterval = formatInterval(extractSafeString(interval['start']));
          }
          if (interval['end']) {
            toInterval = formatInterval(extractSafeString(interval['end']));
          }
        }

        // Check if any dimension object has granularity (time-series query)
        const hasGranularity =
          Array.isArray(dimensions) &&
          dimensions.some((d: unknown) => {
            return typeof d === 'object' && d !== null && 'granularity' in d;
          });

        // Extract dimension field names if present (for table queries)
        const dimensionFields: string[] = [];
        if (Array.isArray(dimensions)) {
          dimensions.forEach((d: unknown) => {
            // Check for dimension field name (not granularity-based dimensions)
            if (typeof d === 'string') {
              dimensionFields.push(sanitizeString(d));
            } else if (typeof d === 'object' && d !== null) {
              if ('field' in d && typeof d.field === 'string') {
                dimensionFields.push(sanitizeString(d.field));
              } else if ('name' in d && typeof d.name === 'string') {
                dimensionFields.push(sanitizeString(d.name));
              }
            }
          });
        }

        // Time-series query (has granularity)
        if (hasGranularity) {
          // If from and to are the same, show "for X" instead of "from X to X"
          if (fromInterval === toInterval) {
            return `Analyzing ${sanitizeString(metric)} trend for ${fromInterval}`;
          }
          return `Analyzing ${sanitizeString(metric)} trend from ${fromInterval} to ${toInterval}`;
        }

        // Table query (has dimension fields)
        if (dimensionFields.length > 0) {
          const dimensionText = dimensionFields.map(d => snakeToTitle(d)).join(', ');
          return `Going through ${sanitizeString(metric)} for ${sanitizeString(dimensionText)}`;
        }

        // Single-stat query (no dimensions or granularity)
        // If from and to are the same, show "for X" instead of "from X to X"
        if (fromInterval === toInterval) {
          return `Extracting ${sanitizeString(metric)} for ${fromInterval}`;
        }
        return `Extracting ${sanitizeString(metric)} from ${fromInterval} to ${toInterval}`;
      }

      case 'rag_query':
        return 'Going through documentation';

      case 'mid_lookup': {
        const merchantName = extractSafeString(input['merchant_name']);
        const query = extractSafeString(input['query']);
        const merchantQuery = merchantName || query || 'merchant';
        return `Finding exact MID for ${merchantQuery}`;
      }

      case 'math':
        return 'Calculating data';

      case 'q_api_csv':
        return 'Creating CSV';

      case 'sr_recommendations':
        return 'Getting recommendations';

      case 'sequentialthinking':
        return 'Thinking';

      case 'fetch_channel_messages': {
        const channels = input['channels'];
        if (Array.isArray(channels) && channels.length > 0) {
          const names = channels.map((c: unknown) => extractSafeString(c)).filter(Boolean);
          if (names.length > 0) {
            return `Fetching messages from ${names.join(', ')}`;
          }
        }
        return 'Fetching channel messages';
      }

      case 'fetch_thread_messages':
        return 'Fetching thread messages';

      case 'search_relevant_content': {
        const query = extractSafeString(input['query']);
        const contentTypes = Array.isArray(input['contentTypes'])
          ? (input['contentTypes'] as string[])
          : [];
        const typeLabels: Record<string, string> = {
          messages: 'messages',
          tickets: 'tickets',
          canvas: 'canvas',
          calls: 'calls',
          recordings: 'recordings',
        };
        const label =
          contentTypes.length > 0
            ? contentTypes.map(t => typeLabels[t] ?? t).join(', ')
            : 'content';
        if (query) {
          const truncated = query.length > 50 ? query.slice(0, 50) + '...' : query;
          return `Searching ${label} for "${truncated}"`;
        }
        return `Searching ${label}`;
      }

      case 'web_search': {
        const query = extractSafeString(input['query']);
        if (query) {
          // Remove HTML quote entities
          const cleanQuery = query.replace(/"/g, '').replace(/"/g, '');
          return `Searching the web for ${cleanQuery}`;
        }
        return 'Searching the web';
      }

      case 'xyne_rca': {
        const query = extractSafeString(input['query']);
        if (query) {
          const truncated = query.length > 50 ? query.slice(0, 50) + '...' : query;
          return `Investigating: "${truncated}"`;
        }
        return 'Running root cause analysis';
      }

      case 'create_canvas': {
        const title = extractSafeString(input['title']);
        return title ? `Creating canvas "${sanitizeString(title)}"` : 'Creating canvas';
      }

      case 'read_canvas':
        return 'Reading canvas content';

      case 'edit_canvas': {
        const title = extractSafeString(input['title']);
        return title ? `Editing canvas "${sanitizeString(title)}"` : 'Editing canvas';
      }

      case 'fetch_link_content': {
        const url = extractSafeString(input['url']);
        if (url) {
          try {
            const hostname = new URL(url).hostname;
            return `Fetching content from ${sanitizeString(hostname)}`;
          } catch {
            // invalid URL, fall through
          }
        }
        return 'Fetching link content';
      }

      case 'deep_research': {
        const topic = extractSafeString(input['topic']);
        return [
          topic
            ? `Researching "${topic.length > 500 ? topic.slice(0, 500) + '…' : topic}"`
            : 'Starting deep research',
          'Brewing research brief',
          'Kneading sub-queries',
          'Sifting through data',
          'Marinating web sources',
          'Fermenting ideas',
          'Sautéing parallel searches',
          'Stewing on findings',
          'Simmering findings',
          'Infusing perspectives',
          'Caramelizing insights',
          'Proofing conclusions',
          'Whisking together references',
          'Tempering conclusions',
          'Reducing sauce of knowledge',
          'Plating final report',
        ];
      }

      case 'research_agent':
        return [
          'Diving deep into your question',
          'Gathering and cross-referencing sources',
          'Analyzing findings from multiple angles',
          'Synthesizing key insights',
          'Wrapping up the research',
        ];

      case 'generate_image':
      case 'generate-image': {
        const prompt = extractSafeString(input['prompt']);
        return [
          prompt
            ? `Generating image: "${prompt.length > 50 ? prompt.slice(0, 50) + '...' : prompt}"`
            : 'Generating image',
          'Composing the scene',
          'Rendering details',
          'Adding finishing touches',
          'Uploading your image',
        ];
      }

      case 'create_ppt': {
        return [
          `Designing your presentation`,
          'Choosing the perfect color palette',
          'Laying out slides and visual elements',
          'Adding finishing touches to each slide',
          'Rendering and uploading your deck',
        ];
      }

      case 'fetch_skill_instructions': {
        const skillName = extractSafeString(input['skillName']);
        if (skillName) {
          return `Loaded ${skillName} skill`;
        }
        return 'Loaded skill';
      }

      case 'manage_user_skill': {
        const operation = extractSafeString(input['operation']);
        const name = extractSafeString(input['name']);
        if (operation === 'create') {
          return name ? `Creating skill "${sanitizeString(name)}"` : 'Creating skill';
        }
        if (operation === 'update') {
          return name ? `Updating skill "${sanitizeString(name)}"` : 'Updating skill';
        }
        return 'Managing skill';
      }

      case 'user_activity': {
        return [
          'Perusing your activity',
          'Pondering your activity',
          'Cogitating your activity',
          'Contemplating your activity',
          'Considering your activity',
          'Musing your activity',
          'Ruminating your activity',
        ];
      }

      case 'list_user_channels':
        return 'Fetching your channels';

      default:
        return 'Processing';
    }
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Error generating tool input status:'),
      error: error,
    });
    return 'Processing';
  }
};
