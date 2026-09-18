import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GREETING_BEATS,
  GREETING_DAY_OPTIONS,
  GREETING_DROP_OPTIONS,
  GREETING_FALLBACK_NAME,
  GREETING_TEAM_OPTIONS,
  greetingBeatAfter,
  greetingDisplayName,
  greetingHelloText,
  greetingHeroDesktopLines,
  greetingHeroMobileChunks,
  greetingInDurationMs,
  greetingQuestionCanAdvance,
  greetingReadyDelayMs,
} from './onboardingGreeting.ts';

describe('public onboarding greeting sequence', () => {
  it('walks login-adjacent cinematic beats then Figma questions then connectors', () => {
    assert.deepEqual(
      GREETING_BEATS.map(beat => beat.id),
      [
        'hello',
        'tell-us',
        'day',
        'team',
        'drop',
        'connector-empty',
        'connector-talks',
        'connectors',
      ],
    );
    assert.equal(greetingBeatAfter('hello', 'advance'), 'tell-us');
    assert.equal(
      GREETING_BEATS.some(
        beat => 'text' in beat && /workspace feel like your workspace/i.test(beat.text),
      ),
      false,
    );
    assert.equal(greetingBeatAfter('tell-us', 'advance'), 'day');
    assert.equal(
      GREETING_BEATS.some(beat => 'text' in beat && /we'll remember this/i.test(beat.text)),
      false,
    );
    assert.equal(greetingBeatAfter('drop', 'advance'), 'connector-empty');
    assert.equal(greetingBeatAfter('connectors', 'advance'), 'complete');
  });

  it('skips the questions from the tell-us prompt', () => {
    assert.equal(greetingBeatAfter('tell-us', 'skip'), 'connector-empty');
  });

  it('uses Figma question labels, not the dummy wizard copy', () => {
    assert.deepEqual(
      GREETING_DAY_OPTIONS.map(option => option.label),
      ['Building and shipping', 'Keeping things running', 'Leading a team', 'A bit of everything'],
    );
    assert.deepEqual(
      GREETING_TEAM_OPTIONS.map(option => option.label),
      ['Software', 'Payments and finance', 'Healthcare', 'Something else'],
    );
    assert.equal(GREETING_TEAM_OPTIONS.find(option => option.key === 'domain_other')?.input, true);
    assert.equal(
      'muted' in (GREETING_TEAM_OPTIONS.find(option => option.key === 'domain_other') ?? {}),
      false,
    );
    assert.deepEqual(
      GREETING_DROP_OPTIONS.map(option => option.label),
      [
        'Catching up on what I missed',
        'Getting something off my plate',
        'Finding a thing I know exists',
        "Seeing what the team's on",
      ],
    );
  });

  it('requires typed text before advancing from Something else', () => {
    const other = GREETING_TEAM_OPTIONS.find(option => option.key === 'domain_other');
    assert.equal(greetingQuestionCanAdvance(other, ''), false);
    assert.equal(greetingQuestionCanAdvance(other, '   '), false);
    assert.equal(greetingQuestionCanAdvance(other, 'Climate tech'), true);
    assert.equal(greetingQuestionCanAdvance(GREETING_TEAM_OPTIONS[0], ''), true);
    assert.equal(greetingQuestionCanAdvance(null, 'Climate tech'), false);
  });

  it('keeps cinematic titles on a single line', () => {
    const tellUs = "Tell us a little about how you work. We'll take care of the rest.";
    assert.deepEqual(greetingHeroDesktopLines('Hello Devesh'), ['Hello Devesh']);
    assert.deepEqual(greetingHeroDesktopLines(tellUs), [tellUs]);
    assert.deepEqual(greetingHeroMobileChunks(tellUs), [tellUs]);
    assert.equal(greetingHeroDesktopLines("What's your day mostly made of?").length, 1);
    assert.equal(
      greetingHeroDesktopLines('Start with wherever your team actually talks.').length,
      1,
    );
  });

  it('personalises Hello from the login email local-part', () => {
    assert.equal(greetingDisplayName('devesh.prakash@xyne.com'), 'Devesh');
    assert.equal(greetingHelloText(greetingDisplayName('devesh.prakash@xyne.com')), 'Hello Devesh');
    assert.equal(greetingDisplayName(''), GREETING_FALLBACK_NAME);
    assert.equal(greetingHelloText(GREETING_FALLBACK_NAME), `Hello ${GREETING_FALLBACK_NAME}`);
  });

  it('waits for the previous beat to exit before treating enter as ready', () => {
    const enter = greetingInDurationMs(false, 2);
    assert.equal(greetingReadyDelayMs(false, 2, false), enter);
    assert.ok(greetingReadyDelayMs(false, 2, true) > enter);
  });
});
