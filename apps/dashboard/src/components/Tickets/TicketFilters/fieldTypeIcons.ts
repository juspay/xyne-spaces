import { ToggleLeft } from 'lucide-react';
import {
  BarchartDefault as BarChart3,
  CalendarDefault as Calendar,
  FileText,
  Hashtag as Hash,
  UserDefault as User,
} from '@xyne/icons';
import { FormFieldType } from '@xyne/shared';

export const getIconForFieldType = (fieldType: FormFieldType): typeof BarChart3 => {
  switch (fieldType) {
    case FormFieldType.STRING:
    case FormFieldType.NUMBER:
      return FileText;
    case FormFieldType.DATE:
      return Calendar;
    case FormFieldType.BOOLEAN:
      return ToggleLeft;
    case FormFieldType.SINGLE_SELECT:
    case FormFieldType.MULTI_SELECT:
      return BarChart3;
    case FormFieldType.USER:
      return User;
    default:
      return Hash;
  }
};
