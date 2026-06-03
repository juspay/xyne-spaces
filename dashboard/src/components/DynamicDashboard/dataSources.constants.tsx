import type { ReactElement } from 'react';
import { ClickhouseIcon, PostgresIcon, XyneSpacesIcon } from '../../assets/icons';

export type SourceType = 'postgres' | 'clickhouse' | 'xyne';

export type ApiSourceType = Extract<SourceType, 'postgres' | 'clickhouse'>;

export interface SourceTypeMeta {
  id: SourceType;
  label: string;
  disabled?: boolean;
  icon: ReactElement;
}

export const SOURCE_TYPES: SourceTypeMeta[] = [
  { id: 'postgres', label: 'Postgres', icon: <PostgresIcon /> },
  { id: 'clickhouse', label: 'Clickhouse', icon: <ClickhouseIcon /> },
  { id: 'xyne', label: 'Xyne Spaces', icon: <XyneSpacesIcon />, disabled: true },
];

export const DEFAULT_PORTS: Record<ApiSourceType, string> = {
  postgres: '5432',
  clickhouse: '8123',
};
