import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NAVIGATION_ACTIONS,
  availableActions,
  jevActions,
  webUrl,
  type NavigationAccess,
} from '@/src/features/xyne-ai/navigation/catalog';

// The limits of `assistantRouteBodySchema` in apps/backend/src/validators/assistantRouteValidator.ts.
const MAX_ACTIONS = 250;
const MAX_ID_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 2000;
const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

const NO_ACCESS: NavigationAccess = {
  spaces: false,
  tickets: false,
  beta: false,
  joinRequests: false,
  workspace: false,
  members: false,
  userGroups: false,
  roles: false,
};
const FULL_ACCESS = Object.fromEntries(
  Object.keys(NO_ACCESS).map(key => [key, true]),
) as unknown as NavigationAccess;

const idsFor = (access: NavigationAccess): string[] => availableActions(access).map(({ id }) => id);

describe('catalog', () => {
  const actions = jevActions(NAVIGATION_ACTIONS);

  it('stays within the backend limits', () => {
    assert.ok(actions.length >= 1 && actions.length <= MAX_ACTIONS);
    assert.equal(new Set(actions.map(({ id }) => id)).size, actions.length);
    for (const { id, description } of actions) {
      assert.ok(id.length <= MAX_ID_LENGTH, id);
      assert.match(id, ID_PATTERN);
      assert.notEqual(id, 'none');
      assert.equal(description, description.trim(), id);
      assert.ok(description.length > 0 && description.length <= MAX_DESCRIPTION_LENGTH, id);
      assert.match(description, /Examples: "/, id);
    }
  });

  it('gives every action a title', () => {
    for (const { id, title } of NAVIGATION_ACTIONS) assert.ok(title.length > 0, id);
  });

  it('only points at actions that exist from "instead" hints', () => {
    const ids = new Set(NAVIGATION_ACTIONS.map(({ id }) => id));
    for (const { intent } of NAVIGATION_ACTIONS) {
      for (const { instead } of intent.notFor ?? []) {
        const hint = instead.match(/^that is (\w+)/)?.[1];
        if (hint) assert.ok(ids.has(hint), hint);
      }
    }
  });
});

describe('availableActions', () => {
  it('offers only the ungated actions to a user with no access', () => {
    const ids = idsFor(NO_ACCESS);
    assert.ok(ids.includes('open_settings'));
    assert.ok(ids.includes('create_agent'));
    for (const gated of ['open_desks', 'open_beta', 'open_join_requests', 'start_chat']) {
      assert.ok(!ids.includes(gated), gated);
    }
    for (const admin of ['invite_people', 'manage_members', 'manage_user_groups', 'manage_roles']) {
      assert.ok(!ids.includes(admin), admin);
    }
  });

  it('offers every action to a user with full access', () => {
    assert.equal(availableActions(FULL_ACCESS).length, NAVIGATION_ACTIONS.length);
  });

  it('gates each action on its own access', () => {
    assert.deepEqual(
      idsFor({ ...NO_ACCESS, tickets: true }).filter(id => !idsFor(NO_ACCESS).includes(id)),
      ['open_desks'],
    );
    assert.deepEqual(
      idsFor({ ...NO_ACCESS, spaces: true }).filter(id => !idsFor(NO_ACCESS).includes(id)),
      ['start_chat', 'create_channel'],
    );
    assert.deepEqual(
      idsFor({ ...NO_ACCESS, roles: true }).filter(id => !idsFor(NO_ACCESS).includes(id)),
      ['manage_roles'],
    );
  });
});

describe('webUrl', () => {
  it('opens a dashboard page of the workspace', () => {
    assert.equal(
      webUrl('https://dash.example.net', 'w1', 'organisations/members'),
      'https://dash.example.net/w1/organisations/members',
    );
  });
});
