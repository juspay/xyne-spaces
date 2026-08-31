// The singleton is built at import time, so stub what it touches.
const mockGetTicketByXyneId = jest.fn();
const mockFindDuplicatePR = jest.fn();
const mockPostCommitStatus = jest.fn();

jest.mock('@/database/repositories/ticketRepository', () => ({
  TicketRepository: jest.fn().mockImplementation(() => ({
    getTicketByXyneId: mockGetTicketByXyneId,
  })),
}));
jest.mock('@/database/repositories/pullRequestsRepository', () => ({
  PRMetricsRepository: jest.fn().mockImplementation(() => ({
    findDuplicatePR: mockFindDuplicatePR,
  })),
}));
jest.mock('@/bitbucket/apis', () => ({
  BitbucketManager: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@/git-providers/github/apis', () => ({
  githubManager: { postCommitStatus: mockPostCommitStatus },
}));
const mockIsReady = jest.fn(() => false);
const mockGetBooleanValue = jest.fn();
const mockGetStringValue = jest.fn();
jest.mock('@/services/superpositionClient', () => ({
  superpositionClient: {
    isReady: mockIsReady,
    getBooleanValue: mockGetBooleanValue,
    getStringValue: mockGetStringValue,
  },
}));

const mockConfig = {
  enablePrSpecCheck: true,
  specRequiredSections: [
    'Problem statement',
    'Solutioning',
    'Test cases',
    'Implementation details',
  ],
};
jest.mock('@/config/env', () => ({ config: mockConfig }));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
// @xyne/shared ships ESM that jest's transform ignores — stub the imports used.
jest.mock('@xyne/shared', () => ({
  sanitizeProjectCode: (input: string) =>
    input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10),
  isValidProjectCode: (code: string) => code.length >= 2,
  VCSProviderType: { BITBUCKET_SERVER: 'BITBUCKET_SERVER', GITHUB: 'GITHUB' },
}));

import {
  pullRequestValidationService,
  validateSpecSections,
  type BuildStatusTarget,
} from './pullRequestValidationService';

const ALL_SECTIONS = [
  'Problem statement',
  'Solutioning',
  'Test cases',
  'Implementation details',
];

/** Mirrors what /spec writes: a lead description, then the spec block. */
const completeSpec = `Add a GitHub Actions check to validate that PR titles contain a valid ticket ID.

## Specification

### Problem statement

PRs across Juspay repos have no automated gate enforcing ticket IDs.

### Solutioning

A check validating exactly one XYNE- ID per PR title.

### Test cases

1. Valid PR title with existing ticket - the check passes.

### Implementation details

- Implemented as a reusable composite action.
`;

