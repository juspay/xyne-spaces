import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildListSyncPayload } from '@/src/utils/listSyncTelemetry';

describe('buildListSyncPayload — latency', () => {
  it('emits query latency and omits total latency when the two are equal', () => {
    const payload = buildListSyncPayload({
      listType: 'dm_list',
      stage: 'first_time',
      listStartedAtMs: 100,
      queryStartedAtMs: 100,
      completedAtMs: 250,
      hadInitialData: false,
      visibleRowCount: 5,
      dataSource: 'zero_run',
    });
    assert.equal(payload['latency_ms'], 150);
    assert.equal('total_latency_ms' in payload, false);
    assert.equal(payload['status'], 'complete');
    assert.equal(payload['list_type'], 'dm_list');
    assert.equal(payload['data_source'], 'zero_run');
    assert.equal(payload['had_initial_data'], false);
    assert.equal(payload['visible_row_count'], 5);
  });

  it('emits total_latency_ms when the list started before the query', () => {
    const payload = buildListSyncPayload({
      listType: 'channels_list',
      stage: 'warm_cache',
      listStartedAtMs: 0,
      queryStartedAtMs: 100,
      completedAtMs: 250,
      hadInitialData: true,
      visibleRowCount: 3,
      dataSource: 'query_cache',
    });
    assert.equal(payload['latency_ms'], 150);
    assert.equal(payload['total_latency_ms'], 250);
  });

  it('rounds and clamps negative elapsed times to 0', () => {
    const payload = buildListSyncPayload({
      listType: 'calls_list',
      stage: 'live_update',
      listStartedAtMs: 500,
      queryStartedAtMs: 500,
      completedAtMs: 300, // earlier than start
      hadInitialData: false,
      visibleRowCount: 0,
      dataSource: 'zero_subscription',
    });
    assert.equal(payload['latency_ms'], 0);
  });

  it('reports latency_ms null when a timestamp is not finite', () => {
    const payload = buildListSyncPayload({
      listType: 'activity_list',
      stage: 'load_more',
      listStartedAtMs: 0,
      queryStartedAtMs: Number.NaN,
      completedAtMs: 100,
      hadInitialData: false,
      visibleRowCount: 0,
      dataSource: 'zero_run',
    });
    assert.equal(payload['latency_ms'], null);
  });
});

describe('buildListSyncPayload — optional field inclusion', () => {
  const base = {
    listType: 'dm_list' as const,
    stage: 'first_time' as const,
    listStartedAtMs: 0,
    queryStartedAtMs: 0,
    completedAtMs: 10,
    hadInitialData: false,
    visibleRowCount: 0,
    dataSource: 'zero_run' as const,
  };

  it('includes numeric fields even when they are 0, but omits undefined ones', () => {
    const payload = buildListSyncPayload({
      ...base,
      queryRowCount: 0,
      newRows: 0,
      hasMore: false,
      queryComplete: false,
    });
    assert.equal(payload['query_row_count'], 0);
    assert.equal(payload['new_rows'], 0);
    assert.equal(payload['has_more'], false);
    assert.equal(payload['query_complete'], false);
    assert.equal('cache_row_count' in payload, false);
    assert.equal('updated_rows' in payload, false);
    assert.equal('latest_item_at' in payload, false);
  });

  it('omits initial_data_source when it is "none" and includes it otherwise', () => {
    const omitted = buildListSyncPayload({ ...base, initialDataSource: 'none' });
    assert.equal('initial_data_source' in omitted, false);

    const included = buildListSyncPayload({ ...base, initialDataSource: 'boot_cache' });
    assert.equal(included['initial_data_source'], 'boot_cache');
  });

  it('omits empty-string filter/query/error but includes non-empty ones', () => {
    const empty = buildListSyncPayload({ ...base, filterTab: '', queryName: '', error: '' });
    assert.equal('filter_tab' in empty, false);
    assert.equal('query_name' in empty, false);
    assert.equal('error' in empty, false);

    const filled = buildListSyncPayload({
      ...base,
      status: 'error',
      filterTab: 'unread',
      queryName: 'dmListQuery',
      error: 'boom',
    });
    assert.equal(filled['filter_tab'], 'unread');
    assert.equal(filled['query_name'], 'dmListQuery');
    assert.equal(filled['error'], 'boom');
    assert.equal(filled['status'], 'error');
  });
});
