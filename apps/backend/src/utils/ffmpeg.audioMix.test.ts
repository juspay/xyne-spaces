import { buildAgentVideoMixArgs, buildAudioMixArgs } from './ffmpeg';

describe('buildAudioMixArgs', () => {
  it('delays each track by its offset and mixes without normalising levels', () => {
    const args = buildAudioMixArgs(
      [
        { path: '/w/a.ogg', offsetMs: 0 },
        { path: '/w/b.ogg', offsetMs: 2500.4 },
      ],
      '/w/out.mp4',
    );
    expect(args.slice(0, 4)).toEqual(['-nostdin', '-y', '-protocol_whitelist', 'file']);
    expect(args).toEqual(expect.arrayContaining(['-i', '/w/a.ogg', '-i', '/w/b.ogg']));
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toBe(
      '[0:a]adelay=0:all=1[a0];[1:a]adelay=2500:all=1[a1];[a0][a1]amix=inputs=2:normalize=0:dropout_transition=0[out]',
    );
    expect(args.slice(-3)).toEqual(['-f', 'mp4', '/w/out.mp4']);
  });

  it('passes a single track through and refuses none', () => {
    const graph = buildAudioMixArgs([{ path: '/w/a.ogg', offsetMs: 1200 }], '/w/o.mp4');
    expect(graph[graph.indexOf('-filter_complex') + 1]).toBe('[0:a]adelay=1200:all=1[a0];[a0]anull[out]');
    expect(() => buildAudioMixArgs([], '/w/o.mp4')).toThrow(/no tracks/);
  });
});

describe('buildAgentVideoMixArgs', () => {
  it('lays each video stream on a black canvas at its offset and mixes the audio', () => {
    const args = buildAgentVideoMixArgs(
      {
        audio: [{ path: '/w/a.ogg', offsetMs: 300 }],
        video: [
          { path: '/w/s1.ts', offsetMs: 0 },
          { path: '/w/s2.ts', offsetMs: 61_250 },
        ],
        durationMs: 120_000,
      },
      '/w/out.mp4',
    );
    // Audio inputs first, then video: the graph's input indexes depend on it.
    expect(args.filter((_, i) => args[i - 1] === '-i')).toEqual(['/w/a.ogg', '/w/s1.ts', '/w/s2.ts']);
    const graph = args[args.indexOf('-filter_complex') + 1].split(';');
    expect(graph[0]).toBe('color=c=black:s=1280x720:r=15:d=120.000[base]');
    expect(graph[1]).toMatch(/^\[1:v\]setpts=PTS-STARTPTS\+0\.000\/TB,scale=1280:720:.*\[v0\]$/);
    expect(graph[2]).toMatch(/^\[2:v\]setpts=PTS-STARTPTS\+61\.250\/TB,/);
    expect(graph[3]).toBe('[base][v0]overlay=eof_action=pass:repeatlast=0[o0]');
    expect(graph[4]).toBe('[o0][v1]overlay=eof_action=pass:repeatlast=0[vout]');
    expect(graph[5]).toBe('[0:a]adelay=300:all=1[a0]');
    expect(graph[6]).toBe('[a0]anull[aout]');
    expect(args).toEqual(expect.arrayContaining(['-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-t', '120.000']));
    expect(args.slice(-3)).toEqual(['-f', 'mp4', '/w/out.mp4']);
  });

  it('records silence without audio and a black picture without video', () => {
    const args = buildAgentVideoMixArgs({ audio: [], video: [], durationMs: 1500 }, '/w/o.mp4');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toBe('color=c=black:s=1280x720:r=15:d=1.500[base];[base]null[vout];anullsrc=r=48000:cl=mono,atrim=duration=1.500[aout]');
    expect(() => buildAgentVideoMixArgs({ audio: [], video: [], durationMs: 0 }, '/w/o.mp4')).toThrow(/duration/);
  });
});