describe('validateSpecSections', () => {
  it('accepts a complete spec', () => {
    expect(validateSpecSections(completeSpec)).toEqual({
      isValid: true,
      missing: [],
      hasSpecHeading: true,
    });
  });

  it('reports the sections that are absent', () => {
    const partial = `## Specification

### Problem statement

Something is broken.

### Solutioning

Fix it.
`;
    expect(validateSpecSections(partial)).toEqual({
      isValid: false,
      missing: ['Test cases', 'Implementation details'],
      hasSpecHeading: true,
    });
  });

  it('rejects a heading with no content under it', () => {
    const empty = completeSpec.replace(
      '- Implemented as a reusable composite action.\n',
      '   \n'
    );
    expect(validateSpecSections(empty).missing).toEqual(['Implementation details']);
  });

  it('flags every section when there is no spec at all', () => {
    const result = validateSpecSections('Just a plain ticket description.');
    expect(result).toEqual({ isValid: false, missing: ALL_SECTIONS, hasSpecHeading: false });
  });

  it('treats an empty or missing description as no spec', () => {
    expect(validateSpecSections('').missing).toEqual(ALL_SECTIONS);
    expect(validateSpecSections('   \n  ').missing).toEqual(ALL_SECTIONS);
    expect(validateSpecSections(null).missing).toEqual(ALL_SECTIONS);
    expect(validateSpecSections(undefined).missing).toEqual(ALL_SECTIONS);
  });

  it('accepts the sections without the wrapper heading', () => {
    const noWrapper = completeSpec.replace('## Specification\n', '');
    const result = validateSpecSections(noWrapper);
    expect(result.isValid).toBe(true);
    expect(result.hasSpecHeading).toBe(false);
  });

  it('accepts sections at the same heading level as Specification', () => {
    const sameLevel = `### Specification

### Problem statement

Broken.

### Solutioning

Fix it.

### Test cases

1. A case.

### Implementation details

Done.
`;
    expect(validateSpecSections(sameLevel).isValid).toBe(true);
  });

  it('accepts sections written as bold labels', () => {
    const bold = `## Specification

**Problem statement**

Broken.

**Solutioning**

Fix it.

**Test cases**

1. A case.

**Implementation details**

Done.
`;
    expect(validateSpecSections(bold).isValid).toBe(true);
  });

  it('matches headings regardless of level, case, bold and trailing punctuation', () => {
    const variants = `# Specification

#### **PROBLEM STATEMENT:**

Broken.

#### solutioning -

Fixed.

#### Test Cases:

One case.

#### *implementation details*

Done.
`;
    expect(validateSpecSections(variants).isValid).toBe(true);
  });

  it('accepts section names written as bare lines, without markdown headings', () => {
    const bare = `Add people to this conversation.

---

Specification

Problem statement
There is no way to add participants while controlling history.

Solutioning
Let the adder pick a history-sharing option.

Test cases
1. Add a participant and check what history they see.

Implementation details
Exact ranges to be confirmed from the implemented design.

Out of scope
- Removing participants.
`;
    expect(validateSpecSections(bare)).toEqual({
      isValid: true,
      missing: [],
      hasSpecHeading: true,
    });
  });

  it('does not open a section from a bare name inside prose or a bullet', () => {
    const prose = `## Specification

### Problem statement

We should document the Test cases somewhere.

- Test cases
- Implementation details
`;
    expect(validateSpecSections(prose).missing).toEqual([
      'Solutioning',
      'Test cases',
      'Implementation details',
    ]);
  });

  it('ignores headings inside fenced code blocks', () => {
    const fenced = `## Specification

### Problem statement

\`\`\`sh
# Test cases
# Solutioning
\`\`\`

### Implementation details

Done.
`;
    expect(validateSpecSections(fenced).missing).toEqual(['Solutioning', 'Test cases']);
  });

  // Trade-off of dropping heading levels: errs towards passing, never towards
  // failing a ticket that has a spec.
  it('counts trailing prose as the last section content', () => {
    const trailing = `## Specification

### Problem statement

Broken.

### Solutioning

Fixed.

### Test cases

One case.

### Implementation details

## Rollout

Ship it on Monday.
`;
    expect(validateSpecSections(trailing).isValid).toBe(true);
  });

  it('still fails a trailing section with nothing after it at all', () => {
    const empty = `## Specification

### Problem statement

Broken.

### Solutioning

Fixed.

### Test cases

One case.

### Implementation details

`;
    expect(validateSpecSections(empty).missing).toEqual(['Implementation details']);
  });

  it('honours a caller-supplied section list', () => {
    const renamed = `Specification

Problem

Broken.

Approach

Fix it.
`;
    expect(validateSpecSections(renamed, ['Problem', 'Approach']).isValid).toBe(true);
    expect(validateSpecSections(renamed).missing).toEqual([
      'Problem statement',
      'Solutioning',
      'Test cases',
      'Implementation details',
    ]);
  });

  it('does not let a same-named heading outside the spec block count', () => {
    const outside = `### Test cases

These are not part of the spec.

## Specification

### Problem statement

Broken.

### Solutioning

Fixed.

### Implementation details

Done.
`;
    expect(validateSpecSections(outside).missing).toEqual(['Test cases']);
  });
});

