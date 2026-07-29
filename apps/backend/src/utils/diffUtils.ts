/**
 * Transforms a single Bitbucket JSON diff to unified diff format
 */
export function transformBitbucketDiff(diff: any): any {
    const oldPath = diff.source?.toString;
    const newPath = diff.destination?.toString;

    let type: 'add' | 'delete' | 'modify' | 'rename' = 'modify';
    if (!diff.source) type = 'add';
    else if (!diff.destination) type = 'delete';

    const hunks = (diff.hunks || []).map((hunk: any) => {
        let content = '';
        (hunk.segments || []).forEach((segment: any) => {
            const prefix = segment.type === 'ADDED' ? '+' : segment.type === 'REMOVED' ? '-' : ' ';
            const segmentContent = (segment.lines || []).map((l: any) => prefix + l.line).join('\n');
            if (content && segmentContent) content += '\n';
            content += segmentContent;
        });

        return {
            oldStart: hunk.sourceLine,
            oldLines: hunk.sourceSpan,
            newStart: hunk.destinationLine,
            newLines: hunk.destinationSpan,
            content
        };
    });

    return {
        oldPath: oldPath || newPath,
        newPath: newPath || oldPath,
        type,
        hunks
    };
}

/**
 * Calculate diff stats from transformed diff array
 */
export function calculateDiffStats(gitDiff: any[]): { additions: number; deletions: number; files: number } {
    let additions = 0, deletions = 0;
    gitDiff.forEach((f: any) => (f.hunks || []).forEach((h: any) => {
        (h.content || "").split('\n').forEach((line: string) => {
            if (line.startsWith('+')) additions++;
            else if (line.startsWith('-')) deletions--;
        });
    }));
    return { additions, deletions, files: gitDiff.length };
}
