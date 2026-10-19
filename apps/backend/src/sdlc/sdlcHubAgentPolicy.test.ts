import { canAddHubMembers } from './sdlcHubAgentPolicy';

describe('canAddHubMembers', () => {
  it('lets only admins add under ADMINS_ONLY, the SDLC hub default', () => {
    expect(canAddHubMembers('ADMIN', 'ADMINS_ONLY')).toBe(true);
    expect(canAddHubMembers('MEMBER', 'ADMINS_ONLY')).toBe(false);
  });

  it('lets any member add under EVERYONE or when no policy is stored', () => {
    expect(canAddHubMembers('MEMBER', 'EVERYONE')).toBe(true);
    expect(canAddHubMembers('MEMBER', null)).toBe(true);
    expect(canAddHubMembers('ADMIN', undefined)).toBe(true);
  });

  it('never lets a non-member add', () => {
    expect(canAddHubMembers(null, 'EVERYONE')).toBe(false);
    expect(canAddHubMembers(undefined, null)).toBe(false);
  });
});
