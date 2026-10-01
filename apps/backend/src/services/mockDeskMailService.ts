import crypto from 'crypto';
import { config } from '@/config/env';

// Mock storage is capped and evicts oldest records first so long CI runs do not
// grow process memory without bound. Tests should not assert exact totals above
// this mock-provider capacity.
const MAX_STORED_MOCK_MAILS = 500;
const MAX_DL_MEMBERS = 100;
const deskMockEnabled = config.isDeskMockEnabled;

function createMockDeskValidationError(message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = 400;
  return error;
}

export interface CapturedDeskMail {
  id: string;
  kind: 'reply' | 'compose';
  status: 'sent';
  channelId: string;
  conversationId?: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  threadId: string;
  messageId: string;
  attachmentCount: number;
  createdAt: string;
}

export interface CaptureDeskMailInput {
  kind: CapturedDeskMail['kind'];
  channelId: string;
  conversationId?: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  threadId?: string;
  attachmentCount?: number;
}

export interface SentMailFilter {
  channelId?: string;
  conversationId?: string;
}

export interface MockDlMail {
  id: string;
  dlEmail: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  createdAt: string;
}

export interface MockDlGroup {
  email: string;
  members: string[];
}

class MockDeskMailService {
  // Mock Desk state is intentionally process-local. Local and CI automation run
  // a single backend process; do not enable DESK_MOCK_ENABLED for horizontally
  // scaled or public-facing deployments.
  private readonly sentMails: CapturedDeskMail[] = [];
  private readonly dlMembersByEmail = new Map<string, Set<string>>();
  private readonly inboxByEmail = new Map<string, MockDlMail[]>();

  isEnabled(): boolean {
    return deskMockEnabled;
  }

  private trimStoredMails<T>(items: T[]): void {
    if (items.length > MAX_STORED_MOCK_MAILS) {
      items.splice(0, items.length - MAX_STORED_MOCK_MAILS);
    }
  }

  captureSentMail(input: CaptureDeskMailInput): CapturedDeskMail {
    const id = `mock-mail-${crypto.randomUUID()}`;
    const threadId = input.threadId || `mock-thread-${crypto.randomUUID()}`;
    const messageId = `mock-message-${crypto.randomUUID()}`;
    const mail: CapturedDeskMail = {
      id,
      kind: input.kind,
      status: 'sent',
      channelId: input.channelId,
      ...(input.conversationId && { conversationId: input.conversationId }),
      from: input.from,
      to: [...new Set(input.to)],
      cc: [...new Set(input.cc ?? [])],
      bcc: [...new Set(input.bcc ?? [])],
      subject: input.subject,
      body: input.body,
      threadId,
      messageId,
      attachmentCount: input.attachmentCount ?? 0,
      createdAt: new Date().toISOString(),
    };

    this.sentMails.push(mail);
    this.trimStoredMails(this.sentMails);
    return mail;
  }

  private matchesSentMailFilter(mail: CapturedDeskMail, filter: SentMailFilter): boolean {
    if (filter.channelId && mail.channelId !== filter.channelId) return false;
    if (filter.conversationId && mail.conversationId !== filter.conversationId) return false;
    return true;
  }

  listSentMails(filter: SentMailFilter = {}): CapturedDeskMail[] {
    return this.sentMails.filter((mail) => this.matchesSentMailFilter(mail, filter));
  }

  reset(filter: SentMailFilter): void {
    for (let index = this.sentMails.length - 1; index >= 0; index -= 1) {
      if (this.matchesSentMailFilter(this.sentMails[index], filter)) {
        this.sentMails.splice(index, 1);
      }
    }
  }

  createDl(email: string): MockDlGroup {
    const normalizedEmail = email.trim().toLowerCase();
    if (!this.dlMembersByEmail.has(normalizedEmail)) {
      this.dlMembersByEmail.set(normalizedEmail, new Set());
    }

    return this.getDl(normalizedEmail);
  }

  getDl(email: string): MockDlGroup {
    const normalizedEmail = email.trim().toLowerCase();
    const members = this.dlMembersByEmail.get(normalizedEmail) ?? new Set<string>();
    return {
      email: normalizedEmail,
      members: [...members].sort(),
    };
  }

  addDlMember(dlEmail: string, memberEmail: string): MockDlGroup {
    const normalizedDlEmail = dlEmail.trim().toLowerCase();
    const normalizedMemberEmail = memberEmail.trim().toLowerCase();
    const members = this.dlMembersByEmail.get(normalizedDlEmail) ?? new Set<string>();
    const isExistingMember = members.has(normalizedMemberEmail);
    if (!isExistingMember && members.size >= MAX_DL_MEMBERS) {
      throw createMockDeskValidationError(`Mock DL member limit (${MAX_DL_MEMBERS}) exceeded`);
    }
    members.add(normalizedMemberEmail);
    this.dlMembersByEmail.set(normalizedDlEmail, members);
    return this.getDl(normalizedDlEmail);
  }

  removeDlMember(dlEmail: string, memberEmail: string): MockDlGroup {
    const normalizedDlEmail = dlEmail.trim().toLowerCase();
    const normalizedMemberEmail = memberEmail.trim().toLowerCase();
    const members = this.dlMembersByEmail.get(normalizedDlEmail);
    members?.delete(normalizedMemberEmail);
    return this.getDl(normalizedDlEmail);
  }

  sendToDl(input: { dlEmail: string; from: string; subject: string; body: string }): MockDlMail {
    const normalizedDlEmail = input.dlEmail.trim().toLowerCase();
    const members = this.dlMembersByEmail.get(normalizedDlEmail) ?? new Set<string>();
    const mail: MockDlMail = {
      id: `mock-dl-mail-${crypto.randomUUID()}`,
      dlEmail: normalizedDlEmail,
      from: input.from.trim().toLowerCase(),
      to: [...members].sort(),
      subject: input.subject,
      body: input.body,
      createdAt: new Date().toISOString(),
    };

    for (const member of members) {
      const inbox = this.inboxByEmail.get(member) ?? [];
      inbox.push(mail);
      this.trimStoredMails(inbox);
      this.inboxByEmail.set(member, inbox);
    }

    return mail;
  }

  getInbox(email: string): MockDlMail[] {
    const normalizedEmail = email.trim().toLowerCase();
    return [...(this.inboxByEmail.get(normalizedEmail) ?? [])];
  }

  resetDlState(): void {
    this.dlMembersByEmail.clear();
    this.inboxByEmail.clear();
  }
}

export const mockDeskMailService = new MockDeskMailService();
