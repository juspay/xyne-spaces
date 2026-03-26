import { z } from 'zod';
import {
  WorkflowEngine,
  AgenticCheckpointConfig,
  BaseWorkflowContext,
  LoopControl,
} from '../../workflow-types';
import { WorkflowDefinition } from '../../registry/workflowRegistry';
import { WorkflowType } from '../../types/workflow-enums';
import { logger } from '@/utils/logger';
import { slackService } from '@/services/slackService';
import { promisify } from 'util';
import { exec } from 'child_process';
import { cloneRepository } from '@framework';

const execAsync = promisify(exec);

function parseRepoUrl(repoUrl: string): { projectKey: string; repoSlug: string } {
  let match = repoUrl.match(/bitbucket\.juspay\.net\/scm\/([^/]+)\/([^.]+)\.git/);
  if (match) {
    return { projectKey: match[1], repoSlug: match[2] };
  }

  match = repoUrl.match(/ssh\.bitbucket\.juspay\.net\/([^/]+)\/([^.]+)\.git/);
  if (match) {
    return { projectKey: match[1], repoSlug: match[2] };
  }
  throw new Error('Invalid repo URL: ' + repoUrl);
}

function normalizeFilePath(filePath: string): string {
  const tempMatch = filePath.match(/\/tmp\/[a-zA-Z0-9]+\/(.+)/);
  if (tempMatch) {
    return tempMatch[1];
  }

  const privateTempMatch = filePath.match(/\/private\/tmp\/[a-zA-Z0-9]+\/(.+)/);
  if (privateTempMatch) {
    return privateTempMatch[1];
  }
  return filePath;
}

export enum JUtilsPropagationSteps {
  CLONE_REPO = 'CLONE_REPO',
  GET_DIFF = 'GET_DIFF',
  PARSE_CHANGED_FUNCTIONS = 'PARSE_CHANGED_FUNCTIONS',
  SCAN_ALL_FILES = 'SCAN_ALL_FILES',
  ANALYZE_FILE = 'ANALYZE_FILE',
  APPLY_CHANGE = 'APPLY_CHANGE',
  VERIFY_R_SYNTAX = 'VERIFY_R_SYNTAX',
  FIX_R_ERRORS = 'FIX_R_ERRORS',
  COMMIT_AND_PR = 'COMMIT_AND_PR',
}

export interface JUtilsPropagationContext extends BaseWorkflowContext {
  repoUrl: string;
  commitHash: string;
  targetBranch: string;
  baseBranch?: string;
  userContext?: string;
}

export interface JUtilsPropagationOutput {
  changedFunctions: string;
  usageFiles: string;
  results: string;
}

export interface JUtilsPropagationPreExecuteResult {
  hasChanges: boolean;
}

const JUtilsPropagationInputSchema = z.object({
  repoUrl: z.string().url(),
  commitHash: z.string(),
  baseBranch: z.string(),
  targetBranch: z.string().optional(),
  modelName: z.string().optional(),
  userContext: z.string().optional(),
});

function jUtilsPropagationContextMapper(
  payload: z.infer<typeof JUtilsPropagationInputSchema>
): JUtilsPropagationContext {
  return {
    ticketId: payload.repoUrl + '-' + payload.commitHash,
    repoUrl: payload.repoUrl,
    commitHash: payload.commitHash,
    targetBranch: payload.targetBranch || '',
    baseBranch: payload.baseBranch,
    modelName: payload.modelName,
    userContext: payload.userContext,
  };
}

function createParseFunctionsConfig(
  repoUrl: string,
  repoBranch: string,
  baseBranch: string,
  diffContent: string
): AgenticCheckpointConfig {
  return {
    conversationContext: {
      initialUserMessage: `Analyze the following git diff and identify all changed functions in the jUtils folder. 
For each changed function, provide:
1. functionName
2. changeSummary

DIFF:
\`\`\`
${diffContent}
\`\`\`

CRITICAL: Return ONLY a JSON array with objects containing exactly these keys: "functionName" and "changeSummary". No explanation, no markdown code blocks, just raw JSON starting with [ and ending with ].`,
    },
    repoInfo: {
      repoUrl,
      repoBranch,
      baseBranch,
    },
  };
}

