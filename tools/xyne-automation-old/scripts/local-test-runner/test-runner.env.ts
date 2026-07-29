import { git } from '@/scripts/local-test-runner/test-runner.helpers';
import { EnvSetup } from '@/scripts/local-test-runner/test-runner.types';

export function setupEnv(): EnvSetup {
  const branchName = process.env.BRANCH_NAME || git('rev-parse --abbrev-ref HEAD');
  const sanitizedBranch = branchName
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 30)
    .toLowerCase();

  const executorNumber = process.env.EXECUTOR_NUMBER || '0';
  const buildNumber = process.env.BUILD_NUMBER || Math.floor(Date.now() / 1000).toString();

  const composeProjectName = `xyne-test-${sanitizedBranch}-${executorNumber}-${buildNumber}`;
  const failedStage = process.env.STAGE_NAME || '';

  return { composeProjectName, failedStage };
}
