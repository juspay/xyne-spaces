import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';
import { useRawSafeAreaInsets } from '@/src/hooks/useRawSafeAreaInsets';
import { X, Search, UserPlus, Check } from 'lucide-react-native';
import { useUserSearch, useSelf } from '@/src/hooks/useUsers';
import { User } from '@/src/machines/appStateMachine';
import { callService } from '@/src/services/Call/callService';
import { styles } from './styles';
import Avatar from '../../ui/avatar';
import { callColors } from '../callTheme';

interface InviteUserDrawerProps {
  isVisible: boolean;
  onClose: () => void;
  callId: string;
}

export function InviteUserDrawer({
  isVisible,
  onClose,
  callId,
}: InviteUserDrawerProps): React.ReactElement {
  const insets = useRawSafeAreaInsets();
  const currentUser = useSelf();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Search users using the hook
  const searchResults = useUserSearch(searchQuery, 15);

  // Filter out current user and already selected users
  const availableUsers = useMemo(() => {
    if (!searchResults) return [];

    return searchResults.filter(user => {
      // Exclude current user
      if (user.id === currentUser?.id) return false;
      // Exclude already selected users
      if (selectedUsers.some(selected => selected.id === user.id)) return false;
      return true;
    });
  }, [searchResults, currentUser?.id, selectedUsers]);

  // Get display name for user
  const getUserDisplayName = (user: User): string => {
    return user.name ?? user.email ?? 'Unknown User';
  };

  const handleUserSelect = useCallback((user: User) => {
    setSelectedUsers(prev => [...prev, user]);
    setSearchQuery('');
    Keyboard.dismiss();
  }, []);

  const handleUserRemove = useCallback((userId: string) => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
  }, []);

  const handleInvite = useCallback(async () => {
    if (selectedUsers.length === 0) return;

    setIsInviting(true);
    setInviteError(null);

    try {
      const userIds = selectedUsers.map(u => u.id);
      await callService.inviteUsers(callId, userIds);

      // Reset and close on success
      setSelectedUsers([]);
      setSearchQuery('');
      onClose();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to invite users';
      setInviteError(errorMessage);
    } finally {
      setIsInviting(false);
    }
  }, [selectedUsers, callId, onClose]);

  const handleClose = useCallback(() => {
    setSearchQuery('');
    setSelectedUsers([]);
    setInviteError(null);
    onClose();
  }, [onClose]);

  // User item component
  const UserItem = ({
    user,
    isSelected,
    onPress,
  }: {
    user: User;
    isSelected?: boolean;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      style={[styles.userItem, isSelected && styles.userItemSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Avatar userIds={[user.id]} size={styles.avatarImage.width} />
      <View style={styles.userInfo}>
        <Text style={styles.userName} numberOfLines={1}>
          {getUserDisplayName(user)}
        </Text>
        <Text style={styles.userEmail} numberOfLines={1}>
          {user.email || ''}
        </Text>
      </View>
      {isSelected && (
        <View style={styles.checkmark}>
          <Check size={16} color='#10B981' />
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType='slide'
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView style={styles.keyboardView} behavior='height'>
        <Pressable style={styles.overlay} onPress={handleClose} />
        <Pressable
          style={[styles.drawer, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onPress={e => e.stopPropagation()}
        >
          {/* Handle bar */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Invite to Call</Text>
              <Text style={styles.subtitle}>Search users to invite to this call</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <X size={16} color='rgba(255,255,255,0.7)' />
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          {/* Selected Users Chips */}
          {selectedUsers.length > 0 && (
            <View style={styles.selectedContainer}>
              <FlatList
                data={selectedUsers}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps='handled'
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <View style={styles.chip}>
                    <Text style={styles.chipText} numberOfLines={1}>
                      {getUserDisplayName(item)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleUserRemove(item.id)}
                      style={styles.chipRemove}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <X size={14} color='rgba(255,255,255,0.45)' />
                    </TouchableOpacity>
                  </View>
                )}
                contentContainerStyle={styles.chipsContent}
              />
            </View>
          )}

          {/* Search Input */}
          <View style={styles.searchContainer}>
            <Search size={20} color='#6B7280' style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder='Search by name or email...'
              placeholderTextColor='#6B7280'
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize='none'
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
                <X size={18} color='#6B7280' />
              </TouchableOpacity>
            )}
          </View>

          {/* Error Message */}
          {inviteError && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{inviteError}</Text>
            </View>
          )}

          {/* User List */}
          <View style={styles.listContainer}>
            {searchQuery.trim() === '' ? (
              <View style={styles.emptyState}>
                <UserPlus size={40} color='rgba(255,255,255,0.2)' />
                <Text style={styles.emptyStateText}>Start typing to search for users</Text>
              </View>
            ) : availableUsers.length === 0 ? (
              <View style={styles.emptyState}>
                <Search size={40} color='rgba(255,255,255,0.2)' />
                <Text style={styles.emptyStateText}>
                  No users found matching &quot;{searchQuery}&quot;
                </Text>
              </View>
            ) : (
              <View style={styles.listCard}>
                <FlatList
                  data={availableUsers}
                  keyExtractor={item => item.id}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps='handled'
                  ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
                  renderItem={({ item }) => (
                    <UserItem user={item} onPress={() => handleUserSelect(item)} />
                  )}
                  contentContainerStyle={styles.listContent}
                />
              </View>
            )}
          </View>

          {/* Invite Button */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[
                styles.inviteButton,
                (selectedUsers.length === 0 || isInviting) && styles.inviteButtonDisabled,
              ]}
              onPress={handleInvite}
              disabled={selectedUsers.length === 0 || isInviting}
              activeOpacity={0.7}
            >
              {isInviting ? (
                <ActivityIndicator size='small' color={callColors.onColor} />
              ) : (
                <>
                  <UserPlus size={20} color={callColors.onColor} />
                  <Text style={styles.inviteButtonText}>
                    Invite{selectedUsers.length > 0 ? ` (${selectedUsers.length})` : ''}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
