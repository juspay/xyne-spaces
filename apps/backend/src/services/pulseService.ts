import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export interface PulseActionItem {
  content: string;
  assignee: string;
}

export interface PulseMeetingData {
  meetCode: string;
  host: string;
  participants: string[];
  summary: string;
  chapters: Array<{ topic: string }>;
  action_items: PulseActionItem[];
}

export interface PulsePostResult {
  success: boolean;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pulse API response shapes (best-effort — adjust if the real shape differs)
// ─────────────────────────────────────────────────────────────────────────────

interface PulseOrg {
  id: string;
  orgId?: string; // some APIs nest under orgId
  name?: string;
  orgName?: string;
  merchantIdList?: string[];
  merchantIds?: string[];
}

interface PulseProduct {
  id: string;         // lead/product ID
  product?: string;   // product name e.g. "Juspay Safe"
  stage?: string;     // e.g. "MERCHANT_CONTACTED"
  productId?: string; // fallback alias
}

// Resolved context for a merchant
export interface PulseOrgContext {
  orgId: string;
  merchantId: string | null;
  productId: string | null;
}

/**
 * PulseService — integration with the Pulse (Juspay) external actionables system.
 *
 * Sends meeting data (participants, summary, action items) to the Pulse S2S API.
 * All methods are no-ops when PULSE_ENABLED is false, so callers can
 * unconditionally invoke them without guarding.
 */
export class PulseService {
  private get isEnabled(): boolean {
    return config.pulse.enabledChannels.length > 0;
  }

