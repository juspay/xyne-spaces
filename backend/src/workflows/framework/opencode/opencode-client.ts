import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk'
import type { Session, Event, AssistantMessage, Part } from '@opencode-ai/sdk'
import { logger } from '@/utils/logger'
import {
  OpenCodeConfig,
  DEFAULT_OPENCODE_CONFIG,
  CreateSessionOptions,
  SessionInfo,
  OpenCodeEvent,
  SessionStatus,
  SDKPromptResponse
} from './types'

export type { Session, Event }

function createLongTimeoutFetch(timeoutMs: number = 600000): typeof fetch {
  return (input, init?) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    logger.debug(`[OpenCodeFetch] Starting request to ${url} with timeout ${timeoutMs}ms, init.signal present: ${!!init?.signal}`)
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    
    const startTime = Date.now()
    return fetch(input, {
      ...init,
      signal: timeoutSignal
    }).finally(() => {
      const duration = Date.now() - startTime
      logger.debug(`[OpenCodeFetch] Request to ${url} completed in ${duration}ms`)
    })
  }
}

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}

export class OpenCodeClient {
  private config: OpenCodeConfig
  private client: OpencodeClient
  private directory?: string
  private eventListeners: Map<string, Set<(event: OpenCodeEvent) => void | Promise<void>>> = new Map()
  private eventStreamActive = false

  constructor(config: Partial<OpenCodeConfig> = {}) {
    this.config = { ...DEFAULT_OPENCODE_CONFIG, ...config }
    this.directory = config.directory
    
    this.client = createOpencodeClient({
      baseUrl: this.config.baseUrl,
      directory: this.directory,
      fetch: createLongTimeoutFetch(this.config.fetchTimeoutMs || 600000)
    })
    
    if (this.directory) {
      logger.info(`[OpenCodeClient] Created client scoped to directory: ${this.directory}`)
    }
  }

  static forDirectory(baseUrl: string, directory: string): OpenCodeClient {
    return new OpenCodeClient({ baseUrl, directory })
  }

  async createSession(options: CreateSessionOptions): Promise<SessionInfo> {
    const result = await this.client.session.create({
      body: {
        title: options.title
      },
      query: {
        directory: options.directory
      }
    })

    if (result.error) {
      throw new OpenCodeAPIError(`Failed to create session: ${JSON.stringify(result.error)}`, 400)
    }

    if (!result.data) {
      throw new OpenCodeAPIError('Session creation succeeded but no session data returned', 500)
    }

    const session = result.data
    logger.info(`[OpenCodeClient] Session created: ${session.id}`)
    return this.mapSessionToInfo(session)
  }

  async getSession(sessionId: string): Promise<Session> {
    const result = await this.client.session.get({
      path: { id: sessionId }
    })

    if (result.error) {
      throw new OpenCodeAPIError(`Failed to get session: ${JSON.stringify(result.error)}`, 404)
    }

    if (!result.data) {
      throw new OpenCodeAPIError('Session retrieval succeeded but no session data returned', 500)
    }

    return result.data
  }

  async deleteSession(sessionId: string): Promise<void> {
    const result = await this.client.session.delete({
      path: { id: sessionId }
    })

    if (result.error) {
      throw new OpenCodeAPIError(`Failed to delete session: ${JSON.stringify(result.error)}`, 400)
    }
  }

