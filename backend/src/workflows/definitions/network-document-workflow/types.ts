/**
 * Network Document Workflow Types
 * 
 * This workflow processes network documents (VISA/MASTERCARD) uploaded to Google Drive
 */

export interface NetworkDocumentContext {
  // File information
  fileId: string;
  fileName: string;
  localPath: string;
  network: 'VISA' | 'MASTERCARD';
  
  // Workflow metadata
  ticketId?: string;
  workflowExecutionId?: string;
  
  // Processing results
  extractedText?: string;
  documentType?: string;
  keyFindings?: string[];
  actionItems?: string[];
  
  // Error handling
  error?: string;
}

export interface DocumentExtractionResult {
  text: string;
  documentType: string;
  metadata: {
    pageCount?: number;
    hasImages?: boolean;
    language?: string;
  };
}

export interface DocumentAnalysisResult {
  summary: string;
  keyFindings: string[];
  actionItems: string[];
  tags: string[];
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}