function createScanAllFilesConfig(
  repoUrl: string,
  repoBranch: string,
  baseBranch: string,
  changedFunctions: string,
  userContext?: string
): AgenticCheckpointConfig {
  const userInstructionSection = userContext ? `\n\n## USER INSTRUCTIONS:\n${userContext}` : '';
  
  return {
    conversationContext: {
      initialUserMessage: `## SCANNING MODE:
SCAN ALL R/Rmd files in the repository (exclude jUtils folder)

## CHANGED JUTILS FUNCTIONS:
${changedFunctions}${userInstructionSection}
##Note : 
If user mentions to check or update specific files scan only those files else scan all the files
## OUTPUT FORMAT:
Return ONLY valid JSON array starting with [ and ending with ]:
[{"filePath": "...", "needsChange": true, "reason": "..."}]`,
    },
    repoInfo: {
      repoUrl,
      repoBranch,
      baseBranch,
    },
  };
}

function createAnalyzeUsageConfig(
  repoUrl: string,
  repoBranch: string,
  baseBranch: string,
  functionSignatures: string,
  filePath: string,
  userContext?: string
): AgenticCheckpointConfig {
  const userInstructionSection = userContext 
    ? `\n\n## USER INSTRUCTIONS (IMPORTANT):\n${userContext}\n\nFollow these instructions when analyzing the file.`
    : '';

  return {
    conversationContext: {
      initialUserMessage: `Analyze the file "${filePath}" to determine if it needs updates due to jUtils function signature changes.

Changed function signatures:
${functionSignatures}${userInstructionSection}

Instructions:
1. Read the file thoroughly - understand the full context
2. Find all places that might need changes:
   - Direct calls to changed jUtils functions
   - Any patterns mentioned in user instructions 
   - Variables, comments, configs related to the changes
3. Determine what changes are needed based on jUtils changes AND user instructions
4. Be COMPREHENSIVE - don't miss anything

CRITICAL: Return ONLY a JSON object with keys: needsChange (boolean), reason (string), suggestedChange (string, optional). No explanation, no markdown code blocks, just raw JSON starting with { and ending with }.`,
    },
    repoInfo: {
      repoUrl,
      repoBranch,
      baseBranch,
    },
  };
}

function createApplyChangeConfig(
  repoUrl: string,
  repoBranch: string,
  baseBranch: string,
  filePath: string,
  analysisResult: string,
  userContext?: string
): AgenticCheckpointConfig {
  const userInstructionSection = userContext 
    ? `\n\n## USER INSTRUCTIONS (IMPORTANT):\n${userContext}\n\nFollow these instructions when applying changes.`
    : '';

  return {
    conversationContext: {
      initialUserMessage: `## CRITICAL: MODIFY ONLY "${filePath}" - DO NOT TOUCH ANY OTHER FILE!

Apply the necessary changes to "${filePath}" based on the following analysis:

${analysisResult}${userInstructionSection}

Instructions:
1. Read the current file "${filePath}" thoroughly
2. Make ALL required changes based on the analysis AND user instructions
3. Apply changes ONLY to "${filePath}" - do not create or modify any other file
4. Write the updated "${filePath}" file
5. After making changes, run R syntax check: Rscript -e "parse(file='${filePath}')"

Make sure the changes are correct and follow R coding conventions.`,
    },
    repoInfo: {
      repoUrl,
      repoBranch,
      baseBranch,
    },
  };
}

