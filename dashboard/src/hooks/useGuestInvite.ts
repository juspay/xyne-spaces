import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useSelf } from './useUsers';
import { apiInstance } from '../services/clients/apiClient';

export interface UseGuestInviteOptions {
  entityType: string;
  entityId: string;
}

export interface UseGuestInviteReturn {
  email: string;
  setEmail: (value: string) => void;
  isLoading: boolean;
  sendInvite: () => Promise<boolean>;
}

export const useGuestInvite = ({
  entityType,
  entityId,
}: UseGuestInviteOptions): UseGuestInviteReturn => {
  const self = useSelf();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendInvite = useCallback(async (): Promise<boolean> => {
    if (!email.trim()) {
      toast.error('Please enter an email address');
      return false;
    }

    if (!self?.workspaceId) {
      toast.error('No workspace selected');
      return false;
    }

    if (!entityType) {
      toast.error('Entity type is required');
      return false;
    }

    if (!entityId.trim()) {
      toast.error('Entity ID is required');
      return false;
    }

    setIsLoading(true);
    try {
      await apiInstance.post('/invitations', {
        email: email.trim(),
        role: 'GUEST',
        workspaceId: self.workspaceId,
        entityType,
        entityId: entityId.trim(),
      });

      toast.success('Invitation sent', {
        description: `An invitation has been sent to ${email.trim()}`,
        duration: 2000,
      });

      setEmail('');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send invitation';
      toast.error('Failed to send invitation', {
        description: message,
        duration: 2500,
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [email, self?.workspaceId, entityType, entityId]);

  return {
    email,
    setEmail,
    isLoading,
    sendInvite,
  };
};
