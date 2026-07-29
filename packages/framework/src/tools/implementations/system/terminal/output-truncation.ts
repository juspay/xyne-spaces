interface TruncationResult {
  content: string;
  wasTruncated: boolean;
  originalSize: number;
  truncatedBytes: number;
  preservedImportantLines: number;
}

const IMPORTANT_KEYWORDS = [
  'error', 'failed', 'exception', 'fatal', 'abort',
  'warning', 'warn', 'deprecated',
  'summary', 'total', 'finished', 'completed', 'result'
];

export function smartTruncateOutput(
  output: string,
  maxSize: number = 20000
): TruncationResult {
  if (output.length <= maxSize) {
    return {
      content: output,
      wasTruncated: false,
      originalSize: output.length,
      truncatedBytes: 0,
      preservedImportantLines: 0
    };
  }

  const lines = output.split('\n');
  
  const headSpace = Math.floor(maxSize * 0.4);
  const tailSpace = Math.floor(maxSize * 0.3);
  const middleSpace = maxSize - headSpace - tailSpace;

  const headLines = extractLines(lines, 0, headSpace);
  const tailLines = extractLines(lines.slice().reverse(), 0, tailSpace).reverse();
  
  const middleStart = headLines.length;
  const middleEnd = lines.length - tailLines.length;
  const importantLines = extractImportantLines(lines, middleStart, middleEnd, middleSpace);

  const result = buildTruncatedOutput(headLines, importantLines, tailLines, output.length - maxSize);

  return {
    content: result,
    wasTruncated: true,
    originalSize: output.length,
    truncatedBytes: output.length - result.length,
    preservedImportantLines: importantLines.length
  };
}

function extractLines(lines: string[], startIndex: number, maxChars: number): string[] {
  const result: string[] = [];
  let currentSize = 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const lineSize = line.length + 1; // +1 for newline
    
    if (currentSize + lineSize > maxChars) break;
    
    result.push(line);
    currentSize += lineSize;
  }

  return result;
}

function extractImportantLines(
  allLines: string[],
  startIndex: number,
  endIndex: number,
  maxChars: number
): string[] {
  const result: string[] = [];
  let currentSize = 0;
  let i = startIndex;

  while (i < endIndex) {
    const line = allLines[i];
    if (!line) {
      i++;
      continue;
    }
    const lowerLine = line.toLowerCase();
    
    const isImportant = IMPORTANT_KEYWORDS.some(keyword => 
      lowerLine.includes(keyword)
    );

    if (isImportant) {
      const block = extractImportantBlock(allLines, i, endIndex);
      const blockSize = block.reduce((sum, blockLine) => sum + blockLine.length + 1, 0);
      
      if (currentSize + blockSize <= maxChars) {
        result.push(...block);
        currentSize += blockSize;
        i += block.length; 
      } else {
        const lineSize = line.length + 1;
        if (currentSize + lineSize <= maxChars) {
          result.push(line);
          currentSize += lineSize;
        }
        i++;
      }
    } else {
      i++;
    }
  }

  return result;
}

function extractImportantBlock(
  allLines: string[],
  startIndex: number,
  maxIndex: number
): string[] {
  const firstLine = allLines[startIndex];
  if (!firstLine) return [];
  
  const block = [firstLine];

  for (let i = startIndex + 1; i < Math.min(startIndex + 6, maxIndex); i++) {
    const line = allLines[i];
    if (!line) break;
    const trimmed = line.trim();
    
    if (trimmed === '') break;
    if (isNewImportantLine(line)) break;
    
    if (isContextLine(line)) {
      block.push(line);
    } else {
      break;
    }
  }
  
  return block;
}

function isNewImportantLine(line: string): boolean {
  const lowerLine = line.toLowerCase();
  return IMPORTANT_KEYWORDS.some(keyword => 
    lowerLine.includes(keyword)
  );
}

function isContextLine(line: string): boolean {
  if (line.match(/^\s{2,}/) || line.startsWith('\t')) {
    return true;
  }
  
  if (line.match(/^\s*[|\-><^~]/)) {
    return true;
  }
  
  if (line.match(/^\s*\d+\s*[|:]/)) {
    return true;
  }
  
  if (line.match(/^\s*(at |in |from |note:|help:|hint:)/)) {
    return true;
  }
  
  return false;
}

function buildTruncatedOutput(
  headLines: string[],
  importantLines: string[],
  tailLines: string[],
  truncatedBytes: number
): string {
  const parts: string[] = [];

  if (headLines.length > 0) {
    parts.push(headLines.join('\n'));
  }

  if (truncatedBytes > 0) {
    const infoText = importantLines.length > 0 
      ? ` - showing ${importantLines.length} important lines(There can be more important lines that are shown. If they exist, they are removed due to size constraints)`
      : '';
    parts.push(`\n\n..... [${truncatedBytes} characters truncated${infoText}] .....\n`);
  }

  if (importantLines.length > 0) {
    parts.push(importantLines.join('\n'));
    
    if (tailLines.length > 0) {
      parts.push('\n\n..... Important line section finished .....\n\n Last section of the output is shown below .....\n');
    }
  }

  // Add tail
  if (tailLines.length > 0) {
    parts.push(tailLines.join('\n'));
  }

  return parts.join('');
}