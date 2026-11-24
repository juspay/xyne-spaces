import {
  GoogleMeetApiError,
  enableMeetAutoTranscription,
  listMeetTranscriptEntries,
  meetCodeFrom,
  meetParticipantName,
} from './googleMeetApi';

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

describe('meetCodeFrom', () => {
  it('reads the code from a link or a bare code', () => {
    expect(meetCodeFrom('https://meet.google.com/abc-defg-hij?authuser=0')).toBe('abc-defg-hij');
    expect(meetCodeFrom('ABC-DEFG-HIJ')).toBe('abc-defg-hij');
  });

  it('rejects anything else', () => {
    expect(meetCodeFrom('https://teams.microsoft.com/l/meetup-join/1')).toBeNull();
    expect(meetCodeFrom('')).toBeNull();
  });
});

describe('meetParticipantName', () => {
  it('uses whichever kind of participant it is', () => {
    expect(meetParticipantName({ name: 'p', signedinUser: { displayName: 'Asha' } })).toBe('Asha');
    expect(meetParticipantName({ name: 'p', anonymousUser: { displayName: 'Guest' } })).toBe('Guest');
    expect(meetParticipantName(undefined)).toBe('Unknown speaker');
  });
});

describe('Meet API calls', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('turns automatic transcription on through the space name, not the code', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ name: 'spaces/xyz', config: {} }))
      .mockResolvedValueOnce(json({ name: 'spaces/xyz' }));
    await enableMeetAutoTranscription('tok', 'abc-defg-hij');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(
      'https://meet.googleapis.com/v2/spaces/xyz?updateMask=config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration',
    );
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      config: { artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: 'ON' } } },
    });
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it("doesn't edit a meeting that already transcribes", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ name: 'spaces/xyz', config: { artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: 'ON' } } } }),
    );
    await enableMeetAutoTranscription('tok', 'abc-defg-hij');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads every page of a transcript', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ transcriptEntries: [{ name: 'e1' }], nextPageToken: 'next' }))
      .mockResolvedValueOnce(json({ transcriptEntries: [{ name: 'e2' }] }));
    const entries = await listMeetTranscriptEntries('tok', 'conferenceRecords/r/transcripts/t');
    expect(entries.map((entry) => entry.name)).toEqual(['e1', 'e2']);
    expect(fetchMock.mock.calls[1][0]).toContain('pageToken=next');
  });

  it('reports the status when Google refuses', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));
    await expect(enableMeetAutoTranscription('tok', 'abc-defg-hij')).rejects.toMatchObject({
      name: 'GoogleMeetApiError',
      status: 403,
    });
    expect(new GoogleMeetApiError(403, 'x')).toBeInstanceOf(Error);
  });
});