function createFixErrorConfig(
  repoUrl: string,
  repoBranch: string,
  baseBranch: string,
  filePath: string,
  errorMessage: string
): AgenticCheckpointConfig {
  return {
    conversationContext: {
      initialUserMessage: `Fix the syntax error in "${filePath}":

Error from R parser:
${errorMessage}

Instructions:
1. Read the current file
2. Fix the syntax error
3. Write the updated file

Make sure the R code is valid and can be parsed without errors.`,
    },
    repoInfo: {
      repoUrl,
      repoBranch,
      baseBranch,
    },
  };
}

const verifyRSyntax = async (
  repoPath: string,
  filePath: string
): Promise<{ success: boolean; error?: string }> => {
  const isRmd = filePath.toLowerCase().endsWith('.rmd');
  
  try {
    let command: string;
    if (isRmd) {
      command = `Rscript -e "rmarkdown::render('${filePath}', quiet=TRUE, render=FALSE)"`;
    } else {
      command = `Rscript -e "parse(file='${filePath}')"`;
    }
    
    const { stdout, stderr } = await execAsync(
      command,
      { cwd: repoPath, timeout: 60000 }
    )
    
    const hasError = stderr?.includes("Error") || stdout?.includes("Error") || stdout?.includes("error")
    return { 
      success: !hasError, 
      error: hasError ? (stderr || stdout) : undefined,
    }
  } catch (error: any) {
    const errorMsg = error.message || '';
    if (isRmd && (errorMsg.includes('render') || errorMsg.includes('rmarkdown'))) {
      return { success: true, error: undefined };
    }
    return { success: false, error: errorMsg }
  }
}

export const jUtilsCodeUpdationWorkflow: WorkflowDefinition<
  JUtilsPropagationContext,
  JUtilsPropagationOutput,
  typeof JUtilsPropagationSteps,
  JUtilsPropagationPreExecuteResult