  private get headers(): Record<string, string> {
    const { authorization } = config.pulse;
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Basic ${authorization}`,
    };
  }

  // Headers for endpoints that don't accept a body (the Pulse org-list APIs reject empty JSON)
  private get headersNoBody(): Record<string, string> {
    const { authorization } = config.pulse;
    return {
      'Accept': 'application/json',
      'Authorization': `Basic ${authorization}`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Org discovery APIs
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch the list of all orgs from Pulse.
   * POST /curie/s2s/organization/fetch/list
   */
  async fetchOrgList(): Promise<PulseOrg[]> {
    const { apiUrl } = config.pulse;
    try {
      const response = await fetch(`${apiUrl}/curie/s2s/organization/fetch/list`, {
        method: 'POST',
        headers: this.headersNoBody,
        // No body — the API returns 400 when it receives Content-Type + empty JSON
      });
      if (!response.ok) {
        logger.warn(`[PulseService] fetchOrgList failed: ${response.status}`);
        return [];
      }
      const data = await response.json() as { organizations?: PulseOrg[]; data?: PulseOrg[]; orgs?: PulseOrg[] } | PulseOrg[];
      // Handle possible shapes: { organizations: [...] } | { data: [...] } | [...]
      if (Array.isArray(data)) return data;
      if ((data as any).organizations) return (data as any).organizations;
      if ((data as any).data) return (data as any).data;
      if ((data as any).orgs) return (data as any).orgs;
      return [];
    } catch (err) {
      logger.error('[PulseService] fetchOrgList error:', err);
      return [];
    }
  }

  /**
   * Fetch product/lead data for a specific org.
   * POST /curie/s2s/organization/lead/data/{orgId}
   */
  async fetchOrgLeadData(orgId: string): Promise<PulseProduct[]> {
    const { apiUrl } = config.pulse;
    try {
      const response = await fetch(`${apiUrl}/curie/s2s/organization/lead/data/${orgId}`, {
        method: 'POST',
        headers: this.headersNoBody,
        // No body — same pattern as fetchOrgList
      });
      if (!response.ok) {
        logger.warn(`[PulseService] fetchOrgLeadData(${orgId}) failed: ${response.status}`);
        return [];
      }
      const data = await response.json() as { products?: PulseProduct[]; data?: PulseProduct[] } | PulseProduct[];
      if (Array.isArray(data)) return data;
      if ((data as any).products) return (data as any).products;
      if ((data as any).data) return (data as any).data;
      return [];
    } catch (err) {
      logger.error(`[PulseService] fetchOrgLeadData(${orgId}) error:`, err);
      return [];
    }
  }

  /**
   * Resolve the Pulse org, merchant, and product IDs for a given merchant name.
   *
   * Strategy:
   *  1. Call fetchOrgList → find org whose name contains the merchant name (case-insensitive)
   *  2. If found, call fetchOrgLeadData(orgId) → take first product
   *  3. Return resolved IDs (merchantId and productId may be null if not found)
   */
  async resolveOrgForMerchant(merchantName: string): Promise<PulseOrgContext | null> {
    logger.info(`[PulseService] Resolving org for merchant: "${merchantName}"`);

    const orgs = await this.fetchOrgList();
    logger.info(`[PulseService] fetchOrgList returned ${orgs.length} orgs`);

    if (orgs.length === 0) return null;

    const needle = merchantName.toLowerCase().trim();

    // Fuzzy match: org name contains merchant name OR merchant name contains org name
    const matched = orgs.find(o => {
      const orgName = (o.name ?? o.orgName ?? '').toLowerCase().trim();
      if (!orgName) return false;
      return orgName === needle;
    });

    if (!matched) {
      logger.warn(`[PulseService] No org matched merchant "${merchantName}"`);
      // Fall back to first org if only one exists
      if (orgs.length === 1) {
        logger.info('[PulseService] Single org available — using it as fallback');
        return this._resolveFromOrg(orgs[0]);
      }
      return null;
    }

    logger.info(`[PulseService] Matched org: "${matched.name ?? matched.orgName}" (${matched.id ?? matched.orgId})`);
    return this._resolveFromOrg(matched);
  }

  private async _resolveFromOrg(org: PulseOrg): Promise<PulseOrgContext> {
    const orgId = org.id ?? org.orgId ?? '';
    const merchantIds = org.merchantIdList ?? org.merchantIds ?? [];
    const merchantId = merchantIds.length > 0 ? merchantIds[0] : null;

    // Fetch products for this org
    const products = await this.fetchOrgLeadData(orgId);
    const productId = products.length > 0 ? (products[0].id ?? products[0].productId ?? null) : null;

    logger.info(`[PulseService] Resolved: orgId=${orgId}, merchantId=${merchantId}, productId=${productId}`);
    return { orgId, merchantId, productId };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Post actionables
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Post meeting actionables to the Pulse S2S API.
   * Safe to fire-and-forget — never throws.
   */
  async postActionables(
    data: PulseMeetingData,
    orgContext: PulseOrgContext
  ): Promise<PulsePostResult> {
    if (!this.isEnabled) {
      logger.debug('[PulseService] Pulse is disabled — skipping postActionables');
      return { success: true };
    }

    const { apiUrl, authorization } = config.pulse;

    if (!authorization) {
      logger.warn('[PulseService] Pulse config incomplete — skipping postActionables');
      return { success: false, error: 'Pulse configuration incomplete' };
    }

    const insights = JSON.stringify({
      meetCode: data.meetCode,
      host: data.host,
      participants: data.participants,
      aiAnalysedData: {
        summary: data.summary,
        chapters: data.chapters,
        action_items: data.action_items,
      },
    });

    const body: Record<string, unknown> = {
      orgId: orgContext.orgId,
      insights,
    };

    if (orgContext.productId) {
      body['productList'] = [orgContext.productId];
    }
    if (orgContext.merchantId) {
      body['merchantIdList'] = [orgContext.merchantId];
    }

    try {
      logger.info(
        `[PulseService] Posting actionables for meeting ${data.meetCode} to Pulse ` +
        `(orgId=${orgContext.orgId}, productId=${orgContext.productId})`
      );

      const response = await fetch(
        `${apiUrl}/curie/s2s/update/meeting/actionables/entity`,
        {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.error(
          `[PulseService] Pulse API error | status=${response.status}, body=${errorText}`
        );
        return { success: false, error: `Pulse API returned ${response.status}: ${errorText}` };
      }

      logger.info(`[PulseService] Successfully posted actionables for meeting ${data.meetCode}`);
      return { success: true };
    } catch (error) {
      logger.error('[PulseService] Failed to post actionables to Pulse:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const pulseService = new PulseService();
