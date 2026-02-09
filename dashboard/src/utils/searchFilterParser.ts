/**
 * Parse search filters from query text
 * Extracts filter:value patterns and returns cleaned search text + filter values
 */
export function parseSearchFilters(text: string) {
  let searchText = text.trim();
  let priority: string | undefined;
  let board: string | undefined;
  let tags: string | undefined;
  let before: string | undefined;
  let after: string | undefined;
  let on: string | undefined;
  let range: string | undefined;
  let stage: string | undefined;
  let status: string | undefined;
  let assignee: string | undefined;

  // Parse priority:value
  const priorityMatch = searchText.match(/\bpriority:\s*(\S+)/i);
  if (priorityMatch && priorityMatch[1]) {
    priority = priorityMatch[1].toUpperCase();
    searchText = searchText.replace(priorityMatch[0], '').trim();
  }

  // Parse board:value
  const boardMatch = searchText.match(/\bboard:\s*(\S+)/i);
  if (boardMatch && boardMatch[1]) {
    board = boardMatch[1];
    searchText = searchText.replace(boardMatch[0], '').trim();
  }

  // Parse tags:value (comma-separated)
  const tagsMatch = searchText.match(/\btags:\s*(\S+)/i);
  if (tagsMatch && tagsMatch[1]) {
    tags = tagsMatch[1];
    searchText = searchText.replace(tagsMatch[0], '').trim();
  }

  // Parse before:date (supports multiple date formats including "dd mon yy")
  const beforeMultiWordMatch = searchText.match(
    /\bbefore:\s*(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4})/i,
  );
  if (beforeMultiWordMatch && beforeMultiWordMatch[1]) {
    before = beforeMultiWordMatch[1];
    searchText = searchText.replace(beforeMultiWordMatch[0], '').trim();
  } else {
    const beforeMatch = searchText.match(/\bbefore:\s*(\S+)/i);
    if (beforeMatch && beforeMatch[1]) {
      before = beforeMatch[1];
      searchText = searchText.replace(beforeMatch[0], '').trim();
    }
  }

  // Parse after:date (supports multiple date formats including "dd mon yy")
  const afterMultiWordMatch = searchText.match(
    /\bafter:\s*(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4})/i,
  );
  if (afterMultiWordMatch && afterMultiWordMatch[1]) {
    after = afterMultiWordMatch[1];
    searchText = searchText.replace(afterMultiWordMatch[0], '').trim();
  } else {
    const afterMatch = searchText.match(/\bafter:\s*(\S+)/i);
    if (afterMatch && afterMatch[1]) {
      after = afterMatch[1];
      searchText = searchText.replace(afterMatch[0], '').trim();
    }
  }

  // Parse on:date (supports multiple date formats including "dd mon yy")
  const onMultiWordMatch = searchText.match(
    /\bon:\s*(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4})/i,
  );
  if (onMultiWordMatch && onMultiWordMatch[1]) {
    on = onMultiWordMatch[1];
    searchText = searchText.replace(onMultiWordMatch[0], '').trim();
  } else {
    const onMatch = searchText.match(/\bon:\s*(\S+)/i);
    if (onMatch && onMatch[1]) {
      on = onMatch[1];
      searchText = searchText.replace(onMatch[0], '').trim();
    }
  }

  // Parse range:keyword (time keywords - supports multi-word like "last 7 days")
  const multiWordRangeMatch = searchText.match(
    /\brange:\s*(last\s+\d+\s+days|last\s+\d+\s+hours|this\s+week|last\s+week|this\s+month|last\s+month|this\s+morning|this\s+afternoon|last\s+hour|last\s+24\s+hours)/i,
  );
  if (multiWordRangeMatch && multiWordRangeMatch[1]) {
    range = multiWordRangeMatch[1].toLowerCase();
    searchText = searchText.replace(multiWordRangeMatch[0], '').trim();
  } else {
    const singleWordRangeMatch = searchText.match(/\brange:\s*(\S+)/i);
    if (singleWordRangeMatch && singleWordRangeMatch[1]) {
      range = singleWordRangeMatch[1].toLowerCase();
      searchText = searchText.replace(singleWordRangeMatch[0], '').trim();
    }
  }

  // Parse stage:value
  const stageMatch = searchText.match(/\bstage:\s*(\S+)/i);
  if (stageMatch && stageMatch[1]) {
    stage = stageMatch[1];
    searchText = searchText.replace(stageMatch[0], '').trim();
  }

  // Parse status:value
  const statusMatch = searchText.match(/\bstatus:\s*(\S+)/i);
  if (statusMatch && statusMatch[1]) {
    status = statusMatch[1];
    searchText = searchText.replace(statusMatch[0], '').trim();
  }

  // Clean incomplete filter patterns
  searchText = searchText
    .replace(/\b(priority|board|tags|before|after|on|range|stage|status):\s*/gi, '')
    .trim();

  return {
    searchText,
    priority,
    board,
    tags,
    before,
    after,
    on,
    range,
    stage,
    status,
    assignee,
  };
}
