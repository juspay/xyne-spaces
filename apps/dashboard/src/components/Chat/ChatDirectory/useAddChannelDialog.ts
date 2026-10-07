import type { Dispatch, SetStateAction } from 'react';
import { useDialogParam } from '../../../hooks/useDialogParam';

/** Whether the add-channel dialog is open; Xyne Buddy opens it with `?dialog=add_channel`. */
export const useAddChannelDialog = (): [boolean, Dispatch<SetStateAction<boolean>>] =>
  useDialogParam('add_channel');
