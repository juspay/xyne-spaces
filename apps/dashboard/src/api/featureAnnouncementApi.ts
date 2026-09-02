import type { FeatureAnnouncementView, PendingAnnouncementsResponse } from '@xyne/shared';
import { apiInstance } from '../services/clients/apiClient';

export interface AdminAnnouncement extends Record<string, unknown> {
  id: string;
  key: string;
  title: string;
  description: string;
  status: string;
  publishedAt: string | null;
  expiresAt: string | null;
  cacKey: string | null;
  ctaLabel: string | null;
  ctaType: string | null;
  ctaTarget: string | null;
  mediaKey: string | null;
  mediaAlt: string | null;
  pages: Array<{
    title: string;
    description: string;
    mediaKey?: string | null;
    mediaAlt?: string | null;
  }>;
  pageCount: number;
  editable: boolean;
}

export interface AnnouncementWritePayload {
  key?: string;
  title: string;
  description: string;
  pages: Array<{
    title: string;
    description: string;
    mediaKey?: string | null;
    mediaAlt?: string | null;
  }>;
  mediaKey?: string | null;
  mediaAlt?: string | null;
  ctaLabel?: string | null;
  ctaType?: string | null;
  ctaTarget?: string | null;
  cacKey?: string | null;
  expiresAt?: string | null;
}

const BASE = '/feature-announcements';

export const featureAnnouncementApi = {
  getPending: async (): Promise<FeatureAnnouncementView[]> => {
    const { data } = await apiInstance.get<PendingAnnouncementsResponse>(`${BASE}/pending`);
    return data.announcements ?? [];
  },

  markSeen: async (id: string, pageIndex: number): Promise<void> => {
    await apiInstance.post(`${BASE}/${id}/seen`, { pageIndex });
  },

  markCtaClicked: async (id: string): Promise<void> => {
    await apiInstance.post(`${BASE}/${id}/cta`);
  },

  dismiss: async (announcementIds: string[]): Promise<void> => {
    await apiInstance.post(`${BASE}/dismiss`, { announcementIds });
  },

  admin: {
    list: async (): Promise<AdminAnnouncement[]> => {
      const { data } = await apiInstance.get<{ announcements: AdminAnnouncement[] }>(
        `${BASE}/admin`,
      );
      return data.announcements ?? [];
    },

    create: async (payload: AnnouncementWritePayload): Promise<AdminAnnouncement> => {
      const { data } = await apiInstance.post<{ announcement: AdminAnnouncement }>(
        `${BASE}/admin`,
        payload,
      );
      return data.announcement;
    },

    update: async (id: string, payload: AnnouncementWritePayload): Promise<AdminAnnouncement> => {
      const { data } = await apiInstance.put<{ announcement: AdminAnnouncement }>(
        `${BASE}/admin/${id}`,
        payload,
      );
      return data.announcement;
    },

    publish: async (id: string): Promise<void> => {
      await apiInstance.post(`${BASE}/admin/${id}/publish`);
    },

    archive: async (id: string): Promise<void> => {
      await apiInstance.post(`${BASE}/admin/${id}/archive`);
    },

    uploadMedia: async (file: File): Promise<string> => {
      const form = new FormData();
      form.append('media', file);
      const { data } = await apiInstance.post<{ mediaKey: string }>(`${BASE}/admin/media`, form);
      return data.mediaKey;
    },

    /**
     * Path relative to the API root. Serves drafts as well as published rows, so an
     * announcement can be reviewed before it is published.
     */
    mediaPath: (id: string, index: number | 'cover'): string =>
      `${BASE}/admin/${id}/media/${index}`,
  },
};
