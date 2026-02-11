
export enum FileChangeType {
	ADDED = "ADDED",
	MODIFIED = "MODIFIED",
	REMOVED = "REMOVED",
}

export interface FileChange {
	path: string;
	changeType: FileChangeType;
}

export interface CategorizedChanges {
	/** Environment/config file changes */
	envChanges: FileChange[];
	/** Database migration changes */
	migrationChanges: FileChange[];
	/** All other changes */
	otherChanges: FileChange[];
}

export interface ChangeCategory {
	name: string;
	patterns: string[];
}

export interface ChangeDetectorConfig {
	/** Patterns that match environment/config files */
	envPatterns: string[];
	/** Patterns that match migration files */
	migrationPatterns: string[];
}

export class ChangeDetector {
	private config: ChangeDetectorConfig;

	constructor(config: ChangeDetectorConfig) {
		this.config = config;
	}

	/**
	 * Check if a file path matches any of the given patterns
	 */
	matchesPattern(filePath: string, patterns: string[]): boolean {
		return patterns.some(
			(pattern) => filePath.includes(pattern) || filePath.endsWith(pattern)
		);
	}

	/**
	 * Check if a file is an environment/config file
	 */
	isEnvFile(filePath: string): boolean {
		return this.matchesPattern(filePath, this.config.envPatterns);
	}

	/**
	 * Check if a file is a migration file
	 */
	isMigrationFile(filePath: string): boolean {
		return this.matchesPattern(filePath, this.config.migrationPatterns);
	}

	/**
	 * Categorize a list of file changes into env, migration, and other
	 */
	categorize(changes: FileChange[]): CategorizedChanges {
		const categorized: CategorizedChanges = {
			envChanges: [],
			migrationChanges: [],
			otherChanges: [],
		};

		for (const change of changes) {
			if (this.isEnvFile(change.path)) {
				categorized.envChanges.push(change);
			} else if (this.isMigrationFile(change.path)) {
				categorized.migrationChanges.push(change);
			} else {
				categorized.otherChanges.push(change);
			}
		}

		return categorized;
	}

}

/**
 * ChangeDetector for Xyne releases
 */
export const XyneChangeDetector = new ChangeDetector({
	envPatterns: ["env.ts", ".env", ".env.local", ".env.example"],
	migrationPatterns: ["backend/prisma/migrations/", "backend/prisma/schema.prisma"],
});

/**
 * Maps Bitbucket change entry types to our FileChangeType
 */
export function mapBitbucketChangeType(type?: string): FileChangeType {
	switch (type) {
		case "ADD":
			return FileChangeType.ADDED;
		case "DELETE":
			return FileChangeType.REMOVED;
		case "MODIFY":
		default:
			return FileChangeType.MODIFIED;
	}
}
