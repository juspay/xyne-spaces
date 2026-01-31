// XYNE-1287: Quarto docs are now stored as Canvas records with docType='Quarto'
// Docs are scoped by channelId instead of projectId

import { Request, Response } from 'express';
import { docsService } from '@/services/docsService.js';
import { logger } from '@/utils/logger.js';


// XYNE-1287: Parse userRepo path from URL
// Format: org/repo/branch (3+ parts) or repo/branch (2 parts) where branch can contain slashes
function parseQuartoRepoPath(path: string): string | null {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const parts = cleanPath.split('/');
    
    if (parts.length < 2) {
        return null;
    }

    // XYNE-1287 Decode and validate each part to prevent path traversal attacks
    const decodedParts: string[] = [];
    for (const part of parts) {
        const decoded = decodeURIComponent(part);
        if (decoded.includes('..') || decoded.includes('\0') || decoded.includes('\\')) {
            logger.warn(`Path traversal attempt detected in docs path: ${path}`);
            return null;
        }
        decodedParts.push(decoded);
    }

    // Combine all parts into quartoRepo format: org/repo/branch or repo/branch
    return decodedParts.join('/');
}

export class DocsController {

    publishDocs = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.user?.id;

            if (!userId) {
                res.status(403).json({ error: 'Unauthorized - user not authenticated' });
                return;
            }

            const file = req.file;

            if (!file) {
                res.status(400).json({ error: 'No zip file provided' });
                return;
            }

            const { quartoRepo, userRepo: userRepoField, repoId, branchName, repoUrl, channelId, title, entryFile, docType: quartoDocumentType } = req.body;
            const userRepo = userRepoField || quartoRepo;

            logger.info(`[DocsController] publishDocs received - userRepo: "${userRepo}", quartoRepo: "${quartoRepo}", userRepoField: "${userRepoField}"`);

