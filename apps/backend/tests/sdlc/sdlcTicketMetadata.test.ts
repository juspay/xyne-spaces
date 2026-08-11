import { mergeSdlcTicketMetadata } from '../../src/sdlc/sdlcTicketMetadata';

void test('adds repository SDLC identity while preserving caller metadata', () => {
  expect(mergeSdlcTicketMetadata({ source: 'AI' }, 'repo-1')).toEqual({
    source: 'AI',
    surface: 'SDLC',
    repoId: 'repo-1',
  });
  expect(mergeSdlcTicketMetadata(null, 'repo-1')).toEqual({
    surface: 'SDLC',
    repoId: 'repo-1',
  });
});
