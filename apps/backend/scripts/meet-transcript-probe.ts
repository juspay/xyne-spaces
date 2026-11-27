#!/usr/bin/env npx tsx
/**
 * Checks what the Google Meet REST API gives one Xyne user for one meeting:
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/meet-transcript-probe.ts <user-email> <meet-link-or-code> [--enable]
 *
 * Prints the scopes the user's Google Calendar connection has, the meeting's
 * transcription setting, its past sittings and their transcripts (speaker: text).
 * `--enable` turns automatic transcription on for the meeting first (organiser only).
 *
 * Needs GOOGLE_MEET_TRANSCRIPTS_ENABLED=true and the user to have reconnected Google
 * Calendar since, so the connection carries the Meet scopes.
 */
import { PrismaClient } from '@prisma/client';
import { AuthProvider } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { getCalendarCredentialsBySourceId } from '@/services/calendarTokenRefresh';
import {
  GoogleMeetApiError,
  enableMeetAutoTranscription,
  getMeetSpace,
  listMeetConferenceRecords,
  listMeetParticipants,
  listMeetTranscriptEntries,
  listMeetTranscripts,
  meetCodeFrom,
  meetParticipantName,
} from '@/services/googleMeetApi';

const MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.';

async function step<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    const detail = error instanceof GoogleMeetApiError ? `${error.status} ${error.body.slice(0, 400)}` : String(error);
    console.log(`  ✗ ${label}: ${detail}`);
    return null;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const enable = args.includes('--enable');
  const [email, link] = args.filter((arg) => !arg.startsWith('--'));
  const code = link ? meetCodeFrom(link) : null;
  if (!email || !code) {
    console.error('Usage: npx dotenv -e .env.local -- npx tsx scripts/meet-transcript-probe.ts <user-email> <meet-link-or-code> [--enable]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  await prisma.$disconnect();
  if (!user) throw new Error(`No Xyne user with email ${email}`);
  const source = await repositories.externalSources.findCalendarSourceByOwner(user.id, 'GOOGLE');
  if (!source) throw new Error(`${email} hasn't connected Google Calendar in Xyne`);
  const credentials = await getCalendarCredentialsBySourceId(source.id, AuthProvider.GOOGLE);
  if (!credentials?.accessToken) throw new Error(`No usable Google token for ${email}: reconnect Google Calendar`);
  const token = credentials.accessToken;

  console.log(`\n1. Scopes on ${email}'s Google connection`);
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  const scopes = info.ok ? String(((await info.json()) as { scope?: string }).scope ?? '').split(' ') : [];
  for (const scope of scopes) console.log(`  ${scope.startsWith(MEET_SCOPE) ? '✓' : ' '} ${scope}`);
  if (!scopes.some((scope) => scope.startsWith(MEET_SCOPE))) {
    console.log('  ✗ No Meet scope: set GOOGLE_MEET_TRANSCRIPTS_ENABLED=true, restart the backend, reconnect Google Calendar.');
  }

  console.log(`\n2. Meeting ${code}`);
  if (enable) {
    const enabled = await step('turn automatic transcription on', () => enableMeetAutoTranscription(token, code));
    if (enabled) console.log('  ✓ automatic transcription turned on');
  }
  const space = await step('read meeting settings', () => getMeetSpace(token, code));
  if (space) {
    const auto = space.config?.artifactConfig?.transcriptionConfig?.autoTranscriptionGeneration ?? 'not set';
    console.log(`  space: ${space.name} · access: ${space.config?.accessType ?? '?'} · automatic transcription: ${auto}`);
  }

  console.log('\n3. Past sittings and transcripts');
  const records = (await step('list conference records', () => listMeetConferenceRecords(token, code))) ?? [];
  if (!records.length) console.log('  none visible to this user (not the organiser, or the meeting never ran)');
  for (const record of records) {
    console.log(`  ${record.name} · ${record.startTime ?? '?'} → ${record.endTime ?? 'still running'}`);
    const transcripts = (await step('list transcripts', () => listMeetTranscripts(token, record.name))) ?? [];
    if (!transcripts.length) console.log('    no transcript (transcription was not on)');
    const participants = (await step('list participants', () => listMeetParticipants(token, record.name))) ?? [];
    const names = new Map(participants.map((participant) => [participant.name, meetParticipantName(participant)]));
    for (const transcript of transcripts) {
      const entries = (await step('list entries', () => listMeetTranscriptEntries(token, transcript.name))) ?? [];
      console.log(`    ${transcript.name} · ${transcript.state} · ${entries.length} lines · doc: ${transcript.docsDestination?.exportUri ?? 'none yet'}`);
      for (const entry of entries.slice(0, 15)) {
        console.log(`      [${entry.startTime ?? ''}] ${names.get(entry.participant ?? '') ?? 'Unknown speaker'}: ${entry.text ?? ''}`);
      }
      if (entries.length > 15) console.log(`      … ${entries.length - 15} more`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
