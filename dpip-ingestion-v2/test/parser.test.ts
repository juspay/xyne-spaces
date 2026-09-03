import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DpipPayloadError,
  parseDpipPayload,
  parseDpipPayloadDetailed,
} from '../src/parser';

function validPayload(): unknown[] {
  return [
    {
      table: 'reports',
      data: [
        [
          'identifier_type',
          'reported_date',
          'party_id',
          'sub_source',
          'status',
          'customer_type',
          'metrics_type',
          'metrics_value',
        ],
        [
          'PAN',
          '2026-07-22',
          'party-1',
          'dpip',
          'MATCHED',
          'ALL',
          'reports_count',
          4,
        ],
      ],
    },
    {
      table: 'screenings',
      data: [
        [
          'screening_date',
          'party_id',
          'event_type',
          'screening_status',
          'count',
        ],
        ['2026-07-22', 'party-1', 'ALL', 'REVIEW', 2],
      ],
    },
    {
      table: 'cluster_external_entities',
      data: [
        [
          'cluster_count',
          'num_external_entities',
          'last_updated_date',
        ],
        [10, 25, '2026-07-22'],
      ],
    },
    {
      table: 'external_entity_identifiers',
      data: [
        [
          'party_id',
          'external_entity_count',
          'num_identifiers',
          'last_updated_date',
        ],
        ['party-1', 25, 80, '2026-07-22'],
      ],
    },
    {
      table: 'cluster_identifiers',
      data: [
        ['cluster_count', 'num_identifiers', 'last_updated_date'],
        [10, 80, '2026-07-22'],
      ],
    },
    {
      table: 'party_identifiers',
      data: [
        ['party_ids', 'num_identifiers', 'last_updated_date'],
        ['party-1, party-2', 80, '2026-07-22'],
      ],
    },
    {
      table: 'entities_by_customer',
      data: [
        ['customer_type', 'entity_count', 'last_updated_date'],
        ['ALL', 25, '2026-07-22'],
      ],
    },
  ];
}

