import express from 'express';
import { CollectionController } from '../controllers/collectionController';
import { collectionUpload, versionUpload } from '../middleware/upload';

const router = express.Router();
const collectionController = new CollectionController();

// List root collections the requesting user can access (used by the Claw agent
// Knowledge Base picker). Add ?includeItems=1 to receive full file/folder trees.
// Registered BEFORE the /:collectionId/... routes so `accessible` is not matched
// as a collection id.
router.get('/accessible', collectionController.listAccessibleCollections);

// Search items in a collection
router.get('/:collectionId/search', collectionController.searchItems);

// Download file
router.get('/items/:itemId/download', collectionController.downloadFile);

// Download folder as zip
router.get('/items/:itemId/download-folder', collectionController.downloadFolder);

// Upload files to collection (streaming — files go directly to GCS, no memory buffer)
router.post('/:collectionId/upload', collectionUpload.array('files', 50), collectionController.uploadFiles);

// Version history routes
router.post('/items/:itemId/versions', versionUpload.single('file'), collectionController.uploadNewVersion);
router.get('/items/:itemId/versions', collectionController.getItemVersions);
router.post('/items/:itemId/versions/:versionId/restore', collectionController.restoreItemVersion);
router.get('/items/:itemId/versions/:versionId/download', collectionController.downloadItemVersion);

export default router;
