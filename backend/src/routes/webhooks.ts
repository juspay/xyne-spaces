import { Router, Request, Response } from 'express';
import { PRMetricsRepository } from "../database/repositories/pullRequestsRepository.js";
import {logger} from '@/utils/logger';

const router = Router();
const prMetricsRepo = new PRMetricsRepository();

export interface BitbucketWebhook {
    pullrequest: {
        comment_count: number
        state: 'MERGE' | 'OPEN' | 'DECLINED' | string
        source: {
            branch: {
                name: string
            }
        },
        destination: {
            branch: {
                name: string
            }
        },
        id: number,
        links: {
            html: {
                href: string
            }
        },
    }
    repository: {
        full_name: string,
        name: string
        project: {
            key: string
        }
    }
}

async function handleBitbucketWebhook(req: Request, res: Response): Promise<void> {
    try {
        const data: BitbucketWebhook = req.body;
        if (!data) {
            res.status(400).json({
                success: false,
                error: 'No data provided'
            });
            return;
        }
        const isPr = 'pullrequest' in data;

        if (isPr) {
            const pr = data.pullrequest;
            const sourceBranchName: string = pr.source.branch.name;
            const destinationBranchName: string = pr.destination.branch.name
            const repoName = 'repository' in data ? data.repository.name : 'undefined';
            const prUrl = pr.links.html.href
            const prId = pr.id
            const numberOfComments = pr.comment_count
            const projectName = data.repository.project.key
            const repoUrl = `ssh://git@github.com/example-org/${repoName}.git`.toLowerCase()
            const prArgs = {
                repoName,
                sourceBranchName,
                destinationBranchName,
                prId,
                prUrl,
                repoUrl,
                numberOfComments
            }
            if (pr.state === 'MERGED') {
                const result = await prMetricsRepo.markMergedPr(prArgs);
                if (result) {
                    logger.info(`✅ Updated Xyne PR to MERGED: ${prUrl}`);
                } else {
                    logger.info(`ℹ️ Ignored manual PR webhook: ${prUrl} (not created by Xyne)`);
                }
            } else if (pr.state === 'DECLINED') {
                const result = await prMetricsRepo.markDeclinedPr(prArgs);
                if (result) {
                    logger.info(`✅ Updated Xyne PR to DECLINED: ${prUrl}`);
                } else {
                    logger.info(`ℹ️ Ignored manual PR webhook: ${prUrl} (not created by Xyne)`);
                }
            }
            // Ignore open PRs webhooks. If it is raised through xyne spaces, then it will be inserted into db when it is raised. So, safe to ignore that webhook and no need of other open prs.
            // else if (pr.state === 'OPEN' && 'destination' in pr) {
            //     prMetricsRepo.markOrCreateOpenPr(prArgs)
            // } 

        }

        res.status(200).json({
            success: true,
            message: 'Webhook received successfully'
        });
    } catch (error) {
        logger.error('Error processing webhook:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process webhook'
        });
    }
}

// Get bitbucket webhook via bitbot
router.post('/bitbucket', handleBitbucketWebhook);


export default router;
