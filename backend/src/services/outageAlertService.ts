import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import PDFDocument from 'pdfkit';
import { storageService } from './storage/index.js';
import type { UploadedFileResult } from './fileUploadService.js';

const VERIFICATION_API_BASE = `${config.genius.apiUrl}/api/v3/analytics/list_genuine_outages`;
const POLLING_INTERVAL_MS = 2000;       // initial backoff base (2 s)
const MAX_POLLING_INTERVAL_MS = 10000;  // backoff cap (10 s)
const MAX_POLLING_ATTEMPTS = 60;        // ~2 minutes total
const FETCH_TIMEOUT_MS = 30000;         // per-request timeout (30 s)
// Sentinel identity header expected by the Genius verification API
const OUTAGE_API_USER_HEADER = 'is_genuine_outage_route';

// Types
interface OutagePeriod {
  duration: number;
  startTime: string;
  endTime: string;
  sr_before: number;
  sr_during: number;
  volume_before: number;
  volume_during: number;
  is_genuine_outage: boolean;
}

interface OutageData {
  status: string;
  juspayBankCode: string;
  issuerName: string;
  outagePeriods: OutagePeriod[];
  paymentMethodType: string;
  stage: string;
  merchantId: string;
  paymentMethod: string;
  aggregate_sr_before: number;
  aggregate_sr_during: number;
  aggregate_volume_before: number;
  aggregate_volume_during: number;
  aggregate_is_genuine_outage: boolean;
}

interface VerificationResponse {
  session_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  outage_count?: number;
  result_summary?: {
    total_outages: number;
    enriched: boolean;
  };
  is_genuine_outage?: {
    [paymentMethod: string]: {
      [bankCode: string]: boolean;
    };
  };
  outages?: OutageData[];
}

interface FalseOutage {
  paymentMethodType: string;
  bankCode: string;
  issuerName: string;
  status: string;
  periods: OutagePeriod[];
}

interface VerificationResult {
  hasFalseOutages: boolean;
  falseOutages: FalseOutage[];
  totalOutages: number;
  sessionId: string;
  startTime: string;
  endTime: string;
}

interface ProcessOutageAlertResult {
  uploadedFile?: UploadedFileResult;
  sessionId?: string;
}

