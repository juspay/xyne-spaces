import type {
  APIRequestContext,
  APIResponse,
  Browser,
  BrowserContext,
  Page,
  Response,
} from '@playwright/test';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  browserType: string;
  viewportWidth: number;
  viewportHeight: number;
}

export interface StoredEntity {
  id?: string;
  name: string;
  url?: string;
}

export interface StoredMessage {
  alias: string;
  baseText: string;
  text: string;
}

export interface StoredConversation extends StoredEntity {
  messages: Record<string, StoredMessage>;
}

export interface StoredProject extends StoredEntity {
  code?: string;
  description?: string;
}

export interface StoredTicket {
  alias: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
  assigneeId?: string;
  id?: string;
}

export interface StoredUser {
  alias: string;
  role: 'admin' | 'user';
  id: string;
  email: string;
  name: string;
  workspaceId?: string;
  profilePictureUrl?: string;
  projects: Record<string, StoredProject>;
  channels: Record<string, StoredConversation>;
  dms: Record<string, StoredConversation>;
  tickets: Record<string, StoredTicket>;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class TestContextStore {
  public readonly sessions = new Map<string, BrowserSession>();
  public activeSessionName: string | null = null;
  public readonly storedUsers = new Map<string, StoredUser>();
  private readonly persistentStoredUsers = new Map<string, StoredUser>();
  public lastResponse: APIResponse | Response | null = null;
  public apiRequestContext: APIRequestContext | null = null;

  public get activeSession(): BrowserSession | null {
    if (!this.activeSessionName) return null;
    return this.sessions.get(this.activeSessionName) ?? null;
  }

  public get currentSession(): BrowserSession {
    if (!this.activeSessionName) {
      throw new Error('No active browser session name set. Open a browser session first.');
    }

    const session = this.sessions.get(this.activeSessionName);
    if (!session) {
      throw new Error(
        `Active session "${this.activeSessionName}" not found in sessions map. It may have been released.`
      );
    }

    return session;
  }

  public get activePage(): Page {
    return this.currentSession.page;
  }

  public resetScenarioState(): void {
    this.sessions.clear();
    this.activeSessionName = null;
    this.storedUsers.clear();

    for (const [alias, user] of this.persistentStoredUsers.entries()) {
      this.storedUsers.set(alias, cloneValue(user));
    }

    this.lastResponse = null;
  }

  public registerPersistentStoredUser(user: StoredUser): void {
    this.persistentStoredUsers.set(user.alias, cloneValue(user));
    this.storedUsers.set(user.alias, cloneValue(user));
  }

  public reset(): void {
    this.persistentStoredUsers.clear();
    this.resetScenarioState();
    this.apiRequestContext = null;
  }
}

export const testContext = new TestContextStore();