            if (!userRepo) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'userRepo is required (format: org/repo/branch)',
                });
                return;
            }

            const parsed = docsService.parseQuartoRepo(userRepo);
            if (!parsed) {
                res.status(400).json({
                    error: 'Invalid userRepo format',
                    message: 'userRepo must be in format: org/repo/branch',
                });
                return;
            }

            // Build base URL from x-original-host header (set by reverse proxy) or FRONTEND_URL
            let baseUrl: string;
            const originalHost = req.headers['x-original-host'];
            if (originalHost && typeof originalHost === 'string') {
                const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
                baseUrl = `${protocol}://${originalHost}`;
            } else {
                baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
            }

            logger.info(`[DocsController] Publishing docs for ${userRepo} to ${channelId ? `channel ${channelId}` : 'personal space'}:`, {
                title: title || 'untitled-docs',
                entryFile: entryFile || 'index.html',
                quartoDocumentType: quartoDocumentType || 'docs',
                fileSize: file.size,
                baseUrl,
                repoUrl: repoUrl || 'not provided',
                repoId: repoId || 'not provided',
                branchName: branchName || 'not provided',
            });

            const result = await docsService.publishDocs({
                userId,
                userRepo,
                repoId: repoId || undefined,
                branchName: branchName || undefined,
                repoUrl: repoUrl || undefined,
                channelId: channelId || undefined, // Pass undefined if not provided
                title: title || 'untitled-docs',
                zipBuffer: file.buffer,
                entryFile: entryFile || 'index.html',
                quartoDocumentType: quartoDocumentType || 'docs',
                baseUrl,
            });

            if (result.success) {
                res.status(200).json({
                    success: true,
                    docsUrl: result.docsUrl,
                    docsPath: result.docsPath,
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: result.error || 'Failed to publish docs',
                });
            }
        } catch (error) {
            logger.error('[DocsController] Error publishing docs:', error);
            res.status(500).json({
                error: 'Failed to publish docs',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };

    checkExistingDoc = async (req: Request, res: Response): Promise<void> => {
        try {
            const wildcardPath = req.params[0];
            const quartoRepo = parseQuartoRepoPath(wildcardPath);

            if (!quartoRepo) {
                res.status(400).json({ error: 'Invalid path format. Expected: {org}/{repo}/{branch}' });
                return;
            }

            const existingDoc = await docsService.checkExistingDoc(quartoRepo);

            if (existingDoc) {
                res.status(200).json({
                    exists: true,
                    doc: existingDoc,
                });
            } else {
                res.status(200).json({
                    exists: false,
                    doc: null,
                });
            }
        } catch (error) {
            logger.error('[DocsController] Error checking existing doc:', error);
            res.status(500).json({
                error: 'Failed to check existing doc',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };

    getAllDocs = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.user?.id;

            if (!userId) {
                res.status(403).json({ error: 'Unauthorized - user not authenticated' });
                return;
            }

            const { channelId } = req.query;

            let filterParam: 'created_by_me' | { channelId: string } = 'created_by_me';

            if (channelId && typeof channelId === 'string') {
                filterParam = { channelId };
            }

            const docs = await docsService.getAllAccessibleDocs(userId, filterParam);
            res.status(200).json({ docs });
        } catch (error) {
            logger.error('[DocsController] Error getting all docs:', error);
            res.status(500).json({
                error: 'Failed to get all docs',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };

    getDocsZip = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.user?.id;
            //XYNE-1287
            if (!userId) {
                res.status(403).json({ error: 'Unauthorized - user not authenticated' });
                return;
            }

            const wildcardPath = req.params[0];
            const quartoRepo = parseQuartoRepoPath(wildcardPath);

            if (!quartoRepo) {
                res.status(400).json({ error: 'Invalid path format. Expected: {org}/{repo}/{branch}' });
                return;
            }

            //XYNE-1287
            const hasAccess = await docsService.checkDocAccess(userId, quartoRepo);
            if (!hasAccess) {
                res.status(403).json({ error: 'You do not have access to this documentation' });
                return;
            }

            logger.info(`[DocsController] Getting docs zip for ${quartoRepo}`);

            const result = await docsService.getDocsZip(quartoRepo);

            if (!result) {
                res.status(404).json({
                    error: 'Documentation not found',
                    message: `No docs zip found for ${quartoRepo}`,
                });
                return;
            }

            // Extract branch for filename
            const parsed = docsService.parseQuartoRepo(quartoRepo);
            const filename = parsed ? parsed.branchName.replace(/\//g, '-') : 'docs';

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);
            res.setHeader('X-Entry-File', result.entryFile);
            res.setHeader('Access-Control-Expose-Headers', 'X-Entry-File');
            res.send(result.buffer);
        } catch (error) {
            logger.error('[DocsController] Error getting docs zip:', error);
            res.status(500).json({
                error: 'Failed to get docs zip',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };

    deleteDoc = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.user?.id;

            if (!userId) {
                res.status(403).json({ error: 'Unauthorized - user not authenticated' });
                return;
            }

            const { docId } = req.params;

            if (!docId) {
                res.status(400).json({ error: 'docId is required' });
                return;
            }

            const result = await docsService.deleteDoc(docId, userId);

            if (result.success) {
                res.status(200).json({ success: true });
            } else {
                res.status(result.statusCode || 500).json({
                    error: result.error || 'Failed to delete doc',
                });
            }
        } catch (error) {
            logger.error('[DocsController] Error deleting doc:', error);
            res.status(500).json({
                error: 'Failed to delete doc',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };

    getShareTargets = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.user?.id;

            if (!userId) {
                res.status(403).json({ error: 'Unauthorized - user not authenticated' });
                return;
            }

            const { channelId } = req.query;

            const targets = await docsService.getShareTargets(userId, channelId as string | undefined);
            res.status(200).json({ targets });
        } catch (error) {
            logger.error('[DocsController] Error getting share targets:', error);
            res.status(500).json({
                error: 'Failed to get share targets',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };

    shareDoc = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.user?.id;

            if (!userId) {
                res.status(403).json({ error: 'Unauthorized - user not authenticated' });
                return;
            }

            const { channelId, docsUrl, title, quartoRepo: userRepo } = req.body;

            if (!channelId || !docsUrl) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'channelId and docsUrl are required',
                });
                return;
            }

            const result = await docsService.shareDocToChannel(
                userId,
                channelId,
                docsUrl,
                title || 'Shared Documentation',
                userRepo
            );

            if (result.success) {
                res.status(200).json({ success: true, messageId: result.messageId });
            } else {
                res.status(result.statusCode || 500).json({
                    success: false,
                    error: result.error || 'Failed to share doc',
                });
            }
        } catch (error) {
            logger.error('[DocsController] Error sharing doc:', error);
            res.status(500).json({
                error: 'Failed to share doc',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };
}

export const docsController = new DocsController();