> = {
  type: WorkflowType.JUTILS_CODE_UPDATION,
  name: 'jUtils Workflow',
  description: 'Automatically update jUtils function usages across the codebase',
  inputSchema: JUtilsPropagationInputSchema,
  contextMapper: jUtilsPropagationContextMapper,
  async execute(
    engine: WorkflowEngine<JUtilsPropagationContext, typeof JUtilsPropagationSteps>,
    preExecuteResult: JUtilsPropagationPreExecuteResult
  ): Promise<JUtilsPropagationOutput> {
    const context = engine.getContext();
    const { repoUrl, commitHash, baseBranch = 'staging', userContext } = context;

    const sourceBranch = baseBranch;
    const featureBranch = `jutils-propagation-${engine.getWorkflowExecutionId()}`;

    logger.info('[JUTILS_CODE_UPDATION] Starting workflow', {
      repoUrl,
      commitHash,
      featureBranch,
      sourceBranch,
    });

    const cloneResult = await engine.createCheckpoint(
      JUtilsPropagationSteps.CLONE_REPO,
      async () => {
        try {
          const result = await cloneRepository(
            repoUrl,
            engine.getWorkflowExecutionId(),
            sourceBranch,
            featureBranch
          );
          logger.info(`[JUTILS_CODE_UPDATION] Cloned repo to ${result.repoPath}`);
          return { success: true, workspacePath: result.repoPath };
        } catch (error) {
          logger.error(`[JUTILS_CODE_UPDATION] Clone failed:`, error);
          return { success: false, error: String(error) };
        }
      }
    );

    if (!cloneResult.success) {
      return {
        changedFunctions: '[]',
        usageFiles: '[]',
        results: JSON.stringify({ message: 'Clone failed', error: cloneResult.error }),
      };
    }

    const diffContent = await engine.createCheckpoint(JUtilsPropagationSteps.GET_DIFF, async () => {
      try {
        const { stdout } = await execAsync(`git diff ${commitHash}^..${commitHash} -- jUtils/`, {
          cwd: cloneResult.workspacePath,
        });
        return stdout || 'NO_CHANGES';
      } catch (error) {
        logger.warn(`[JUTILS_CODE_UPDATION] Git diff failed:`, error);
        return 'NO_CHANGES';
      }
    });

    const hasChanges = diffContent.trim().length > 0 && diffContent !== 'NO_CHANGES';

    logger.info('[JUTILS_CODE_UPDATION] Diff result', {
      hasChanges,
      diffLength: diffContent.length,
    });

    if (!preExecuteResult.hasChanges || !hasChanges) {
      logger.info('[JUTILS_CODE_UPDATION] No jUtils changes detected, exiting');
      return {
        changedFunctions: '[]',
        usageFiles: '[]',
        results: JSON.stringify({ message: 'No jUtils changes detected' }),
      };
    }

    const parseResult = await engine.createAgenticCheckpoint(
      JUtilsPropagationSteps.PARSE_CHANGED_FUNCTIONS,
      'r-code-analyzer',
      createParseFunctionsConfig(repoUrl, featureBranch, sourceBranch, diffContent)
    );

    const parseOutput =
      parseResult.result.messages[parseResult.result.messages.length - 1]?.content || '[]';
    const changedFunctions = parseOutput;

    logger.info('[JUTILS_CODE_UPDATION] Changed functions parsed', { changedFunctions });

    let functionNames: string[] = [];
    let changedFunctionsParsed: any[] = [];
    try {
      const parsed = JSON.parse(changedFunctions);
      changedFunctionsParsed = Array.isArray(parsed) ? parsed : [parsed];
      functionNames = changedFunctionsParsed
        .map(
          (f) =>
            f.functionName ||
            (f as any)['function name'] ||
            (f as any)['Function name'] ||
            f.name ||
            ''
        )
        .filter(Boolean);
    } catch (error) {
      logger.error('[JUTILS_CODE_UPDATION] Failed to parse changed functions response as JSON', {
        changedFunctions,
        error,
      });
      functionNames = [];
    }

    const scanResult = await engine.createAgenticCheckpoint(
      JUtilsPropagationSteps.SCAN_ALL_FILES,
      'r-code-scanner',
      createScanAllFilesConfig(repoUrl, featureBranch, sourceBranch, changedFunctions, userContext)
    );

    const scanOutput =
      scanResult.result.messages[scanResult.result.messages.length - 1]?.content || '[]';
    let filesToUpdate: Array<{ filePath: string; needsChange: boolean; reason: string }> = [];
    try {
      let jsonStr = scanOutput.trim();

      const firstBracket = jsonStr.indexOf('[');
      const lastBracket = jsonStr.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket >= firstBracket) {
        jsonStr = jsonStr.substring(firstBracket, lastBracket + 1);
      } else {
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
          jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
        }
      }

      const parsed = JSON.parse(jsonStr);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      filesToUpdate = items
        .filter((f: any) => f && (f.needsChange === true || f.needsUpdate === true))
        .map((f: any) => {
          const filePath = f.filePath || f.findings?.[0]?.location?.split(':')?.[0] || '';
          return {
            needsChange: f.needsChange ?? f.needsUpdate ?? false,
            reason: f.reason || f.analysis || '',
            filePath: normalizeFilePath(filePath),
          };
        })
        .filter((f: any) => f.filePath);
    } catch (error) {
      logger.error('[JUTILS_CODE_UPDATION] Failed to parse scan response as JSON', {
        scanOutput: scanOutput.substring(0, 200),
        error,
      });
    }

    if (functionNames.length === 0 && filesToUpdate.length === 0) {
      logger.info('[JUTILS_CODE_UPDATION] No changes needed, exiting');
      return {
        changedFunctions: '[]',
        usageFiles: '[]',
        results: JSON.stringify({ message: 'No changes needed based on jUtils updates' }),
      };
    }

    logger.info('[JUTILS_CODE_UPDATION] Files to update from scan', {
      count: filesToUpdate.length,
    });

    const uniqueFilesToUpdate = filesToUpdate.filter((file, index, self) => {
      const normalizedPath = file.filePath.toLowerCase();
      return index === self.findIndex((f) => f.filePath.toLowerCase() === normalizedPath);
    });
    logger.info('[JUTILS_CODE_UPDATION] Deduplicated files to update', {
      original: filesToUpdate.length,
      unique: uniqueFilesToUpdate.length,
    });

    const { projectKey, repoSlug } = parseRepoUrl(repoUrl);
    const prResults: Array<{ filePath: string; branch: string; prUrl?: string; status: string }> =
      [];
    const processedFiles = new Set<string>();

    await engine.createWhileLoop(
      JUtilsPropagationSteps.ANALYZE_FILE,
      uniqueFilesToUpdate.length,
      async (iteration, scopedEngine) => {
        const file = uniqueFilesToUpdate[iteration];

        if (processedFiles.has(file.filePath)) {
          logger.info(`[JUTILS_CODE_UPDATION] Skipping already processed file: ${file.filePath}`);
          return LoopControl.CONTINUE;
        }
        processedFiles.add(file.filePath);

        const fileName = file.filePath.split('/').pop() || file.filePath;
        const baseName = fileName.replace(/\.R$/, '').replace(/\.Rmd$/, '');
        const uniqueId = `${engine.getWorkflowExecutionId()}-${iteration}`;
        const branchName = `auto/jUtils-fix-${baseName}-${uniqueId}`;

        logger.info(
          `[JUTILS_CODE_UPDATION] Processing file ${iteration + 1}/${uniqueFilesToUpdate.length}: ${file.filePath} on branch ${branchName}`
        );

        const workspacePathForGit = `/tmp/${scopedEngine.getWorkflowExecutionId()}`;

        try {
          await execAsync('git checkout -- .', { cwd: workspacePathForGit });
          await execAsync('git clean -fd', { cwd: workspacePathForGit });
          await execAsync(`git checkout -b ${branchName} origin/${sourceBranch}`, {
            cwd: workspacePathForGit,
          });
          logger.info(
            `[JUTILS_CODE_UPDATION] Created branch ${branchName} from origin/${sourceBranch}`
          );
        } catch (e) {
          try {
            await execAsync(`git checkout ${branchName}`, { cwd: workspacePathForGit });
            logger.info(`[JUTILS_CODE_UPDATION] Switched to existing branch: ${branchName}`);
          } catch (e2) {
            logger.warn(`[JUTILS_CODE_UPDATION] Git branch switch warning: ${e2}`);
          }
        }

        const analysisResult = await scopedEngine.createAgenticCheckpoint(
          JUtilsPropagationSteps.ANALYZE_FILE,
          'r-code-analyzer',
          createAnalyzeUsageConfig(
            repoUrl,
            branchName,
            sourceBranch,
            changedFunctions,
            file.filePath,
            userContext
          )
        );

        const analysisOutput =
          analysisResult.result.messages[analysisResult.result.messages.length - 1]?.content ||
          '{}';
        let analysis: {
          needsChange: boolean;
          reason: string;
          suggestedChange?: string;
          findings?: any[];
        };
        try {
          analysis = JSON.parse(analysisOutput);

          if (analysis.findings && analysis.findings.length > 0 && !analysis.suggestedChange) {
            const changes = analysis.findings
              .filter((f: any) => f.required && f.required !== 'N/A')
              .map((f: any) => `${f.location}: ${f.current} → ${f.required}`)
              .join('\n');
            analysis.suggestedChange = changes || 'Review findings and apply necessary changes';
          }
        } catch {
          analysis = { needsChange: false, reason: 'Failed to parse analysis' };
        }

        if (!analysis.needsChange) {
          logger.info(
            `[JUTILS_CODE_UPDATION] No changes needed for ${file.filePath}, reason: ${analysis.reason}`
          );
          prResults.push({ filePath: file.filePath, branch: branchName, status: 'skipped' });
          return LoopControl.CONTINUE;
        }

        logger.info(
          `[JUTILS_CODE_UPDATION] Analysis for ${file.filePath}: needsChange=${analysis.needsChange}, suggestedChange=${analysis.suggestedChange?.substring(0, 200)}`
        );

        try {
          const workspacePath = `/tmp/${scopedEngine.getWorkflowExecutionId()}`;
          logger.info(`[JUTILS_CODE_UPDATION] Workspace path: ${workspacePath}`);
          let syntaxValid = false;
          let fixAttempts = 0;
          const maxFixAttempts = 3;
          let lastError = '';
          let fixerResult: any = null;

          while (!syntaxValid && fixAttempts < maxFixAttempts) {
            const config =
              fixAttempts === 0
                ? createApplyChangeConfig(
                    repoUrl,
                    branchName,
                    sourceBranch,
                    file.filePath,
                    analysis.suggestedChange || '',
                    userContext
                  )
                : createFixErrorConfig(repoUrl, branchName, sourceBranch, file.filePath, lastError);

            logger.info(`[JUTILS_CODE_UPDATION] Calling fixer, attempt ${fixAttempts + 1}`);

            fixerResult = await scopedEngine.createAgenticCheckpoint(
              fixAttempts === 0
                ? JUtilsPropagationSteps.APPLY_CHANGE
                : JUtilsPropagationSteps.FIX_R_ERRORS,
              'r-code-fixer',
              config
            );

            const verifyResult = await scopedEngine.createCheckpoint(
              JUtilsPropagationSteps.VERIFY_R_SYNTAX,
              verifyRSyntax,
              workspacePath,
              file.filePath
            );

            if (verifyResult.success) {
              syntaxValid = true;
            } else {
              fixAttempts++;
              lastError = verifyResult.error || 'Unknown error';
              logger.info(
                `[JUTILS_CODE_UPDATION] Syntax check failed, attempt ${fixAttempts}/${maxFixAttempts}: ${lastError}`
              );
            }
          }

          if (!syntaxValid) {
            logger.error(
              `[JUTILS_CODE_UPDATION] Failed to fix syntax after ${maxFixAttempts} attempts for ${file.filePath}: ${lastError}`
            );
            prResults.push({ filePath: file.filePath, branch: branchName, status: 'failed' });
            return LoopControl.CONTINUE;
          }

          const changedFiles =
            fixerResult?.result?.messages?.[0]?.toolCalls
              ?.filter((tc: any) => ['write', 'edit'].includes(tc.name))
              ?.map((tc: any) => tc.input?.filePath)
              ?.filter(Boolean) || [];

          logger.info(`[JUTILS_CODE_UPDATION] Files modified by fixer:`, changedFiles);
          logger.info(`[JUTILS_CODE_UPDATION] Expected file: ${file.filePath}`);

          if (changedFiles.length > 1) {
            logger.warn(
              `[JUTILS_CODE_UPDATION] FIXER MODIFIED ${changedFiles.length} FILES! Expected only 1. Files: ${JSON.stringify(changedFiles)}`
            );
          }

          try {
            const { stdout: gitStatusAfter } = await execAsync('git status --porcelain', {
              cwd: workspacePathForGit,
            });
            const { stdout: gitLog } = await execAsync('git log --oneline -5', {
              cwd: workspacePathForGit,
            });
            const { stdout: filesInLastCommit } = await execAsync(
              'git diff --name-only HEAD~1 HEAD',
              { cwd: workspacePathForGit }
            );
            logger.info(
              `[JUTILS_CODE_UPDATION] Git status AFTER processing ${file.filePath}:\n${gitStatusAfter || '(clean)'}`
            );
            logger.info(`[JUTILS_CODE_UPDATION] Recent commits on ${branchName}:\n${gitLog}`);
            logger.info(
              `[JUTILS_CODE_UPDATION] Files in last commit: ${filesInLastCommit || 'N/A'}`
            );
          } catch (e) {
            logger.warn(`[JUTILS_CODE_UPDATION] Could not check git status: ${e}`);
          }

          console.log(fixerResult);

          logger.info(`[JUTILS_CODE_UPDATION] Fixer result gitInfo:`, fixerResult?.gitInfo);

          const prUrl = fixerResult.gitInfo?.pullRequestUrl || fixerResult.gitInfo?.pr_link;
          const prStatus: 'created' | 'failed' = prUrl ? 'created' : 'failed';

          const finalPrUrl =
            prUrl ||
            `https://bitbucket.example.com/projects/${projectKey}/repos/${repoSlug}/pull-requests?create=&targetBranch=${sourceBranch}&sourceBranch=${branchName}`;

          prResults.push({
            filePath: file.filePath,
            branch: branchName,
            prUrl: finalPrUrl,
            status: prStatus,
          });

          logger.info(`[JUTILS_CODE_UPDATION] Processed ${file.filePath}: ${prStatus}`);
        } catch (error) {
          logger.error(`[JUTILS_CODE_UPDATION] Failed to process ${file.filePath}:`, error);
          prResults.push({ filePath: file.filePath, branch: branchName, status: 'failed' });
        }

        return LoopControl.CONTINUE;
      }
    );
    console.log(prResults);

    const successfulPRs = prResults.filter((r) => r.status === 'created');
    const failedPRs = prResults.filter((r) => r.status === 'failed');

    logger.info('[JUTILS_CODE_UPDATION] Workflow completed', {
      total: prResults.length,
      created: successfulPRs.length,
      failed: failedPRs.length,
    });

    const slackChannel = process.env.JUTILS_SLACK_CHANNEL || '#workflow-discussion';

    let changedFunctionsDetails = '';
    if (changedFunctionsParsed.length > 0) {
      changedFunctionsDetails = changedFunctionsParsed
        .map((f: any) => {
          const name =
            f.functionName ||
            (f as any)['function name'] ||
            (f as any)['Function name'] ||
            f.name ||
            'Unknown';
          const summary = f.changeSummary || f.summary || f.description || 'Updated';
          return `• *${name}*\n  Change: ${summary}`;
        })
        .join('\n');
    } else {
      changedFunctionsDetails = functionNames.map((fn) => `• ${fn}`).join('\n');
    }

    const prLinks = successfulPRs.map((pr) => `• <${pr.prUrl}|${pr.filePath}>`).join('\n');
    const failedLinks = failedPRs.map((pr) => `• ${pr.filePath} (${pr.status})`).join('\n');

    const slackMessage = `🔄 *jUtils Code Updation Complete*

*📝 Changed jUtils Functions:*
${changedFunctionsDetails}

*📊 Summary:*
• Files Analyzed: ${prResults.length}
• PRs Created: ${successfulPRs.length}
• Failed: ${failedPRs.length}
• Repository: \`${repoSlug}\`
• Base Branch: \`${sourceBranch}\`

${prLinks ? `*✅ Created PRs:*\n${prLinks}` : ''}

${failedLinks ? `*❌ Failed Files:*\n${failedLinks}` : ''}
Please review the PRs and merge after approval.`;

    try {
      await slackService.sendMessage(slackChannel, slackMessage);
      logger.info('[JUTILS_CODE_UPDATION] Slack notification sent to ' + slackChannel);
    } catch (err) {
      logger.error('[JUTILS_CODE_UPDATION] Failed to send Slack notification', err);
    }

    return {
      changedFunctions,
      usageFiles: JSON.stringify(filesToUpdate),
      results: JSON.stringify({
        analyzedFiles: prResults.length,
        createdPRs: successfulPRs.length,
        failedPRs: failedPRs.length,
        prResults,
      }),
    };
  },
};