describe('validatePullRequest spec status', () => {
  // VCSProviderType is stubbed above, so the enum member is the string at runtime.
  const GITHUB_TARGET = {
    provider: 'GITHUB',
    owner: 'juspay',
    repo: 'xyne-spaces',
  } as unknown as BuildStatusTarget;

  /** [context, state, description] of every commit status posted, in order. */
  const postedStatuses = () =>
    mockPostCommitStatus.mock.calls.map(call => [call[4], call[3], call[5]]);

  const validate = (prTitle: string) =>
    pullRequestValidationService.validatePullRequest(
      prTitle,
      690,
      'e229d18474d6677c24d2801cdc8e648f51358c8c',
      'feature/XYNE-56567-spec-check',
      'main',
      'workspace-1',
      'xyne-spaces',
      'https://github.com/juspay/xyne-spaces.git',
      'https://github.com/juspay/xyne-spaces/pull/690',
      0,
      GITHUB_TARGET,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindDuplicatePR.mockResolvedValue(null);
    mockConfig.enablePrSpecCheck = true;
    mockIsReady.mockReturnValue(false);
  });

  const ticketWithoutSpec = () =>
    mockGetTicketByXyneId.mockResolvedValue({
      id: 'cmt1g1qoa0nqwa3vxas6vs9mm',
      status: 'TODO',
      description: 'No spec here at all.',
    });

  it('posts no spec status at all when ENABLE_PR_SPEC_CHECK is off', async () => {
    mockConfig.enablePrSpecCheck = false;
    mockGetTicketByXyneId.mockResolvedValue({
      id: 'cmt1g1qoa0nqwa3vxas6vs9mm',
      status: 'TODO',
      description: 'No spec here at all.',
    });

    await validate('feat: XYNE-56567 add spec validation check');

    expect(postedStatuses()).toEqual([
      ['Ticket Validation', 'success', 'PR validation passed'],
    ]);
  });

  describe('Superposition (CAC) switches', () => {
    it('lets CAC turn the check off even when the env flag is on', async () => {
      mockIsReady.mockReturnValue(true);
      mockGetBooleanValue.mockResolvedValue(false);
      ticketWithoutSpec();

      await validate('feat: XYNE-56567 add spec validation check');

      expect(postedStatuses()).toEqual([
        ['Ticket Validation', 'success', 'PR validation passed'],
      ]);
      expect(mockGetBooleanValue).toHaveBeenCalledWith(
        'pr_spec_check_enabled',
        true,
        expect.objectContaining({ workspaceId: 'workspace-1', repo: 'xyne-spaces' }),
      );
    });

    it('lets CAC turn the check on even when the env flag is off', async () => {
      mockConfig.enablePrSpecCheck = false;
      mockIsReady.mockReturnValue(true);
      mockGetBooleanValue.mockResolvedValue(true);
      mockGetStringValue.mockResolvedValue(mockConfig.specRequiredSections.join(','));
      ticketWithoutSpec();

      await validate('feat: XYNE-56567 add spec validation check');

      expect(postedStatuses()[1]).toEqual([
        'Spec Validation',
        'failure',
        'No specification on XYNE-56567 - run /spec on the ticket',
      ]);
    });

    it('uses the section list CAC supplies', async () => {
      mockIsReady.mockReturnValue(true);
      mockGetBooleanValue.mockResolvedValue(true);
      mockGetStringValue.mockResolvedValue('Problem statement, Solutioning');
      mockGetTicketByXyneId.mockResolvedValue({
        id: 'cmt1g1qoa0nqwa3vxas6vs9mm',
        status: 'TODO',
        // Only the two sections CAC asks for - the default list would fail this.
        description: 'Specification\n\nProblem statement\n\nBroken.\n\nSolutioning\n\nFixed.\n',
      });

      await validate('feat: XYNE-56567 add spec validation check');

      expect(postedStatuses()[1]).toEqual([
        'Spec Validation',
        'success',
        'Specification complete',
      ]);
    });

    it('falls back to the env config when CAC throws', async () => {
      mockIsReady.mockReturnValue(true);
      mockGetBooleanValue.mockRejectedValue(new Error('superposition down'));
      ticketWithoutSpec();

      await validate('feat: XYNE-56567 add spec validation check');

      expect(postedStatuses()[1]).toEqual([
        'Spec Validation',
        'failure',
        'No specification on XYNE-56567 - run /spec on the ticket',
      ]);
    });
  });

  it('posts both checks green when the ticket carries a full spec', async () => {
    mockGetTicketByXyneId.mockResolvedValue({
      id: 'cmt1g1qoa0nqwa3vxas6vs9mm',
      status: 'TODO',
      description: completeSpec,
    });

    await validate('feat: XYNE-56567 add spec validation check');

    expect(postedStatuses()).toEqual([
      ['Ticket Validation', 'success', 'PR validation passed'],
      ['Spec Validation', 'success', 'Specification complete'],
    ]);
  });

  it('fails only the spec check when the ticket has no spec', async () => {
    mockGetTicketByXyneId.mockResolvedValue({
      id: 'cmt1g1qoa0nqwa3vxas6vs9mm',
      status: 'TODO',
      description: 'Add a check. No spec written yet.',
    });

    await validate('feat: XYNE-56567 add spec validation check');

    expect(postedStatuses()).toEqual([
      ['Ticket Validation', 'success', 'PR validation passed'],
      ['Spec Validation', 'failure', 'No specification on XYNE-56567 - run /spec on the ticket'],
    ]);
  });

  it('names the missing sections on a partial spec', async () => {
    mockGetTicketByXyneId.mockResolvedValue({
      id: 'cmt1g1qoa0nqwa3vxas6vs9mm',
      status: 'TODO',
      description: '## Specification\n\n### Problem statement\n\nBroken.\n',
    });

    await validate('feat: XYNE-56567 add spec validation check');

    expect(postedStatuses()[1]).toEqual([
      'Spec Validation',
      'failure',
      'XYNE-56567 spec missing: Solutioning, Test cases, Implementation details',
    ]);
  });

  // A never-posted required check leaves the PR waiting on it forever.
  it('still posts the spec check when the title has no ticket', async () => {
    await validate('random title with no ticket');

    expect(postedStatuses()).toEqual([
      ['Ticket Validation', 'failure', expect.stringContaining('PR title must format')],
      ['Spec Validation', 'pending', 'Ticket not resolved - spec not checked'],
    ]);
  });

  it('still posts the spec check when the ticket does not exist', async () => {
    mockGetTicketByXyneId.mockResolvedValue(null);

    await validate('feat: XYNE-99999 nonexistent');

    expect(postedStatuses()).toEqual([
      ['Ticket Validation', 'failure', 'Ticket XYNE-99999 does not exist'],
      ['Spec Validation', 'pending', 'Ticket not resolved - spec not checked'],
    ]);
  });

  it('still posts the spec check when validation throws', async () => {
    mockGetTicketByXyneId.mockRejectedValue(new Error('db down'));

    await validate('feat: XYNE-56567 add spec validation check');

    expect(postedStatuses()).toEqual([
      ['Ticket Validation', 'failure', 'Internal error during PR validation'],
      ['Spec Validation', 'pending', 'Ticket not resolved - spec not checked'],
    ]);
  });

  it('reports the spec independently of a resolved-ticket failure', async () => {
    mockGetTicketByXyneId.mockResolvedValue({
      id: 'cmt1g1qoa0nqwa3vxas6vs9mm',
      status: 'RESOLVED',
      description: completeSpec,
    });

    await validate('feat: XYNE-56567 add spec validation check');

    expect(postedStatuses()).toEqual([
      ['Ticket Validation', 'failure', 'Ticket XYNE-56567 is already resolved'],
      ['Spec Validation', 'success', 'Specification complete'],
    ]);
  });
});
