import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output, like the other tests here.
import { findMeetingLinks, parseMeetingLink } from '../dist/utils/meetingLinks.js';

const CLASSIC =
  'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZmFrZTEyMzQtZmFrZQ%40thread.v2/0?context=%7b%22Tid%22%3a%22t-1%22%2c%22Oid%22%3a%22o-1%22%7d&anon=true';

test('Google Meet links normalise to https://meet.google.com/<code>', () => {
  assert.deepEqual(parseMeetingLink('meet.google.com/ABC-defg-hij?authuser=1'), {
    platform: 'google_meet',
    code: 'abc-defg-hij',
    url: 'https://meet.google.com/abc-defg-hij',
  });
  assert.equal(parseMeetingLink('https://meet.google.com/landing'), null);
});

test('classic Teams links keep the thread, message and context only', () => {
  const link = parseMeetingLink(CLASSIC);
  assert.equal(link?.platform, 'teams');
  assert.equal(link?.code, 'ZmFrZTEyMzQt');
  const url = new URL(link.url);
  assert.equal(url.pathname, '/l/meetup-join/19%3Ameeting_ZmFrZTEyMzQtZmFrZQ%40thread.v2/0');
  assert.equal(url.searchParams.get('context'), '{"Tid":"t-1","Oid":"o-1"}');
  assert.equal(url.searchParams.get('anon'), null);
  // The same meeting written differently is the same canonical link.
  assert.equal(parseMeetingLink(CLASSIC.replace('%3a', '%3A').replace('&anon=true', ''))?.url, link.url);
});

test('short Teams links keep the passcode', () => {
  assert.deepEqual(parseMeetingLink('https://teams.microsoft.com/meet/2345678901234?p=AbCdEf&x=1'), {
    platform: 'teams',
    code: '2345678901234',
    url: 'https://teams.microsoft.com/meet/2345678901234?p=AbCdEf',
  });
  assert.equal(parseMeetingLink('https://teams.live.com/meet/9876543210?p=zz')?.platform, 'teams');
});

test('other links are not meetings', () => {
  for (const raw of ['https://zoom.us/j/123', 'https://teams.microsoft.com/', 'https://evil.example/meet/123456789', 'not a url']) {
    assert.equal(parseMeetingLink(raw), null, raw);
  }
});

test('finds links in invite bodies, including Outlook safe links', () => {
  const safe = `https://nam12.safelinks.protection.outlook.com/?url=${encodeURIComponent('https://teams.microsoft.com/meet/1234567890?p=x')}&data=1`;
  const html = `<p>Join: <a href="${CLASSIC.replace(/&/g, '&amp;')}">Join the meeting now</a></p>
    or ${safe}. Also https://meet.google.com/abc-defg-hij, and again https://meet.google.com/abc-defg-hij`;
  assert.deepEqual(
    findMeetingLinks(html).map((l) => l.url),
    [
      parseMeetingLink(CLASSIC).url,
      'https://teams.microsoft.com/meet/1234567890?p=x',
      'https://meet.google.com/abc-defg-hij',
    ],
  );
});
