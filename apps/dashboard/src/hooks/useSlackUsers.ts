import { useQuery } from '@tanstack/react-query';
import { useMemo, useCallback, useState } from 'react';
import { apiInstance } from '../services/clients/apiClient';
import type { MentionResult } from '@xyne/shared';
import { matchesAllTokens } from '@xyne/shared/utils';

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
  if (!query.trim()) return users;
  // name = Slack display name, username = Slack handle; token-AND both (out-of-order / partial).
  return users.filter(
    u => matchesAllTokens(u.name, query) || (!!u.username && matchesAllTokens(u.username, query)),
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
