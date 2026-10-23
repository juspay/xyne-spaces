import { create } from 'zustand';

interface UserGroupDialogStore {
  groupId: string | null;
  isOpen: boolean;
  open: (groupId: string) => void;
  close: () => void;
}

export const useUserGroupDialog = create<UserGroupDialogStore>(set => ({
  groupId: null,
  isOpen: false,
  open: groupId => set({ groupId, isOpen: true }),
  close: () => set({ isOpen: false }),
}));
