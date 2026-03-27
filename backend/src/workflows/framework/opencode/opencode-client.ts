import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2'
import type { Session, Event, AssistantMessage, Part } from '@opencode-ai/sdk/v2'
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

    const combinedSignal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal

    const startTime = Date.now()
    return fetch(input, {
      ...init,
      signal: combinedSignal
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
  private sseReconnectAttempts = 0
  private static readonly MAX_SSE_RECONNECT_ATTEMPTS = 10

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
      title: options.title,
      directory: options.directory
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
      sessionID: sessionId
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
      sessionID: sessionId
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
      sessionID: sessionId,
      parts: [{ type: 'text', text: message }],
      system: systemPrompt,
      ...(modelOverride && { model: modelOverride })
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
    onEvent?: (event: OpenCodeEvent) => void,
    forceResolveRef?: { resolve?: () => void }
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

        try {
          const messagesResult = await this.client.session.messages({
            sessionID: sessionId,
            directory: this.directory
          })

          if (messagesResult.data && Array.isArray(messagesResult.data)) {
            const assistantMsgs = messagesResult.data.filter(m => m.info?.role === 'assistant')

            if (assistantMsgs.length > 0) {
              const allParts: Part[] = []
              for (const msg of assistantMsgs) {
                if (msg.parts) {
                  allParts.push(...(msg.parts as Part[]))
                }
              }

              const lastMsg = assistantMsgs[assistantMsgs.length - 1]

              const partTypes: Record<string, number> = {}
              for (const p of allParts) {
                partTypes[p.type] = (partTypes[p.type] || 0) + 1
              }
              logger.info(`[OpenCodeClient] Resolved via session.messages() — ${assistantMsgs.length} assistant msgs, ${allParts.length} total parts, types: ${JSON.stringify(partTypes)}`)
              resolve({
                info: lastMsg.info as AssistantMessage,
                parts: allParts
              })
              return
            }
          }

          // Fallback: use POST result if session.messages() returned nothing
          if (promptFetchResult) {
            logger.warn(`[OpenCodeClient] session.messages() returned no assistant message, using POST result`)
            resolve(promptFetchResult)
            return
          }

          logger.warn(`[OpenCodeClient] No assistant message found in session.messages() response`)
          resolve({
            info: { role: 'assistant', parts: [] } as unknown as AssistantMessage,
            parts: []
          })
        } catch (fetchError) {
          // Fallback: use POST result if session.messages() fails
          if (promptFetchResult) {
            logger.warn(`[OpenCodeClient] session.messages() failed, using POST result: ${fetchError}`)
            resolve(promptFetchResult)
            return
          }
          reject(new OpenCodeAPIError(`Failed to fetch session messages after completion: ${fetchError}`, 500))
        }
      }

      if (forceResolveRef) {
        forceResolveRef.resolve = () => {
          void completeWithSuccess()
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
        sessionID: sessionId,
        parts: [{ type: 'text', text: message }],
        system: systemPrompt,
        ...(modelOverride && { model: modelOverride })
      }).then(result => {
        if (result.error) {
          logger.warn(`[OpenCodeClient] POST returned error: ${JSON.stringify(result.error)} — waiting for SSE session.idle`)
          return
        }
        const data = result.data as SDKPromptResponse
        if (data?.info) {
          promptFetchResult = data
          logger.debug(`[OpenCodeClient] POST returned ${data?.parts?.length ?? 0} parts — waiting for SSE session.idle for full data`)
        } else {
          promptFetchResult = undefined
          logger.debug(`[OpenCodeClient] POST returned empty data — waiting for SSE session.idle`)
        }
      }).catch(error => {
        const errorMsg = error instanceof Error ? error.message : String(error)
        logger.warn(`[OpenCodeClient] POST fetch error: ${errorMsg} — waiting for SSE session.idle`)
      })
    })
  }

  async getTodos(sessionId: string): Promise<TodoItem[]> {
    const result = await this.client.session.todo({
      sessionID: sessionId
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

  async rejectQuestion(requestId: string): Promise<void> {
    const result = await this.client.question.reject({
      requestID: requestId,
      directory: this.directory
    })

    if (result.error) {
      throw new OpenCodeAPIError(`Failed to reject question: ${JSON.stringify(result.error)}`, 400)
    }
  }

  async answerQuestion(requestId: string, answers: string[][]): Promise<void> {
    const result = await this.client.question.reply({
      requestID: requestId,
      answers,
      directory: this.directory
    })

    if (result.error) {
      throw new OpenCodeAPIError(`Failed to answer question: ${JSON.stringify(result.error)}`, 400)
    }
  }

  async injectContextMessage(
    sessionId: string,
    text: string,
    systemPrompt?: string,
    modelOverride?: { providerID: string; modelID: string }
  ): Promise<void> {
    const result = await this.client.session.prompt({
      sessionID: sessionId,
      parts: [{ type: 'text', text }],
      noReply: true,
      system: systemPrompt,
      ...(modelOverride && { model: modelOverride })
    })

    if (result.error) {
      logger.warn(`[OpenCodeClient] injectContextMessage error: ${JSON.stringify(result.error)}`)
      throw new OpenCodeAPIError(`Failed to inject context message: ${JSON.stringify(result.error)}`, 400)
    }
  }

  async grantPermission(_sessionId: string, permissionId: string): Promise<void> {
    const result = await this.client.permission.reply({
      requestID: permissionId,
      reply: 'always',
      directory: this.directory
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
      const eventResult = await this.client.event.subscribe({
        directory: this.directory
      })
      const stream = eventResult?.stream
      
      if (stream) {
        void (async () => {
          try {
            this.sseReconnectAttempts = 0
            for await (const sdkEvent of stream) {
              if (!this.eventStreamActive) break
              const event = this.mapEventToOpenCodeEvent(sdkEvent as Event)
              this.dispatchEvent(event)
            }
          } catch (error) {
            if (this.eventStreamActive) {
              this.eventStreamActive = false
              this.sseReconnectAttempts++

              if (this.sseReconnectAttempts > OpenCodeClient.MAX_SSE_RECONNECT_ATTEMPTS) {
                logger.error(`[OpenCodeClient] SSE stream error — max reconnect attempts (${OpenCodeClient.MAX_SSE_RECONNECT_ATTEMPTS}) reached, giving up:`, error)
                return
              }

              const backoffMs = Math.min(1000 * Math.pow(2, this.sseReconnectAttempts - 1), 60000)
              logger.warn(`[OpenCodeClient] SSE stream error (attempt ${this.sseReconnectAttempts}/${OpenCodeClient.MAX_SSE_RECONNECT_ATTEMPTS}), reconnecting in ${backoffMs}ms:`, error)

              setTimeout(() => {
                if (this.eventListeners.size > 0) {
                  this.ensureEventStreamStarted()
                }
              }, backoffMs)
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
