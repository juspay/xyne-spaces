/** biome-ignore-all lint/suspicious/noConsole: CLI script intentionally uses console for output */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const projectDir = process.cwd();
const testsDir = join(projectDir, 'tests');
const errors: string[] = [];

function startsWithNumber(name: string): boolean {
  return /^\d+[-_]/.test(name);
}

function isJsFile(name: string): boolean {
  return /\.(js|cjs|mjs)$/.test(name);
}

function checkForJsFiles(dir: string): void {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'report' ||
      entry.name === 'reports'
    ) {
      continue;
    }

    const fullPath = join(dir, entry.name);
    const relativePath = relative(projectDir, fullPath);

    if (entry.isDirectory()) {
      checkForJsFiles(fullPath);
    } else if (entry.isFile() && isJsFile(entry.name)) {
      errors.push(
        `JavaScript file "${relativePath}" is not allowed. Use TypeScript (.ts) instead.`
      );
    }
  }
}

function validateDirectory(dir: string): void {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(testsDir, fullPath);

    if (entry.isDirectory()) {
      const isShared =
        entry.name === 'shared' || dir.includes('/shared') || dir.includes('\\shared');

      if (!isShared && !startsWithNumber(entry.name)) {
        errors.push(`Folder "${relativePath}" must start with a number (e.g., "01_${entry.name}")`);
      }

      validateDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.spec')) {
      if (!startsWithNumber(entry.name)) {
        errors.push(
          `Spec file "${relativePath}" must start with a number (e.g., "01_${entry.name}")`
        );
      }
    }
  }
}

console.log('Validating project filename conventions...\n');

try {
  console.log('Checking for JavaScript files...');
  checkForJsFiles(projectDir);

  console.log('Validating test folder and file naming...');
  validateDirectory(testsDir);

  if (errors.length > 0) {
    console.error('\n❌ Validation errors found:\n');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error(`\nTotal: ${errors.length} error(s)`);
    process.exit(1);
  }

  console.log('\n✅ All filename validations passed');
  process.exit(0);
} catch (err) {
  console.error('Error during filename validation:', err);
  process.exit(1);
}
