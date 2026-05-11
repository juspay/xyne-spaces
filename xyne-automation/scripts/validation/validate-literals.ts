/** biome-ignore-all lint/suspicious/noConsole: CLI script intentionally uses console for output */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const projectDir = process.cwd();
const testsDir = join(projectDir, 'tests');
const errors: string[] = [];
const allowedBrowserNamePattern = /^[a-z0-9]+-browser-\d+$/;

type AssertionExpectation = {
  stepSnippet: string;
  parameterName: string;
  assertionCall: string;
};

const assertionExpectations: AssertionExpectation[] = [
  {
    stepSnippet: '<urlPath>',
    parameterName: 'urlPath',
    assertionCall: 'assertValidUrlPath(urlPath)',
  },
  {
    stepSnippet: '<statusCode>',
    parameterName: 'statusCode',
    assertionCall: 'assertValidStatusCode(statusCode)',
  },
  {
    stepSnippet: '<projectAlias>',
    parameterName: 'projectAlias',
    assertionCall: 'assertValidProjectAlias(projectAlias)',
  },
  {
    stepSnippet: '<channelAlias>',
    parameterName: 'channelAlias',
    assertionCall: 'assertValidChannelAlias(channelAlias)',
  },
  {
    stepSnippet: '<dmAlias>',
    parameterName: 'dmAlias',
    assertionCall: 'assertValidDmAlias(dmAlias)',
  },
  {
    stepSnippet: '<messageAlias>',
    parameterName: 'messageAlias',
    assertionCall: 'assertValidMessageAlias(messageAlias)',
  },
  {
    stepSnippet: '<userAlias>',
    parameterName: 'userAlias',
    assertionCall: 'assertValidUserAlias(userAlias)',
  },
];

function validateSpecAndConceptContent(dir: string): void {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(projectDir, fullPath);

    if (entry.isDirectory()) {
      validateSpecAndConceptContent(fullPath);
      continue;
    }

    if (!entry.isFile() || (!entry.name.endsWith('.spec') && !entry.name.endsWith('.cpt'))) {
      continue;
    }

    const content = readFileSync(fullPath, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const browserMatch = line.match(
        /(?:(?:using|Using) browser|switching to temp browser) "([^"]+)"/
      );
      if (browserMatch && !allowedBrowserNamePattern.test(browserMatch[1])) {
        errors.push(
          `Browser name "${browserMatch[1]}" in "${relativePath}:${index + 1}" is invalid. Use the format <name>-browser-<number>.`
        );
      }
    });
  }
}

function validateStepDefinitionAssertions(dir: string): void {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(projectDir, fullPath);

    if (entry.isDirectory()) {
      validateStepDefinitionAssertions(fullPath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }

    const content = readFileSync(fullPath, 'utf8');

    for (const expectation of assertionExpectations) {
      if (!content.includes('@Step(') || !content.includes(expectation.stepSnippet)) {
        continue;
      }

      const methodPattern = new RegExp(
        String.raw`@Step\(\s*'[^']*${expectation.stepSnippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^']*'\s*\)[\s\S]*?\((?:[^)]*\b${expectation.parameterName}\b[^)]*)\)[\s\S]*?\{([\s\S]*?)\n\s*\}`,
        'g'
      );

      let foundMatchingMethod = false;
      for (const match of content.matchAll(methodPattern)) {
        foundMatchingMethod = true;
        const methodBody = match[1];
        if (!methodBody.includes(expectation.assertionCall)) {
          errors.push(
            `Step definition in "${relativePath}" with parameter ${expectation.parameterName} must call ${expectation.assertionCall}.`
          );
        }
      }

      if (!foundMatchingMethod && content.includes(expectation.stepSnippet)) {
        errors.push(
          `Could not verify assertion usage for step parameter ${expectation.parameterName} in "${relativePath}".`
        );
      }
    }
  }
}

console.log('Validating browser names, test-user emails, and step assertion hooks...\n');

try {
  validateSpecAndConceptContent(testsDir);
  validateStepDefinitionAssertions(testsDir);

  if (errors.length > 0) {
    console.error('\n❌ Validation errors found:\n');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error(`\nTotal: ${errors.length} error(s)`);
    process.exit(1);
  }

  console.log('✅ All literal validations passed');
  process.exit(0);
} catch (err) {
  console.error('Error during literal validation:', err);
  process.exit(1);
}
