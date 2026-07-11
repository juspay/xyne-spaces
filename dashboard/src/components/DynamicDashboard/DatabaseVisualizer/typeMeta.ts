import {
  Hash,
  Type,
  Calendar,
  ToggleLeft,
  Braces,
  Brackets,
  Binary,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';
import type { DataSourceColumn } from '../../../services/DynamicDashboard/dataSourceSchemaService';

type Canonical = DataSourceColumn['dataTypeCanonical'];

export interface TypeMeta {
  label: string;
  Icon: LucideIcon;
  className: string; // icon color — categorical palette, see plan Global Constraints
}

export const TYPE_META: Record<Canonical, TypeMeta> = {
  numeric: { label: 'number', Icon: Hash, className: 'text-blue-500' },
  text: { label: 'text', Icon: Type, className: 'text-emerald-500' },
  temporal: { label: 'date', Icon: Calendar, className: 'text-violet-500' },
  boolean: { label: 'bool', Icon: ToggleLeft, className: 'text-amber-500' },
  json: { label: 'json', Icon: Braces, className: 'text-pink-500' },
  array: { label: 'array', Icon: Brackets, className: 'text-cyan-500' },
  binary: { label: 'binary', Icon: Binary, className: 'text-muted-foreground' },
  unknown: { label: 'unknown', Icon: HelpCircle, className: 'text-muted-foreground' },
};
