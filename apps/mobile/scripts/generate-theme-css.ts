/**
 * Writes the Spaces design tokens to CSS.
 *
 * Run with `npm run theme:generate`. CI runs it too and fails on a diff, so the
 * committed file can never drift from the TypeScript it came from.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GENERATED_CSS_PATH, generateCss } from '../src/design-system/generate';

writeFileSync(resolve(import.meta.dirname, '..', GENERATED_CSS_PATH), generateCss(), 'utf8');

console.log(`[theme] wrote ${GENERATED_CSS_PATH}`);
