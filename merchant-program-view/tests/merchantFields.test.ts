import { describe, expect, it } from 'vitest';
import { discoverMerchantFields, isMerchantFieldName, parseMids, resolveMids } from '../lib/merchantFields';
import { ticket } from './fixtures';

describe('isMerchantFieldName', () => {
  it('matches Merchant Id / Merchant ID / MID in any case and spacing', () => {
    for (const n of ['Merchant Id', 'Merchant ID', 'merchant_id', ' MID ', 'mid', 'MerchantId']) expect(isMerchantFieldName(n)).toBe(true);
    for (const n of ['Merchant Followup', 'Merchant', 'Sub MID', null, undefined, '']) expect(isMerchantFieldName(n)).toBe(false);
  });
});

describe('parseMids', () => {
  it('splits comma lists, trims, dedupes and drops placeholders', () => {
    expect(parseMids('tvsmotor, tvspayout ,tvsmotor')).toEqual(['tvsmotor', 'tvspayout']);
    expect(parseMids('  smallcase ')).toEqual(['smallcase']);
    expect(parseMids('NA')).toEqual([]);
    expect(parseMids('ALL,n/a,None,null,-,SBX MID,tbd,acme')).toEqual(['acme']);
    expect(parseMids('Any, Multiple, various, For all merchants, all merchants, acme')).toEqual(['acme']);
    expect(parseMids('for all merchants with 0 rollout for now, acme')).toEqual(['acme']);
    expect(parseMids('juspay test')).toEqual(['juspay test']);
    expect(parseMids(['a', 'b,c'])).toEqual(['a', 'b', 'c']);
    expect(parseMids(37593)).toEqual(['37593']);
    expect(parseMids(null)).toEqual([]);
    expect(parseMids('')).toEqual([]);
    expect(parseMids({ x: 1 })).toEqual([]);
  });
});

describe('resolveMids', () => {
  const fields = new Set(['f-mid', 'f-select']);
  it('uses the column plus every merchant custom field', () => {
    const t = {
      ...ticket('t1', { merchantId: 'acme' }),
      formEntityValues: [
        { fieldId: 'f-mid', fieldValue: '', actualFieldValue: 'smallcase' },
        { fieldId: 'f-select', fieldValue: 'tvsmotor,tvspayout', actualFieldValue: 'tvsmotor,tvspayout' },
        { fieldId: 'f-other', fieldValue: 'ignored', actualFieldValue: 'ignored' },
      ],
    };
    expect(resolveMids(t, fields)).toEqual(['acme', 'smallcase', 'tvsmotor', 'tvspayout']);
  });

  it('falls back to fieldValue when actualFieldValue is empty, and handles no fields', () => {
    const t = { ...ticket('t2'), formEntityValues: [{ fieldId: 'f-mid', fieldValue: 'bms', actualFieldValue: '' }] };
    expect(resolveMids(t, fields)).toEqual(['bms']);
    expect(resolveMids(ticket('t3', { merchantId: '  ' }), fields)).toEqual([]);
  });
});

describe('discoverMerchantFields', () => {
  const forms = [
    {
      id: 'form-board',
      formFields: [
        { id: 'local-1', globalFieldId: null, fieldName: 'Merchant ID', globalField: null },
        { id: 'local-2', globalFieldId: null, fieldName: 'Tone', globalField: null },
      ],
      formContextMappings: [{ contextId: 'b-euler', contextType: 'BOARD' }, { contextId: 'stage-1', contextType: 'STAGE' }],
    },
    {
      id: 'form-transition',
      formFields: [{ id: 'x', globalFieldId: 'g-mid', fieldName: null, globalField: { fieldName: 'Merchant Id', projectId: 'p-ms' } }],
      formContextMappings: [],
    },
    { id: 'form-unrelated', formFields: [{ id: 'y', globalFieldId: null, fieldName: 'Tone', globalField: null }], formContextMappings: [{ contextId: 'b-other', contextType: 'BOARD' }] },
  ];
  it('returns merchant field ids (global id when shared) and the projects that can carry them', () => {
    const out = discoverMerchantFields(forms, new Map([['b-euler', 'p-euler'], ['b-other', 'p-other']]));
    expect(out.fieldIds.sort()).toEqual(['g-mid', 'local-1']);
    expect(out.projectIds.sort()).toEqual(['p-euler', 'p-ms']);
  });

  it('tolerates forms without field or mapping lists', () => {
    expect(discoverMerchantFields([{ id: 'f' }], new Map())).toEqual({ fieldIds: [], projectIds: [] });
  });
});