class OutageAlertService {
  /**
   * Extract start and end dates from the webhook text.
   * Expected format: "Data Range: YYYY-MM-DD HH:MM:SS - YYYY-MM-DD HH:MM:SS"
   */
  private extractDatesFromText(text: string): { startTime: string; endTime: string } | null {
    // Handles: YYYY-MM-DD, YYYY-MM-DD HH:MM, YYYY-MM-DD HH:MM:SS, YYYY-MM-DDTHH:MM:SS
    const dateRangeRegex =
      /Data Range:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T\s][0-9]{2}:[0-9]{2}(?::[0-9]{2})?)?)\s*-\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T\s][0-9]{2}:[0-9]{2}(?::[0-9]{2})?)?)/i;
    const match = text.match(dateRangeRegex);

    if (match?.[1] && match[2]) {
      const startTime = match[1].trim();
      const endTime = match[2].trim();
      logger.info('[OUTAGE-ALERT] Extracted dates from text', { startTime, endTime });
      return { startTime, endTime };
    }

    return null;
  }

  /**
   * Generate a PDF report buffer for false outages.
   */
  generatePdfReport(result: VerificationResult): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const { falseOutages, totalOutages, sessionId, startTime, endTime } = result;

      // Header
      doc.fontSize(18).fillColor('#c0392b').text('False Outages Detected Report', { align: 'center' });
      doc.moveDown(0.5);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#c0392b').lineWidth(2).stroke();
      doc.moveDown(0.5);

      // Summary section
      doc.fontSize(11).fillColor('#222');
      doc.text(`Time Range: `, { continued: true }).fillColor('#2980b9').text(`${startTime}  to  ${endTime}`);
      doc.fillColor('#222').text(`Session ID: `, { continued: true }).fillColor('#555').text(sessionId);
      doc.fillColor('#222').text(`Total Outages: `, { continued: true }).fillColor('#222').text(String(totalOutages));
      doc.fillColor('#222').text(`False Outages: `, { continued: true }).fillColor('#c0392b').text(String(falseOutages.length));

      doc.moveDown(1);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ddd').lineWidth(1).stroke();
      doc.moveDown(0.5);

      // Details for each false outage
      doc.fontSize(13).fillColor('#222').text('False Outage Details', { underline: true });
      doc.moveDown(0.5);

      const PAGE_BOTTOM = 780; // A4 is 842pt; leave bottom margin

      // Helper: draw a 2-column table row by row with page-break support
      const drawTable = (rows: [string, string][], startY: number): number => {
        const colX = 55;
        const col2X = 250;
        const rowH = 20;
        const tableW = 490;

        let currentY = startY;
        let rowIndex = 0;

        rows.forEach(([label, value]) => {
          // Add a new page if the next row would overflow
          if (currentY + rowH > PAGE_BOTTOM) {
            doc.addPage();
            currentY = doc.page.margins.top;
          }

          const y = currentY;
          if (rowIndex % 2 === 0) {
            doc.rect(colX, y, tableW, rowH).fillColor('#f7f7f7').fill();
          }
          doc.rect(colX, y, tableW, rowH).strokeColor('#d0d0d0').lineWidth(0.5).stroke();
          doc.rect(colX, y, col2X - colX, rowH).strokeColor('#d0d0d0').lineWidth(0.5).stroke();
          doc.fontSize(9).fillColor('#555')
            .text(label, colX + 5, y + 6, { width: col2X - colX - 10, lineBreak: false });
          doc.fontSize(9).fillColor('#111')
            .text(value, col2X + 5, y + 6, { width: tableW - (col2X - colX) - 10, lineBreak: false });

          currentY += rowH;
          rowIndex++;
        });

        return currentY;
      };

      falseOutages.forEach((outage, index) => {
        // Add a new page if there's not enough space for the outage header block
        if (doc.y + 60 > PAGE_BOTTOM) {
          doc.addPage();
        }

        doc.fontSize(11).fillColor('#c0392b')
          .text(`${index + 1}. ${outage.issuerName} (${outage.bankCode})`);
        doc.fontSize(10).fillColor('#444');
        doc.text(`Payment Method Type: ${outage.paymentMethodType}`);
        doc.text(`Status: ${outage.status}`);

        if (outage.periods && outage.periods.length > 0) {
          doc.moveDown(0.4);
          doc.fontSize(10).fillColor('#444').text('Outage Periods:');
          doc.moveDown(0.3);

          outage.periods.forEach((period: OutagePeriod) => {
            const start = period.startTime.replace('T', ' ').replace('Z', ' UTC');
            const end = period.endTime.replace('T', ' ').replace('Z', ' UTC');
            const durationMin = Math.floor(period.duration / 60);
            const durationSec = period.duration % 60;
            const durationStr = durationMin > 0 ? `${durationMin}m ${durationSec}s` : `${durationSec}s`;

            const rows: [string, string][] = [
              ['Start Time',     start],
              ['End Time',       end],
              ['Duration',       durationStr],
              ['sr_before',      `${period.sr_before}%`],
              ['sr_during',      `${period.sr_during}%`],
              ['volume_before',  String(period.volume_before)],
              ['volume_during',  String(period.volume_during)],
            ];

            const endY = drawTable(rows, doc.y);
            // Move cursor back to default left margin after the table
            doc.text('', 40, endY + 8);
          });
        }

        doc.moveDown(0.5);
        if (index < falseOutages.length - 1) {
          doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#eee').lineWidth(0.5).stroke();
          doc.moveDown(0.3);
        }
      });

      doc.moveDown(1);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ddd').lineWidth(1).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#555').text('Note:', { underline: true });
      doc.moveDown(0.3);
      doc.text('sr_before = Average Success Rate over the 7-day period before the outage');
      doc.text('sr_during = Success Rate during the actual outage window');

      doc.end();
    });
  }

  /**
   * Verify outages by calling the external API and polling for results.
   */
  private async verifyOutages(
    startTime: string,
    endTime: string,
    email: string = config.outageVerification.email,
  ): Promise<VerificationResult> {
    logger.info('[OUTAGE-ALERT] Starting verification', { startTime, endTime });

    const sessionId = await this.initiateVerification(startTime, endTime, email);
    const result = await this.pollForCompletion(sessionId);
    const analysisResult = this.analyzeResults(result, startTime, endTime);

    return analysisResult;
  }

  /**
   * Initiate the verification job and return the session ID.
   */
  private async initiateVerification(
    startTime: string,
    endTime: string,
    email: string,
  ): Promise<string> {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(VERIFICATION_API_BASE, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Xyne-User-Id': OUTAGE_API_USER_HEADER,
          Authorization: `Basic ${config.outageVerification.authKey}`,
        },
        body: JSON.stringify({ start_time: startTime, end_time: endTime, email }),
      });
    } catch (err) {
      throw new Error(`Network error initiating verification: ${(err as Error).message}`);
    } finally {
      clearTimeout(timerId);
    }

    if (!response.ok) {
      throw new Error(`Failed to initiate verification: ${response.status} ${response.statusText}`);
    }

    const raw = await response.json() as VerificationResponse;

    if (!raw.session_id) {
      throw new Error('No session_id returned from verification API');
    }

    logger.info('[OUTAGE-ALERT] Job initiated', { sessionId: raw.session_id, status: raw.status });
    return raw.session_id;
  }

  /**
   * Poll the status endpoint until the job completes, using exponential backoff.
   */
  private async pollForCompletion(sessionId: string): Promise<VerificationResponse> {
    let attempts = 0;
    let delay = POLLING_INTERVAL_MS;

    while (attempts < MAX_POLLING_ATTEMPTS) {
      attempts++;

      let data: VerificationResponse | undefined;

      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(`${VERIFICATION_API_BASE}/status/${sessionId}`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            'X-Xyne-User-Id': OUTAGE_API_USER_HEADER,
            Authorization: `Basic ${config.outageVerification.authKey}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Poll status error: ${response.status} ${response.statusText}`);
        }

        const raw = await response.json() as VerificationResponse;
        data = raw;
      } catch (err) {
        // Transient network/timeout error — log and retry on next interval
        logger.warn('[OUTAGE-ALERT] Transient poll error, will retry', {
          sessionId,
          attempt: attempts,
          error: (err as Error).message,
        });
      } finally {
        clearTimeout(timerId);
      }

      if (data) {
        logger.info('[OUTAGE-ALERT] Polling status', {
          sessionId,
          attempt: attempts,
          status: data.status,
        });

        if (data.status === 'completed') return data;

        if (data.status === 'failed') {
          throw new Error('Verification job failed');
        }
      }

      // Exponential backoff with cap before next poll
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, MAX_POLLING_INTERVAL_MS);
    }

    throw new Error(`Polling timeout after ${MAX_POLLING_ATTEMPTS} attempts`);
  }

  /**
   * Analyse the verification results to find false outages.
   */
  private analyzeResults(
    response: VerificationResponse,
    startTime: string,
    endTime: string,
  ): VerificationResult {
    const falseOutages: FalseOutage[] = [];

    if (response.is_genuine_outage) {
      for (const [paymentMethod, banks] of Object.entries(response.is_genuine_outage)) {
        for (const [bankCode, isGenuine] of Object.entries(banks)) {
          if (isGenuine === false) {
            const outageDetail = response.outages?.find(
              (o) => o.paymentMethod === paymentMethod && o.juspayBankCode === bankCode,
            );

            if (outageDetail) {
              falseOutages.push({
                paymentMethodType: outageDetail.paymentMethodType,
                bankCode,
                issuerName: outageDetail.issuerName,
                status: outageDetail.status,
                periods: outageDetail.outagePeriods,
              });
            }
          }
        }
      }
    }

    return {
      hasFalseOutages: falseOutages.length > 0,
      falseOutages,
      totalOutages: response.outage_count ?? 0,
      sessionId: response.session_id,
      startTime,
      endTime,
    };
  }

  /**
   * Process an outage alert webhook.
   * conversationId is required as the GCS upload scope when false outages are detected.
   * Returns the uploaded PDF file result if false outages are found.
   */
  async processOutageAlert(
    text: string,
    conversationId: string,
  ): Promise<ProcessOutageAlertResult> {
    if (!config.outageVerification.authKey) {
      logger.warn('[OUTAGE-ALERT] OUTAGE_VERIFICATION_AUTH_KEY not configured, skipping verification');
      return {};
    }

    const dates = this.extractDatesFromText(text);

    if (!dates) {
      logger.warn('[OUTAGE-ALERT] No valid dates found in outage alert text');
      return {};
    }

    logger.info('[OUTAGE-ALERT] Processing outage alert', {
      startTime: dates.startTime,
      endTime: dates.endTime,
    });

    try {
      const verificationResult = await this.verifyOutages(dates.startTime, dates.endTime);

      if (!verificationResult.hasFalseOutages) {
        logger.info('[OUTAGE-ALERT] All outages are genuine', {
          sessionId: verificationResult.sessionId,
        });
        return { sessionId: verificationResult.sessionId };
      }

      logger.info('[OUTAGE-ALERT] False outages detected, generating PDF report', {
        sessionId: verificationResult.sessionId,
        falseOutagesCount: verificationResult.falseOutages.length,
      });

      const pdfBuffer = await this.generatePdfReport(verificationResult);

      const fileName = `false-outage-report-${verificationResult.sessionId ?? Date.now()}.pdf`;
      const uploadResult = await storageService.uploadFile(pdfBuffer, {
        filename: fileName,
        contentType: 'application/pdf',
        metadata: {
          sessionId: verificationResult.sessionId ?? '',
          generatedAt: new Date().toISOString(),
          type: 'outage-report',
        },
        scopeType: 'CONVERSATION',
        scopeId: conversationId,
      });

      const uploadedFile: UploadedFileResult = {
        originalName: fileName,
        fileName,
        fileSize: uploadResult.size,
        mimeType: 'application/pdf',
        fileUrl: uploadResult.path,
        metadata: {
          sessionId: verificationResult.sessionId ?? '',
          generatedAt: new Date().toISOString(),
        },
      };

      logger.info('[OUTAGE-ALERT] PDF uploaded to storage', {
        sessionId: verificationResult.sessionId,
      });

      return { uploadedFile, sessionId: verificationResult.sessionId };
    } catch (error) {
      logger.error('[OUTAGE-ALERT] Error during verification', { error });
      return {};
    }
  }
}

export const outageAlertService = new OutageAlertService();
