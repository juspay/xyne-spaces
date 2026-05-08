import express from 'express';
import multer from 'multer';
import { CollectionController } from '../controllers/collectionController';

const router = express.Router();
const collectionController = new CollectionController();

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB max file size
        files: 50, // Max 50 files per request
    },
});

// Get project member user IDs (for share-collection UI). Must be before /project/:projectId/:userId
router.get('/project/:projectId/members', collectionController.getProjectMembers);

// Get all collections for a project
router.get('/project/:projectId/:userId', collectionController.getCollectionsByProject);

// Get top-level items for a collection
router.get('/:collectionId/items', collectionController.getItemsByCollection);

// Get folder counters for a single folder by id
router.get('/:collectionId/folder-counters/:folderId', collectionController.getFolderCountersByFolderId);

// Get failed items in a collection
router.get('/:collectionId/failed-items', collectionController.getFailedItems);

// Search items in a collection
router.get('/:collectionId/search', collectionController.searchItems);

// Get file content
router.get('/items/:itemId/content', collectionController.getItemContent);

// Get item ancestors (for hydrating tree context on deep-link/refresh)
router.get('/items/:itemId/ancestors', collectionController.getItemAncestors);

// Download file
router.get('/items/:itemId/download', collectionController.downloadFile);

// Download folder as zip
router.get('/items/:itemId/download-folder', collectionController.downloadFolder);

// Create folder in collection
router.post('/:collectionId/folders', collectionController.createFolder);

// Upload files to collection
router.post('/:collectionId/upload', upload.array('files'), collectionController.uploadFiles);

// Create collection
router.post('/', collectionController.createCollection);

// Delete collection
router.delete('/:collectionId', collectionController.deleteCollection);

// Update collection
router.patch('/:collectionId', collectionController.updateCollection);

// Version history routes
router.post('/items/:itemId/versions', upload.single('file'), collectionController.uploadNewVersion);
router.get('/items/:itemId/versions', collectionController.getItemVersions);
router.post('/items/:itemId/versions/:versionId/restore', collectionController.restoreItemVersion);
router.get('/items/:itemId/versions/:versionId/download', collectionController.downloadItemVersion);

// Delete collection item
router.delete('/items/:itemId', collectionController.deleteItem);

// Update collection item
router.patch('/items/:itemId', collectionController.updateItem);

// Update item entity tags
router.patch('/items/:itemId/tags', collectionController.updateItemTags);

export default router;
