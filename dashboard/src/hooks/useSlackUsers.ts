import { useQuery } from '@tanstack/react-query';
import { useMemo, useCallback, useState } from 'react';
import { apiInstance } from '../services/clients/apiClient';
import type { MentionResult } from '../components/ui/Selectors/Selectors.types';

interface SlackUserItem {
  id: string;
  name: string;
  displayName: string;
  avatar: string;
}

interface SlackUsersResponse {
  users: SlackUserItem[];
}

function toMentionItems(users: SlackUserItem[]): MentionResult[] {
  return users.map(u => ({
    id: u.id,
    name: u.displayName || u.name,
    type: 'user' as const,
    username: u.name,
    picture: u.avatar,
  }));
}

function filterUsers(users: MentionResult[], query: string): MentionResult[] {
  if (!query) return users;
  const q = query.toLowerCase();
  return users.filter(
    u => u.name.toLowerCase().includes(q) || (u.username && u.username.toLowerCase().includes(q)),
  );
}

export function useSlackUsers() {
  const { data, isLoading } = useQuery({
    queryKey: ['slack-desk-users'],
    queryFn: async (): Promise<SlackUserItem[]> => {
      const { data } = await apiInstance.get<SlackUsersResponse>('/integrations/slack-desk/users');
      return data.users;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const allUsers = useMemo(() => toMentionItems(data || []), [data]);

  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = useMemo(() => filterUsers(allUsers, searchQuery), [allUsers, searchQuery]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  return {
    allUsers,
    filteredUsers,
    isLoading,
    searchUsers: handleSearch,
  };
}
