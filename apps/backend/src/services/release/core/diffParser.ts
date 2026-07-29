export interface ParsedDiff {
    removedLines: string[];
    addedLines: string[];
    rawDiff: string;
}

export interface EnvDiffResult {
    oldValue: string;
    newValue: string;
    changeSummary: string;
}

export interface MigrationDiffResult {
    query: string;
    changeLog: string;
}

/**
 * Utility class for parsing git diffs and extracting meaningful values
 */
export class DiffParser {
    /**
     * Parse a raw git diff string into structured components
     *
     * Git diff format:
     * --- a/oldfile       <- old file marker
     * +++ b/newfile       <- new file marker
     * @@ -1,5 +1,5 @@     <- hunk header (line range)
     * -removed line       <- lines starting with - are removed
     * +added line         <- lines starting with + are added
     *  unchanged line     <- lines starting with space are context
     */
    static parse(rawDiff: string): ParsedDiff {
        const lines = rawDiff.split('\n');
        const removedLines: string[] = [];
        const addedLines: string[] = [];

        // Only collect +/- lines inside a hunk. Gating on `@@` distinguishes the
        // `---`/`+++` file-header markers (which precede the first hunk) from real
        // content lines that happen to start with `--`/`++` (e.g. a removed SQL
        // comment `-- drop col` arrives as `--- drop col`).
        let inHunk = false;
        for (const line of lines) {
            if (line.startsWith('diff --git ')) {
                inHunk = false;
                continue;
            }
            if (line.startsWith('@@')) {
                inHunk = true;
                continue;
            }
            if (!inHunk) continue;
            if (line.startsWith('-')) {
                removedLines.push(line.slice(1));
            } else if (line.startsWith('+')) {
                addedLines.push(line.slice(1));
            }
        }

        return {
            removedLines,
            addedLines,
            rawDiff,
        };
    }

    /**
     * Parse diff for ENV files to extract old and new values
     */
    static parseEnvDiff(diff: string, fileName: string): EnvDiffResult {
        const parsed = this.parse(diff);

        // Join all removed lines as old value
        const oldValue = parsed.removedLines.join('\n');

        // Join all added lines as new value
        const newValue = parsed.addedLines.join('\n');

        // Generate change summary
        let changeSummary = '';
        if (parsed.removedLines.length === 0 && parsed.addedLines.length > 0) {
            changeSummary = `Added ${parsed.addedLines.length} line(s) to ${fileName}`;
        } else if (parsed.removedLines.length > 0 && parsed.addedLines.length === 0) {
            changeSummary = `Removed ${parsed.removedLines.length} line(s) from ${fileName}`;
        } else if (parsed.removedLines.length > 0 && parsed.addedLines.length > 0) {
            changeSummary = `Modified ${fileName}: ${parsed.removedLines.length} line(s) removed, ${parsed.addedLines.length} line(s) added`;
        } else {
            changeSummary = `No content changes detected in ${fileName}`;
        }

        return {
            oldValue,
            newValue,
            changeSummary,
        };
    }

    /**
     * Strip git-diff metadata lines and per-line +/- markers so the
     * stored `changeLog` is copy-paste-ready content (no `diff --git`,
     * `index …`, `+++`/`---`, `@@ … @@`, no leading `+`/`-`/space).
     *
     * Mirrors the dashboard's render-time `cleanDiff` in
     * `dashboard/src/components/Release/ChangeCards.tsx` — moving the
     * cleanup to write-time means new rows are already clean. The
     * dashboard helper stays for backward compat with legacy rows.
     */
    private static cleanChangeLog(rawDiff: string): string {
        const drop = /^(diff --git |index |new file mode |deleted file mode |old mode |new mode |--- |\+\+\+ |@@ )/;
        return rawDiff
            .split('\n')
            .filter(line => !drop.test(line))
            .map(line => line.replace(/^[+\- ]/, ''))
            .join('\n');
    }

    /**
     * Parse diff for migration/SQL files to extract the query
     */
    static parseMigrationDiff(diff: string, fileName: string): MigrationDiffResult {
        const parsed = this.parse(diff);

        // For SQL files, the query is typically the added content
        // For schema.prisma, extract the added/modified model definitions
        const isPrismaSchema = fileName.endsWith('.prisma');

        let query: string;

        if (isPrismaSchema) {
            // For Prisma schema, extract the added/modified model blocks
            query = this.extractPrismaChanges(parsed.addedLines);
        } else {
            // For SQL files, join added lines as the query
            query = parsed.addedLines.join('\n');
        }

        return {
            query: query.trim() || '-- No query extracted',
            changeLog: this.cleanChangeLog(parsed.rawDiff),
        };
    }

    /**
     * Extract Prisma schema model changes from diff
     */
    private static extractPrismaChanges(addedLines: string[]): string {
        // Look for complete model blocks in the added lines
        const models: string[] = [];
        let currentModel: string[] = [];
        let inModelBlock = false;

        for (const line of addedLines) {
            const trimmed = line.trim();

            // Model declaration starts with "model Name {"
            if (/^model\s+\w+\s*{/.test(trimmed)) {
                // Start of new model block
                if (currentModel.length > 0) {
                    models.push(currentModel.join('\n'));
                }
                currentModel = [line];
                inModelBlock = true;
            } else if (inModelBlock) {
                currentModel.push(line);
                // End of model block
                if (trimmed === '}') {
                    models.push(currentModel.join('\n'));
                    currentModel = [];
                    inModelBlock = false;
                }
            } else {
                // Standalone field additions (outside model block in diff)
                currentModel.push(line);
            }
        }

        // Add any remaining model content
        if (currentModel.length > 0) {
            models.push(currentModel.join('\n'));
        }

        // If we found structured models, return them; otherwise return all added content
        if (models.length > 0) {
            return models.join('\n\n');
        }

        // Fallback: return all added lines
        return addedLines.join('\n');
    }

}