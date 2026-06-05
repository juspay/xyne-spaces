import express from 'express';
import { CollectionController } from '../controllers/collectionController';
import { collectionUpload, versionUpload } from '../middleware/upload';

const router = express.Router();
const collectionController = new CollectionController();

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
