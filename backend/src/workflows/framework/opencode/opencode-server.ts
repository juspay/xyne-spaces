import { createOpencode, createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk'
import { config as appConfig } from '../../../config/env'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { logger } from '@/utils/logger'

interface OpenCodeServerInstance {
  url: string
  close(): void
}

interface OpenCodeInstance {
  client: OpencodeClient
  server: OpenCodeServerInstance
}

class OpenCodeServerManager {
  private instance: OpenCodeInstance | null = null
  private client: OpencodeClient | null = null
  private starting = false
  private startPromise: Promise<void> | null = null

  get isEnabled(): boolean {
    return appConfig.openCode.enabled
  }

  get isRunning(): boolean {
    return this.instance !== null || this.client !== null
  }

  async getClient(): Promise<OpencodeClient> {
    if (!this.isEnabled) {
      throw new Error('OpenCode is not enabled. Set OPENCODE_ENABLED=true')
    }

    await this.ensureStarted()

    if (this.client) {
      return this.client
    }

    if (this.instance) {
      return this.instance.client
    }

    throw new Error('OpenCode server failed to start')
  }

  getServerUrl(): string {
    if (this.instance) {
      return this.instance.server.url
    }
    return appConfig.openCode.baseUrl
  }

  async start(): Promise<void> {
    if (!this.isEnabled) {
      logger.info('[OpenCode] Server disabled')
      return
    }

    if (this.isRunning) {
      logger.info('[OpenCode] Server already running')
      return
    }

    if (this.starting) {
      if (this.startPromise) {
        await this.startPromise
      }
      return
    }

    this.starting = true
    this.startPromise = this.doStart()

    try {
      await this.startPromise
    } finally {
      this.starting = false
      this.startPromise = null
    }
  }

  private async doStart(): Promise<void> {
    const spawnServer = appConfig.openCode.spawnServer
    const baseUrl = appConfig.openCode.baseUrl

    if (spawnServer) {
      await this.spawnServer()
    } else {
      await this.connectToExisting(baseUrl)
    }
  }

  private async spawnServer(): Promise<void> {
    logger.info('[OpenCode] Spawning embedded server...')

    await this.ensureModelsCachePopulated()

    try {
      const url = new URL(appConfig.openCode.baseUrl)
      const port = parseInt(url.port) || 4096
      const hostname = url.hostname || '127.0.0.1'

      const config: Record<string, unknown> = {}
      config.permission = {
        edit: 'allow',
        bash: 'allow',
        webfetch: 'allow',
        doom_loop: 'allow',
        external_directory: 'deny',
        lsp: 'allow',
        lsp_diagnostics: 'allow',
        lsp_goto_definition: 'allow',
        lsp_find_references: 'allow',
        lsp_symbols: 'allow',
        lsp_prepare_rename: 'allow',
        lsp_rename: 'allow'
      }
      if (appConfig.openCode.pluginEnabled) {
        const pluginVersion = appConfig.openCode.pluginVersion || 'latest'
        config.plugin = [`oh-my-opencode@${pluginVersion}`]
        
        logger.info(`[OpenCode] Enabling oh-my-opencode plugin (version: ${pluginVersion})`)
        config['oh-my-opencode'] = {
          default_agent: 'sisyphus',
          permission: {
            external_directory: 'deny'
          },
          sisyphus_agent: {
            disabled: false,
            default_builder_enabled: true,
            planner_enabled: true,
            force_lsp_verification: true,
            edit_retry_on_failure: true,
            edit_max_retries: 3,
            verify_todos_before_completion: true,
          },
          disabled_hooks: [
            'auto-update-checker',
            'startup-toast',
            'session-notification',
          ],
          agents: {
            sisyphus: {
              model: `litellm/${appConfig.openCode.model || 'glm-latest'}`,
              temperature: 0.1,
              permission: {
                external_directory: 'deny'
              }
            },
            explore: {
              model: `litellm/${appConfig.openCode.model || 'glm-latest'}`,
              temperature: 0.1,
              permission: {
                external_directory: 'deny'
              }
            },
            librarian: {
              model: `litellm/${appConfig.openCode.model || 'glm-latest'}`,
              temperature: 0.1,
              permission: {
                external_directory: 'deny'
              }
            },
            oracle: {
              permission: {
                external_directory: 'deny'
              }
            },
            'multimodal-looker': {
              permission: {
                external_directory: 'deny'
              }
            },
            metis: {
              permission: {
                external_directory: 'deny'
              }
            },
            momus: {
              permission: {
                external_directory: 'deny'
              }
            },
            atlas: {
              permission: {
                external_directory: 'deny'
              }
            },
            prometheus: {
              permission: {
                external_directory: 'deny'
              }
            },
            'sisyphus-junior': {
              permission: {
                external_directory: 'deny'
              }
            }
          },
          background_task: {
            defaultConcurrency: 5,
            providerConcurrency: {
              litellm: 8
            },
            sessionStartDelay: 200,
            timeout: 0,
            defaultBlockTimeout: 600000
          },
          experimental: {
            preemptive_compaction: true,
            preemptive_compaction_threshold: 0.85
          },
          tools: {
            lsp_diagnostics: true,
            lsp_goto_definition: true,
            lsp_find_references: true,
            lsp_symbols: true,
            lsp_prepare_rename: true,
            lsp_rename: true
          }
        }
        config.lsp = {
          'typescript-language-server': {
            command: ['typescript-language-server', '--stdio'],
            extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
            priority: 10,
            disabled: false
          }
        }
        config.hooks = {
          PostToolUse: [
            {
              matcher: 'Write|Edit|MultiEdit',
              hooks: [
                {
                  type: 'command',
                  command: 'if [[ "$FILE" == *"/dashboard/"* ]]; then npx prettier --write "$FILE" 2>/dev/null || true; fi'
                }
              ]
            }
          ]
        }
      }
      if (appConfig.litellm.baseUrl) {
        const baseURL = appConfig.litellm.baseUrl.replace(/\/$/, '')
        const modelId = appConfig.openCode.model || 'glm-latest'
        config.model = `litellm/${modelId}`

        config.provider = {
          litellm: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LiteLLM',
            timeout: 900000,
            options: {
              baseURL,
              apiKey: appConfig.litellm.apiKey || '',
            },
            models: {
              [modelId]: {
                name: modelId,
                limit: {
                  context: 200000,
                  output: 8192
                },
                tool_call: true
              }
            }
          }
        }
      } else if (process.env.ANTHROPIC_API_KEY) {
        config.provider = { anthropic: {} }
        config.model = appConfig.openCode.model || 'claude-sonnet-4-20250514'
      } else if (process.env.OPENAI_API_KEY) {
        config.provider = { openai: {} }
        config.model = appConfig.openCode.model || 'gpt-4o'
      }

      logger.info(`[OpenCode] Starting server with model: ${config.model}`)
      this.instance = await createOpencode({
        hostname,
        port,
        timeout: appConfig.openCode.timeoutMs,
        config: config as any
      })

      logger.info(`[OpenCode] Server started at ${this.instance.server.url}`)
      const healthResult = await this.instance.client.config.get()
      if (healthResult.error) {
        throw new Error(`Health check failed: ${JSON.stringify(healthResult.error)}`)
      }
    } catch (error) {
      logger.error('[OpenCode] Failed to spawn server:', error)
      this.instance = null
      throw error
    }
  }

  private async connectToExisting(baseUrl: string): Promise<void> {
    logger.info(`[OpenCode] Connecting to existing server at ${baseUrl}`)

    try {
      this.client = createOpencodeClient({
        baseUrl
      })

      const healthResult = await this.client.config.get()
      if (healthResult.error) {
        throw new Error(`Health check failed: ${JSON.stringify(healthResult.error)}`)
      }

      logger.info('[OpenCode] Connected to existing server')
    } catch (error) {
      logger.error('[OpenCode] Failed to connect to server:', error)
      this.client = null
      throw error
    }
  }

  private async ensureModelsCachePopulated(): Promise<void> {
    if (!appConfig.litellm.baseUrl) {
      logger.info('[OpenCode] No LiteLLM provider configured, skipping cache population')
      return
    }

    const modelId = appConfig.openCode.model || 'glm-latest'
    const cacheDir = path.join(os.homedir(), '.cache', 'oh-my-opencode')

    try {
      await fs.promises.mkdir(cacheDir, { recursive: true })

      const connectedProvidersPath = path.join(cacheDir, 'connected-providers.json')
      const connectedProviders = {
        providers: ['litellm'],
        updatedAt: new Date().toISOString()
      }
      await fs.promises.writeFile(
        connectedProvidersPath,
        JSON.stringify(connectedProviders, null, 2)
      )
      logger.info(`[OpenCode] ✅ Created ${connectedProvidersPath}`)

      const providerModelsPath = path.join(cacheDir, 'provider-models.json')
      const providerModels = {
        models: {
          litellm: [modelId]
        },
        connected: ['litellm'],
        updatedAt: new Date().toISOString()
      }
      await fs.promises.writeFile(
        providerModelsPath,
        JSON.stringify(providerModels, null, 2)
      )
    } catch (error) {
      logger.warn('[OpenCode] Failed to populate model cache:', error)
    }
  }

  async stop(): Promise<void> {
    if (this.instance) {
      logger.info('[OpenCode] Stopping embedded server...')
      try {
        this.instance.server.close()
      } catch (error) {
        logger.error('[OpenCode] Error stopping server:', error)
      }
      this.instance = null
    }

    this.client = null
  }

  private async ensureStarted(): Promise<void> {
    if (!this.isRunning) {
      await this.start()
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClient()
      const result = await client.config.get()
      return !result.error
    } catch {
      return false
    }
  }
}

export const openCodeServer = new OpenCodeServerManager()

export async function initializeOpenCode(): Promise<void> {
  if (!openCodeServer.isEnabled) {
    return
  }

  try {
    await openCodeServer.start()
  } catch (error) {
    logger.error('[OpenCode] Failed to initialize:', error)
  }
}

export async function shutdownOpenCode(): Promise<void> {
  await openCodeServer.stop()
}
