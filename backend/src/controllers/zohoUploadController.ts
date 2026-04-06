/**
    * Zoho Upload Controller
    * Handles file uploads to Zoho Desk API for email attachments
    */

   import { Request, Response } from 'express';
   import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
   import { ChannelRepository } from '@/database/repositories/channelRepository';
   import { ConversationRepository } from '@/database/repositories/conversationRepository';
   import { decrypt } from '@/services/encryptionService';
   import { logger } from '@/utils/logger';
   import axios from 'axios';
   import FormData from 'form-data';

   export class ZohoUploadController {
     private externalSourceRepo = new ExternalSourceRepository();
     private channelRepo = new ChannelRepository();
     private conversationRepo = new ConversationRepository();

     /**
      * POST /api/email/:conversationId/upload-attachments
      * Upload attachments to Zoho for email reply
      */
     uploadAttachments = async (req: Request, res: Response) => {
       try {
         const { conversationId } = req.params;

         // Validate files
         if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
           return res.status(400).json({ error: 'No files uploaded' });
         }

         // 1. Fetch conversation to get channel
         const conversation = await this.conversationRepo.findById(conversationId);
         if (!conversation) {
           return res.status(404).json({ error: 'Conversation not found' });
         }

         // 2. Get channel and external source for Zoho credentials
         const channel = await this.channelRepo.findById(conversation.channelId);
         if (!channel) {
           return res.status(404).json({ error: 'Channel not found' });
         }

         const externalSource = await this.externalSourceRepo.findByChannelId(channel.id);
         if (!externalSource) {
           return res.status(404).json({ error: 'External source not found' });
         }

         // 3. Decrypt and parse Zoho credentials
         const decryptedCredentials = decrypt(externalSource.credentials);
         const credentials = JSON.parse(decryptedCredentials);
         
         // Support both formats: apiKey (from externalAttachmentService) and refreshToken (from ZohoService)
         let accessToken: string;
         let orgId: string;
         
         if (credentials.refreshToken && credentials.clientId && credentials.clientSecret) {
           // Format: {"refreshToken": "...", "clientId": "...", "clientSecret": "...", "orgId": "..."}
           const { ZohoService } = await import('@/services/zohoService');
           const zohoService = new ZohoService(credentials, externalSource.id);
           // Use space-separated scopes (Zoho OAuth standard) - uploads need CREATE permission
           accessToken = await zohoService.getAccessToken('Desk.tickets.CREATE Desk.basic.CREATE');
           orgId = credentials.orgId;
         } else if (credentials.apiKey) {
           accessToken = credentials.apiKey;
           orgId = credentials.orgId;
         } else {
           throw new Error(`Unknown Zoho credential format. Expected apiKey or refreshToken format.`);
         }

         // 5. Upload each file to Zoho
         const uploadPromises = (req.files as Express.Multer.File[]).map(async (file) => {
           return this.uploadFileToZoho(file, accessToken, orgId);
         });

         const attachmentIds = await Promise.all(uploadPromises);
         const successfulUploads = attachmentIds.filter((id): id is string => id !== null);

         return res.status(200).json({
           success: true,
           attachmentIds: successfulUploads,
         });
       } catch (error: any) {
         logger.error('[ZohoUploadController] Failed to upload attachments:', error);
         return res.status(500).json({
           error: 'Failed to upload attachments',
           message: error.message,
         });
       }
     };

     /**
      * Upload a single file to Zoho
      */
     private async uploadFileToZoho(
       file: Express.Multer.File,
       accessToken: string,
       orgId: string
     ): Promise<string | null> {
       try {
         // Create form data for Zoho
         const formData = new FormData();
         formData.append('file', file.buffer, {
           filename: file.originalname,
           contentType: file.mimetype,
         });

         // Upload to Zoho
         const response = await axios.post(
           'https://desk.zoho.com/api/v1/uploads',
           formData,
           {
             headers: {
               ...formData.getHeaders(),
               'orgId': orgId,
               'Authorization': `Zoho-oauthtoken ${accessToken}`,
             },
             maxBodyLength: Infinity,
             maxContentLength: Infinity,
           }
         );

         return response.data.id;
      } catch (error: any) {
        logger.error(`[ZohoUploadController] Failed to upload file ${file.originalname}: ${error?.message}`);
        return null;
      }
     }
   }