describe('parseDpipPayload', () => {
  it('canonicalizes party identifiers without changing other text fields', () => {
    const payload = validPayload();
    const reports = payload[0] as { data: unknown[][] };
    const screenings = payload[1] as { data: unknown[][] };
    const externalEntityIdentifiers = payload[3] as {
      data: unknown[][];
    };
    const partyIdentifiers = payload[5] as { data: unknown[][] };

    reports.data[1] = [
      'PAN',
      '2026-07-22',
      ' HDFC ',
      'MULE_HUNTER',
      'CONFIRMED',
      'individual',
      'reports_count',
      4,
    ];
    screenings.data[1] = ['2026-07-22', 'PNB', 'ALL', 'NO_MATCH', 2];
    externalEntityIdentifiers.data[1] = [
      ' IcIcI ',
      25,
      80,
      '2026-07-22',
    ];
    partyIdentifiers.data[1] = [
      ' ICICI, HDFC, hdfc ',
      80,
      '2026-07-22',
    ];

    const result = parseDpipPayload(payload);

    assert.equal(result.tables.reports[0]?.party_id, 'hdfc');
    assert.equal(result.tables.reports[0]?.identifier_type, 'PAN');
    assert.equal(result.tables.reports[0]?.sub_source, 'MULE_HUNTER');
    assert.equal(result.tables.reports[0]?.status, 'CONFIRMED');
    assert.equal(result.tables.reports[0]?.customer_type, 'INDIVIDUAL');
    assert.equal(result.tables.screenings[0]?.party_id, 'pnb');
    assert.equal(
      result.tables.screenings[0]?.screening_status,
      'NO_MATCH',
    );
    assert.equal(
      result.tables.external_entity_identifiers[0]?.party_id,
      'icici',
    );
    assert.equal(
      result.tables.party_identifiers[0]?.party_ids,
      'hdfc, icici',
    );
  });

  it('accepts text party ID combinations', () => {
    const payload = validPayload();
    const partyIdentifiers = payload[5] as {
      data: unknown[][];
    };
    partyIdentifiers.data[1] = [
      'hdfc, icici',
      7_520,
      '2026-07-23',
    ];

    const result = parseDpipPayload(payload);

    assert.equal(
      result.tables.party_identifiers[0]?.party_ids,
      'hdfc, icici',
    );
  });

  it('rejects an empty party ID combination', () => {
    const payload = validPayload();
    const partyIdentifiers = payload[5] as {
      data: unknown[][];
    };
    partyIdentifiers.data[1] = ['', 7_520, '2026-07-23'];

    const result = parseDpipPayloadDetailed(payload);

    assert.equal(result.tables.party_identifiers.length, 0);
    assert.equal(result.parseStats.party_identifiers.invalid, 1);
    assert.deepEqual(result.errors[0], {
      table: 'party_identifiers',
      row: 1,
      field: 'party_ids',
      message: 'Must be a non-empty string',
    });
  });

  it('accepts party IDs for external entity identifier counts', () => {
    const result = parseDpipPayload(validPayload());

    assert.equal(
      result.tables.external_entity_identifiers[0]?.party_id,
      'party-1',
    );
  });

  it('rejects an empty external entity party ID', () => {
    const payload = validPayload();
    const externalEntityIdentifiers = payload[3] as {
      data: unknown[][];
    };
    externalEntityIdentifiers.data[1] = ['', 25, 80, '2026-07-22'];

    const result = parseDpipPayloadDetailed(payload);

    assert.equal(result.tables.external_entity_identifiers.length, 0);
    assert.equal(
      result.parseStats.external_entity_identifiers.invalid,
      1,
    );
    assert.deepEqual(result.errors[0], {
      table: 'external_entity_identifiers',
      row: 1,
      field: 'party_id',
      message: 'Must be a non-empty string',
    });
  });

  it('keeps external entity counts for different parties', () => {
    const payload = validPayload();
    const externalEntityIdentifiers = payload[3] as {
      data: unknown[][];
    };
    externalEntityIdentifiers.data.push([
      'party-2',
      25,
      80,
      '2026-07-22',
    ]);

    const result = parseDpipPayloadDetailed(payload);

    assert.equal(result.tables.external_entity_identifiers.length, 2);
    assert.equal(
      result.parseStats.external_entity_identifiers.duplicates,
      0,
    );
  });

  it('parses all seven valid tables and converts integers to bigint', () => {
    const result = parseDpipPayload(validPayload());

    assert.equal(result.errors.length, 0);
    assert.equal(result.tables.reports.length, 1);
    assert.equal(result.tables.reports[0]?.metrics_type, 'reports_count');
    assert.equal(result.tables.reports[0]?.metrics_value, 4n);
    assert.equal(
      result.tables.party_identifiers[0]?.party_ids,
      'party-1, party-2',
    );
    assert.equal(
      result.tables.party_identifiers[0]?.num_identifiers,
      80n,
    );
  });

  it('rejects report metric types that are not in the database constraint', () => {
    const payload = validPayload();
    const reports = payload[0] as { data: unknown[][] };
    reports.data[1] = [
      'PAN',
      '2026-07-22',
      'party-1',
      'dpip',
      'MATCHED',
      'ALL',
      null,
      4,
    ];

    const result = parseDpipPayloadDetailed(payload);

    assert.equal(result.tables.reports.length, 0);
    assert.equal(result.parseStats.reports.invalid, 1);
    assert.equal(result.errors[0]?.field, 'metrics_type');
  });

  it('rejects customer types that are not in the database constraint', () => {
    const payload = validPayload();
    const reports = payload[0] as { data: unknown[][] };
    reports.data[1] = [
      'PAN',
      '2026-07-22',
      'party-1',
      'dpip',
      'MATCHED',
      'SME',
      'reports_count',
      4,
    ];

    const result = parseDpipPayloadDetailed(payload);

    assert.equal(result.tables.reports.length, 0);
    assert.equal(result.parseStats.reports.invalid, 1);
    assert.deepEqual(result.errors[0], {
      table: 'reports',
      row: 1,
      field: 'customer_type',
      message: 'Must be one of: INDIVIDUAL, MERCHANT, ALL',
    });
  });

  it('maps reordered headers by name', () => {
    const payload = validPayload();
    const screenings = payload[1] as {
      data: unknown[][];
    };
    screenings.data = [
      [
        'count',
        'screening_status',
        'event_type',
        'party_id',
        'screening_date',
      ],
      ['2', 'REVIEW', 'ALL', 'party-1', '2026-07-22'],
    ];

    const result = parseDpipPayload(payload);

    assert.deepEqual(result.tables.screenings[0], {
      count: 2n,
      screening_status: 'REVIEW',
      event_type: 'ALL',
      party_id: 'party-1',
      screening_date: '2026-07-22',
    });
  });

  it('accepts JSON containing email-generated br line breaks', () => {
    const body = JSON.stringify(validPayload(), null, 2).replace(
      /\n/g,
      '<br />',
    );

    const result = parseDpipPayload(body);

    assert.equal(result.errors.length, 0);
    assert.equal(result.tables.cluster_identifiers.length, 1);
  });

  it('ignores a Deep Discovery Email Inspector footer', () => {
    const body = `${JSON.stringify(validPayload(), null, 2).replace(
      /\n/g,
      '<br>',
    )}<br>===============================================================<br>This message has been analyzed by Deep Discovery Email Inspector.`;

    const result = parseDpipPayload(body);

    assert.equal(result.errors.length, 0);
    assert.equal(result.tables.external_entity_identifiers.length, 1);
  });

  it('accepts HTML line-break variants inside quoted party identifiers', () => {
    for (const lineBreak of [
      '\r<br>',
      '\n<br/>',
      '\r\n<br />',
      '<BR class="email-break">',
    ]) {
      const body = `${JSON.stringify(validPayload()).replace(
        'party-1, party-2',
        `party-1,${lineBreak}party-2`,
      )}${lineBreak}============================${lineBreak}Email disclaimer`;

      const result = parseDpipPayload(body);

      assert.equal(
        result.tables.party_identifiers[0]?.party_ids,
        'party-1, party-2',
      );
    }
  });

  it('preserves separator-like text inside JSON strings', () => {
    const payload = validPayload();
    const reports = payload[0] as { data: unknown[][] };
    reports.data[1]![3] = 'dpip<br>===<br>ingestion';

    const result = parseDpipPayload(JSON.stringify(payload));

    assert.equal(result.tables.reports[0]?.sub_source, 'dpip === ingestion');
  });

  it('accepts valid JSON wrapped in Outlook div elements and HTML entities', () => {
    const body = JSON.stringify(validPayload(), null, 2)
      .split('\n')
      .map(
        (line) =>
          `<div class="elementToProof">&nbsp;${line
            .replace(/ /g, '&nbsp;')
            .replace(/"/g, '&quot;')}</div>`,
      )
      .join('\n');

    const result = parseDpipPayload(body);

    assert.equal(result.errors.length, 0);
    assert.equal(result.tables.reports.length, 1);
    assert.equal(
      result.tables.party_identifiers[0]?.party_ids,
      'party-1, party-2',
    );
  });

  it('preserves bigint precision from canonical integer strings', () => {
    const payload = validPayload();
    const relationship = payload[5] as {
      data: unknown[][];
    };
    relationship.data[1] = [
      'party-1, party-2',
      '900719925474099312345',
      '2026-07-22',
    ];

    const result = parseDpipPayload(payload);

    assert.equal(
      result.tables.party_identifiers[0]?.num_identifiers,
      900719925474099312345n,
    );
  });

  it('skips invalid rows and keeps valid rows', () => {
    const payload = validPayload();
    const reports = payload[0] as {
      data: unknown[][];
    };
    reports.data.push(
      [
        'PAN',
        '2026-02-30',
        'party-2',
        'dpip',
        'MATCHED',
        'ALL',
        'reports_count',
        1,
      ],
      [
        'PAN',
        '2026-07-23',
        'party-3',
        'dpip',
        'MATCHED',
        'ALL',
        'reports_count',
        -1,
      ],
      [
        'PAN',
        '2026-07-23',
        '',
        'dpip',
        'MATCHED',
        'ALL',
        'reports_count',
        1,
      ],
      ['PAN', '2026-07-23'],
    );

    const result = parseDpipPayloadDetailed(payload);

    assert.equal(result.tables.reports.length, 1);
    assert.equal(result.parseStats.reports.received, 5);
    assert.equal(result.parseStats.reports.invalid, 4);
    assert.equal(result.errors.length, 4);
    assert.deepEqual(
      result.errors.map((error) => error.row),
      [2, 3, 4, 5],
    );
  });

  it('rejects unsafe JSON numbers instead of losing precision', () => {
    const payload = validPayload();
    const relationship = payload[5] as {
      data: unknown[][];
    };
    relationship.data[1] = [
      'party-1, party-2',
      Number.MAX_SAFE_INTEGER + 1,
      '2026-07-22',
    ];

    const result = parseDpipPayloadDetailed(payload);

    assert.equal(result.tables.party_identifiers.length, 0);
    assert.equal(result.parseStats.party_identifiers.invalid, 1);
    assert.equal(result.errors[0]?.field, 'num_identifiers');
  });

  it('keeps last duplicate row and reports earlier row', () => {
    const payload = validPayload();
    const reports = payload[0] as {
      data: unknown[][];
    };
    reports.data.push([
      'PAN',
      '2026-07-22',
      'party-1',
      'dpip',
      'MATCHED',
      'ALL',
      'reports_count',
      40,
    ]);

    const result = parseDpipPayloadDetailed(payload);

    assert.equal(result.tables.reports.length, 1);
    assert.equal(result.tables.reports[0]?.metrics_value, 40n);
    assert.equal(result.parseStats.reports.duplicates, 1);
    assert.deepEqual(result.errors[0], {
      table: 'reports',
      row: 1,
      message: 'Duplicate key superseded by a later row',
    });
  });

  it('rejects malformed JSON', () => {
    assert.throws(
      () => parseDpipPayload('[invalid'),
      (error: unknown) =>
        error instanceof DpipPayloadError &&
        error.message === 'Invalid JSON',
    );
  });

  it('rejects a missing table', () => {
    const payload = validPayload();
    payload.pop();

    assert.throws(
      () => parseDpipPayload(payload),
      /Missing tables: entities_by_customer/,
    );
  });

  it('rejects an unknown table', () => {
    const payload = validPayload();
    (payload[5] as { table: string }).table = 'unknown';

    assert.throws(() => parseDpipPayload(payload), /Unknown table: unknown/);
  });

  it('rejects a repeated table', () => {
    const payload = validPayload();
    (payload[5] as { table: string }).table = 'reports';

    assert.throws(() => parseDpipPayload(payload), /Repeated table: reports/);
  });

  it('rejects invalid headers', () => {
    const payload = validPayload();
    const screenings = payload[1] as {
      data: unknown[][];
    };
    screenings.data[0] = [
      'screening_date',
      'party_id',
      'event_type',
      'screening_status',
      'wrong',
    ];

    assert.throws(
      () => parseDpipPayload(payload),
      /Invalid headers for table: screenings/,
    );
  });
});
