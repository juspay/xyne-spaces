module.exports = {
  extends: ['@commitlint/config-conventional'],
  parserPreset: {
    parserOpts: {
      headerPattern: /^(\w+):\s+((?:XYNE-\d+)|(?:[A-Z][A-Z0-9]{2,}-\d+)):?\s+(.+)$/i,
      headerCorrespondence: ['type', 'ticket', 'subject']
    }
  },
  plugins: [
    {
      rules: {
        'ticket-required': (parsed) => {
          const { ticket, subject, type, raw } = parsed;
          // Accept both XYNE-1234 (legacy) and PROJECT-1234 or PRO1-1234 (new project-scoped format)
          const ticketRegex = /^(?:XYNE-\d+|[A-Z][A-Z0-9]{2,}-\d+)$/i;
          const validTypes = ['feat', 'feature', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'build', 'ci', 'revert'];

          // Check if everything is correctly parsed
          if (type && ticket && ticketRegex.test(ticket) && subject) {
            return [true];
          }

          // Check if type is invalid
          if (raw && !/^(feat|feature|fix|docs|style|refactor|perf|test|chore|build|ci|revert):/i.test(raw)) {
            return [false, `Invalid or missing type. Must be one of: ${validTypes.join(', ')}`];
          }

          // Check for missing ticket
          if (!raw || !/(?:XYNE-|[A-Z][A-Z0-9]{2,}-)\d+/i.test(raw)) {
            return [false, 'Missing ticket number. Format: type: XYNE-1234 subject OR type: PROJECT-1234: subject'];
          }

          // Check if ticket exists but no subject
          if (/^(feat|feature|fix|docs|style|refactor|perf|test|chore|build|ci|revert):\s+(?:XYNE-|[A-Z][A-Z0-9]{2,}-)\d+:?\s*$/i.test(raw)) {
            return [false, 'Missing subject. Format: type: XYNE-1234 subject OR type: PROJECT-1234: subject (e.g., "fix: XYNE-1234 Fix Jenkins issue")'];
          }

          if (!/^(feat|feature|fix|docs|style|refactor|perf|test|chore|build|ci|revert):\s+(?:XYNE-|[A-Z][A-Z0-9]{2,}-)\d+:?\s+/i.test(raw)) {
            return [false, 'Incorrect format. Use: type: XYNE-1234 subject OR type: PROJECT-1234: subject'];
          }

          return [false, 'Invalid format. Use: type: XYNE-1234 subject OR type: PROJECT-1234: subject'];
        }
      }
    }
  ],
  rules: {
    'subject-empty': [0],
    'type-empty': [0],
    'subject-case': [0],
    'header-max-length': [2, 'always', 200],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    'ticket-required': [2, 'always']
  }
};
