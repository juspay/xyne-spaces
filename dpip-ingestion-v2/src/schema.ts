import type { DpipTableName } from './types';

export type DpipFieldType = 'text' | 'date' | 'bigint';

export interface DpipTableSpec {
  fields: Readonly<Record<string, DpipFieldType>>;
  key: readonly string[];
}

export const DPIP_TABLE_SPECS: Readonly<Record<DpipTableName, DpipTableSpec>> = {
  reports: {
    fields: {
      identifier_type: 'text',
      reported_date: 'date',
      party_id: 'text',
      sub_source: 'text',
      status: 'text',
      customer_type: 'text',
      metrics_type: 'text',
      metrics_value: 'bigint',
    },
    key: [
      'identifier_type',
      'reported_date',
      'party_id',
      'sub_source',
      'status',
      'customer_type',
      'metrics_type',
    ],
  },
  screenings: {
    fields: {
      screening_date: 'date',
      party_id: 'text',
      event_type: 'text',
      screening_status: 'text',
      count: 'bigint',
    },
    key: ['screening_date', 'party_id', 'event_type', 'screening_status'],
  },
  cluster_external_entities: {
    fields: {
      cluster_count: 'bigint',
      num_external_entities: 'bigint',
      last_updated_date: 'date',
    },
    key: ['num_external_entities', 'last_updated_date'],
  },
  external_entity_identifiers: {
    fields: {
      party_id: 'text',
      external_entity_count: 'bigint',
      num_identifiers: 'bigint',
      last_updated_date: 'date',
    },
    key: ['party_id', 'num_identifiers', 'last_updated_date'],
  },
  cluster_identifiers: {
    fields: {
      cluster_count: 'bigint',
      num_identifiers: 'bigint',
      last_updated_date: 'date',
    },
    key: ['num_identifiers', 'last_updated_date'],
  },
  party_identifiers: {
    fields: {
      party_ids: 'text',
      num_identifiers: 'bigint',
      last_updated_date: 'date',
    },
    key: ['party_ids', 'last_updated_date'],
  },
  entities_by_customer: {
    fields: {
      party_id: 'text',
      customer_type: 'text',
      entity_count: 'bigint',
      last_updated_date: 'date',
    },
    key: ['party_id', 'customer_type', 'last_updated_date'],
  },
};
