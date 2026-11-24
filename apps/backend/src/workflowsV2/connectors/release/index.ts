import { BaseConnector } from '@xyne/workflow-sdk';
import type { AnyStep } from '@xyne/workflow-sdk';
import { GetReleaseConfigurationStep } from './steps/get-release-configuration.step';
import { UpdateDeployedCommitStep } from './steps/update-deployed-commit.step';
import { LinkReleaseNotesStep } from './steps/link-release-notes.step';
import { AnalyseReleaseStep } from './steps/analyse-release.step';
import { WriteReleaseStep } from './steps/write-release.step';
import { BuildReleaseReportStep } from './steps/build-release-report.step';

export class ReleaseConnector extends BaseConnector {
  readonly id = 'release';
  readonly version = '1.0.0';
  readonly name = 'Release';
  readonly description = 'Steps that work on a release';
  readonly icon = 'rocket';
  readonly credentials = [];
  readonly triggers = [];

  readonly steps: readonly AnyStep[] = [
    new GetReleaseConfigurationStep(),
    new UpdateDeployedCommitStep(),
    new LinkReleaseNotesStep(),
    new AnalyseReleaseStep(),
    new WriteReleaseStep(),
    new BuildReleaseReportStep(),
  ];
}