  async prompt(
    sessionId: string, 
    message: string, 
    systemPrompt?: string,
    modelOverride?: { providerID: string; modelID: string }
  ): Promise<SDKPromptResponse> {
    const result = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text: message }],
        system: systemPrompt,
        ...(modelOverride && { model: modelOverride })
      }
    })

    if (result.error) {
      logger.error(`[OpenCodeClient] Prompt error: ${JSON.stringify(result.error)}`)
      throw new OpenCodeAPIError(`Failed to send prompt: ${JSON.stringify(result.error)}`, 400)
    }
    
    return result.data as SDKPromptResponse
  }

  async promptWithStreaming(
    sessionId: string,
    message: string,
    systemPrompt?: string,
    modelOverride?: { providerID: string; modelID: string },
    timeoutMs: number = 600000,
    onEvent?: (event: OpenCodeEvent) => void
  ): Promise<SDKPromptResponse> {
    return new Promise<SDKPromptResponse>((resolve, reject) => {
      let unsubscribe: (() => void) | undefined
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      let resolved = false
      let sessionError: string | undefined
      let promptFetchResult: SDKPromptResponse | undefined

      const cleanup = () => {
        if (unsubscribe) {
          unsubscribe()
          unsubscribe = undefined
        }
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
      }

      const completeWithError = (error: Error) => {
        if (resolved) return
        resolved = true
        cleanup()
        reject(error)
      }

      const completeWithSuccess = async () => {
        if (resolved) return
        resolved = true
        cleanup()

        if (sessionError) {
          reject(new OpenCodeAPIError(sessionError, 500))
          return
        }

        if (promptFetchResult) {
          resolve(promptFetchResult)
          return
        }

        try {
          const sessionData = await this.getSession(sessionId)
          if (sessionData) {
            const messages = (sessionData as unknown as { messages?: Array<{ role: string; parts?: unknown[] }> }).messages || []
            const lastAssistantMsg = messages.filter(m => m.role === 'assistant').pop()
            if (lastAssistantMsg) {
              resolve({
                info: lastAssistantMsg as unknown as AssistantMessage,
                parts: (lastAssistantMsg.parts || []) as Part[]
              })
              return
            }
          }
          resolve({
            info: { role: 'assistant', parts: [] } as unknown as AssistantMessage,
            parts: []
          })
        } catch (fetchError) {
          reject(new OpenCodeAPIError(`Failed to fetch session after completion: ${fetchError}`, 500))
        }
      }

      timeoutId = setTimeout(() => {
        completeWithError(new Error(`Streaming prompt timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      unsubscribe = this.subscribeToSessionEvents(sessionId, (event) => {
        if (resolved) return

        if (onEvent) {
          try {
            onEvent(event)
          } catch {
          }
        }

        switch (event.type) {
          case 'session.idle':
            void completeWithSuccess()
            break

          case 'session.error': {
            const errorEvent = event as { properties: { error?: { data?: { message?: string } } } }
            sessionError = errorEvent.properties?.error?.data?.message || 'Session error'
            break
          }
        }
      })

      // Send the prompt
      this.client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: message }],
          system: systemPrompt,
          ...(modelOverride && { model: modelOverride })
        }
      }).then(result => {
        if (result.error) {
          completeWithError(new OpenCodeAPIError(`Failed to send prompt: ${JSON.stringify(result.error)}`, 400))
          return
        }
        promptFetchResult = result.data as SDKPromptResponse
        if (!resolved && promptFetchResult) {
          resolved = true
          cleanup()
          resolve(promptFetchResult)
        }
      }).catch(error => {
        if (!resolved) {
          const isTimeout = error instanceof Error && 
            (error.message.includes('fetch failed') || 
             error.message.includes('HeadersTimeoutError') ||
             (error as Error & { cause?: Error }).cause?.message?.includes('Headers Timeout'))
          
          if (!isTimeout) {
            completeWithError(error instanceof Error ? error : new Error(String(error)))
          } else {
            logger.info(`[OpenCodeClient] Prompt fetch timed out, waiting for SSE completion...`)
          }
        }
      })
    })
  }

  async getTodos(sessionId: string): Promise<TodoItem[]> {
    const result = await this.client.session.todo({
      path: { id: sessionId }
    })

    if (result.error) {
      logger.warn(`[OpenCodeClient] Failed to get todos for session ${sessionId}:`, result.error)
      return []
    }

    return (result.data || []) as TodoItem[]
  }

  async hasIncompleteTodos(sessionId: string): Promise<{ hasIncomplete: boolean; todos: TodoItem[] }> {
    const todos = await this.getTodos(sessionId)
    const incompleteTodos = todos.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
    return {
      hasIncomplete: incompleteTodos.length > 0,
      todos: incompleteTodos
    }
  }

  async grantPermission(sessionId: string, permissionId: string): Promise<void> {
    const result = await this.client.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      body: { response: 'always' }
    })

    if (result.error) {
      throw new OpenCodeAPIError(`Failed to grant permission: ${JSON.stringify(result.error)}`, 400)
    }
  }

  subscribeToEvents(callback: (event: OpenCodeEvent) => void | Promise<void>): () => void {
    const globalKey = 'global'
    if (!this.eventListeners.has(globalKey)) {
      this.eventListeners.set(globalKey, new Set())
    }
    this.eventListeners.get(globalKey)!.add(callback)

    this.ensureEventStreamStarted()

    return () => {
      this.eventListeners.get(globalKey)?.delete(callback)
      if (this.eventListeners.get(globalKey)?.size === 0) {
        this.stopEventStream()
      }
    }
  }

  subscribeToSessionEvents(
    sessionId: string,
    callback: (event: OpenCodeEvent) => void | Promise<void>
  ): () => void {
    return this.subscribeToEvents(async (event) => {
      const properties = event.properties as Record<string, unknown>
      
      let eventSessionID = properties?.sessionID || properties?.sessionId
      
      if (!eventSessionID && properties?.info) {
        const info = properties.info as Record<string, unknown>
        eventSessionID = info?.sessionID || info?.id
      }
      
      if (!eventSessionID && properties?.part) {
        const part = properties.part as Record<string, unknown>
        eventSessionID = part?.sessionID
      }
      
      if (eventSessionID === sessionId) {
        await callback(event)
      }
    })
  }

  private mapEventToOpenCodeEvent(sdkEvent: Event): OpenCodeEvent {
    const timestamp = new Date().toISOString()
    return {
      ...sdkEvent,
      timestamp
    } as OpenCodeEvent
  }

  private async ensureEventStreamStarted(): Promise<void> {
    if (this.eventStreamActive) return

    this.eventStreamActive = true

    try {
      const eventResult = await this.client.event.subscribe()
      const stream = eventResult?.stream
      
      if (stream) {
        void (async () => {
          try {
            for await (const sdkEvent of stream) {
              if (!this.eventStreamActive) break
              const event = this.mapEventToOpenCodeEvent(sdkEvent as Event)
              this.dispatchEvent(event)
            }
          } catch (error) {
            if (this.eventStreamActive) {
              logger.error('[OpenCodeClient] SSE stream error:', error)
              this.eventStreamActive = false
              setTimeout(() => {
                if (this.eventListeners.size > 0) {
                  this.ensureEventStreamStarted()
                }
              }, 5000)
            }
          }
        })()
      } else {
        logger.warn('[OpenCodeClient] No stream returned from event.subscribe()')
      }
    } catch (error) {
      logger.error('[OpenCodeClient] Failed to start SSE stream:', error)
      this.eventStreamActive = false
    }
  }

  private dispatchEvent(event: OpenCodeEvent): void {
    this.eventListeners.get('global')?.forEach((callback) => {
      try {
        const result = callback(event)
        if (result instanceof Promise) {
          result.catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error)
            if (!errorMessage.includes('cancelled') && !errorMessage.includes('paused')) {
              logger.error('[OpenCodeClient] Async event callback error:', error)
            }
          })
        }
      } catch (error) {
        logger.error('[OpenCodeClient] Sync event callback error:', error)
      }
    })
  }

  private stopEventStream(): void {
    this.eventStreamActive = false
  }

  close(): void {
    this.stopEventStream()
    this.eventListeners.clear()
  }

  private mapSessionToInfo(session: Session | Record<string, unknown>): SessionInfo {
    const s = session as Record<string, unknown>
    const time = s.time as Record<string, unknown> | undefined
    return {
      id: (s.id as string) || '',
      title: (s.title as string) || '',
      directory: (s.directory as string) || '',
      status: this.mapStatus(s.status as string),
      createdAt: this.mapTimestamp(s.createdAt || time?.created),
      updatedAt: this.mapTimestamp(s.updatedAt || time?.updated || time?.created)
    }
  }

  private mapTimestamp(value: unknown): string {
    if (typeof value === 'number') {
      return new Date(value).toISOString()
    }
    if (typeof value === 'string') {
      return value
    }
    return new Date().toISOString()
  }

  private mapStatus(status: string | undefined): SessionStatus {
    switch (status) {
      case 'running':
      case 'pending':
      case 'active':
        return 'active'
      case 'completed':
      case 'done':
        return 'completed'
      case 'error':
      case 'failed':
        return 'error'
      case 'compacting':
      case 'summarizing':
        return 'compacting'
      default:
        return 'active'
    }
  }
}

export class OpenCodeAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: string
  ) {
    super(message)
    this.name = 'OpenCodeAPIError'
  }
}
