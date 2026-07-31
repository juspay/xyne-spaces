import { Router } from 'express';
import { userManagementController } from '../controllers/userManagementController';

const router = Router();

// Note: Authentication and ACL middleware are applied at the app level
// These routes are protected and only accessible to admin users
// Basic user operations (list, search, get by ID) are now in /api/users without ACL

// Get user access permissions
router.get('/users/:id/access', userManagementController.getUserAccess);

// Update user access permissions
router.put('/users/:id/access', userManagementController.updateUserAccess);

// Update user status (activate/deactivate)
router.patch('/users/:id/status', userManagementController.updateUserStatus);

// Get all resources
router.get('/resources', userManagementController.getAllResources);

// Get current user's permissions
router.get('/permissions', userManagementController.getCurrentUserPermissions);

// ==================== GROUP MANAGEMENT ROUTES ====================

// Get all user groups
router.get('/groups', userManagementController.getAllGroups);

// Get group details by ID
router.get('/groups/:id', userManagementController.getGroupById);

// Create a new user group
router.post('/groups', userManagementController.createGroup);

// Update a user group
router.put('/groups/:id', userManagementController.updateGroup);

// Delete a user group
router.delete('/groups/:id', userManagementController.deleteGroup);

// Deactivate a user group (soft delete)
router.patch('/groups/:id/deactivate', userManagementController.deactivateGroup);

// Reactivate a user group
router.patch('/groups/:id/reactivate', userManagementController.reactivateGroup);

// Assign user to group
router.post('/groups/:groupId/users/:userId', userManagementController.assignUserToGroup);

// Remove user from group (assigns to default group)
router.delete('/groups/:groupId/users/:userId', userManagementController.removeUserFromGroup);

// ==================== GROUP PERMISSION MANAGEMENT ROUTES ====================

// Get group permissions
router.get('/groups/:id/permissions', userManagementController.getGroupPermissions);

// Update group permissions
router.put('/groups/:id/permissions', userManagementController.updateGroupPermissions);

export default router;
