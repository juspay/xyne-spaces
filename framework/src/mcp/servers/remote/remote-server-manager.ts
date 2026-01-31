/**
 * Remote server manager for HTTP and WebSocket connections
 */

import { BaseMCPServerManager } from '../base/server-manager.js';
import type {
  MCPConnectionOptions,
  MCPTransportInfo
} from '../types/index.js';
import type { MCPRemoteServerConfig } from '../../core/types/config.js';
import { createMCPConnectionError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * HTTP transport implementation
 */
class HTTPTransport {
  private readonly config: MCPRemoteServerConfig;
  private readonly timeout: number;

  constructor(config: MCPRemoteServerConfig, timeout: number) {
    this.config = config;
    this.timeout = timeout;
  }

  async connect(): Promise<void> {
    // For HTTP, connection is established on first request
    logger.debug(`HTTP transport ready for ${this.config.transport.url}`);
    await Promise.resolve(); // Satisfy @typescript-eslint/require-await
  }

  async disconnect(): Promise<void> {
    // No persistent connection to close for HTTP
    logger.debug(`HTTP transport disconnected from ${this.config.transport.url}`);
    await Promise.resolve(); // Satisfy @typescript-eslint/require-await
  }

  async sendMessage(message: unknown): Promise<unknown> {
    const url = this.config.transport.url;
    const headers = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'content-type': 'application/json',
      ...this.config.transport.headers,
      ...this.getAuthHeaders()
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  async ping(): Promise<void> {
    await this.sendMessage({ type: 'ping', timestamp: Date.now() });
  }

  private getAuthHeaders(): Record<string, string> {
    const auth = this.config.auth;
    if (!auth) {
      return {};
    }

    switch (auth.type) {
      case 'bearer':
        return { 'authorization': `Bearer ${auth.token}` };
      
      case 'basic': {
        const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        return { 'authorization': `Basic ${credentials}` };
      }
      
      case 'api-key': {
        const header = auth.header || 'X-API-Key';
        return { [header]: auth.apiKey! };
      }
      
      default:
        return {};
    }
  }
}

/**
 * WebSocket transport implementation
 */
class WebSocketTransport {
  private readonly config: MCPRemoteServerConfig;
  private readonly timeout: number;
  private websocket: WebSocket | undefined;
  private messageHandlers = new Map<string, (data: unknown) => void>();
  private nextMessageId = 1;

  constructor(config: MCPRemoteServerConfig, timeout: number) {
    this.config = config;
    this.timeout = timeout;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const url = this.buildWebSocketUrl();
        this.websocket = new WebSocket(url);

        const timeout = setTimeout(() => {
          this.websocket?.close();
          reject(new Error(`WebSocket connection timeout after ${this.timeout}ms`));
        }, this.timeout);

        this.websocket.onopen = (): void => {
          clearTimeout(timeout);
          logger.debug(`WebSocket connected to ${this.config.transport.url}`);
          resolve();
        };

        this.websocket.onerror = (event: Event): void => {
          clearTimeout(timeout);
          reject(new Error(`WebSocket connection error: ${String(event.type)}`));
        };

        this.websocket.onmessage = (event: MessageEvent): void => {
          this.handleMessage(event.data as string);
        };

        this.websocket.onclose = (): void => {
          logger.debug(`WebSocket disconnected from ${this.config.transport.url}`);
        };

      } catch (error) {
        reject(error as Error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = undefined;
    }
    await Promise.resolve(); // Satisfy @typescript-eslint/require-await
  }

  async sendMessage(message: unknown): Promise<unknown> {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    return new Promise((resolve, reject) => {
      const messageId = (this.nextMessageId++).toString();
      const messageWithId = { 
        ...(typeof message === 'object' && message !== null ? message as Record<string, unknown> : {}), 
        id: messageId 
      };

      const timeout = setTimeout(() => {
        this.messageHandlers.delete(messageId);
        reject(new Error(`Message timeout after ${this.timeout}ms`));
      }, this.timeout);

      this.messageHandlers.set(messageId, (response) => {
        clearTimeout(timeout);
        this.messageHandlers.delete(messageId);
        resolve(response);
      });

      this.websocket!.send(JSON.stringify(messageWithId));
    });
  }

  async ping(): Promise<void> {
    await this.sendMessage({ type: 'ping', timestamp: Date.now() });
  }

  private buildWebSocketUrl(): string {
    let url = this.config.transport.url;
    
    // Add authentication to URL if using basic auth
    if (this.config.auth?.type === 'basic') {
      const urlObj = new URL(url);
      urlObj.username = this.config.auth.username!;
      urlObj.password = this.config.auth.password!;
      url = urlObj.toString();
    }

    return url;
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as { id?: string };
      
      if (message.id && this.messageHandlers.has(message.id)) {
        const handler = this.messageHandlers.get(message.id)!;
        handler(message);
      }
    } catch (error) {
      logger.warn('Failed to parse WebSocket message', { error: error as Error });
    }
  }
}

/**
 * Remote server manager for MCP servers accessible over HTTP or WebSocket
 */
export class RemoteMCPServerManager extends BaseMCPServerManager {
  private readonly remoteConfig: MCPRemoteServerConfig;
  private transport: HTTPTransport | WebSocketTransport | undefined;
  private serverVersion: string | undefined;
  private serverCapabilities: string[] | undefined;

  constructor(
    serverId: string,
    serverName: string,
    config: MCPRemoteServerConfig,
    options?: MCPConnectionOptions
  ) {
    super(serverId, serverName, config, options);
    this.remoteConfig = config;
  }

  /**
   * Get transport information
   */
  public getTransportInfo(): MCPTransportInfo {
    return {
      type: this.remoteConfig.transport.type,
      url: this.remoteConfig.transport.url,
      headers: this.remoteConfig.transport.headers,
      connected: this.isConnected()
    };
  }

  /**
   * Connect to the remote server
   */
  protected async doConnect(): Promise<void> {
    if (this.transport) {
      throw createMCPConnectionError(
        this.serverName,
        `Server ${this.serverName} already has an active transport`
      );
    }

    try {
      this.transport = this.createTransport();
      await this.transport.connect();
      
      // Perform initial handshake
      await this.performHandshake();
      
      logger.debug(`Successfully connected to remote server ${this.serverName}`);
    } catch (error) {
      this.transport = undefined;
      throw createMCPConnectionError(
        this.serverName,
        `Failed to connect to remote server ${this.serverName}`,
        {
          originalError: error as Error
        }
      );
    }
  }

  /**
   * Disconnect from the remote server
   */
  protected async doDisconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.disconnect();
      } catch (error) {
        logger.error(`Error disconnecting transport for ${this.serverName}`, error as Error);
      }
      this.transport = undefined;
    }
  }

  /**
   * Send message to the remote server
   */
  protected async doSendMessage(message: unknown): Promise<unknown> {
    if (!this.transport) {
      throw createMCPConnectionError(
        this.serverName,
        `No active transport for server ${this.serverName}`
      );
    }

    try {
      return await this.transport.sendMessage(message);
    } catch (error) {
      throw createMCPConnectionError(
        this.serverName,
        `Failed to send message to server ${this.serverName}`,
        {
          originalError: error as Error
        }
      );
    }
  }

  /**
   * Perform heartbeat check
   */
  protected async performHeartbeat(): Promise<void> {
    if (!this.transport) {
      throw new Error(`No active transport for server ${this.serverName}`);
    }

    try {
      await this.transport.ping();
      this.lastHeartbeat = new Date();
      this.emitEvent('heartbeat');
    } catch (error) {
      throw new Error(`Heartbeat failed for server ${this.serverName}: ${String(error)}`);
    }
  }

  /**
   * Get server version
   */
  protected getServerVersion(): string | undefined {
    return this.serverVersion;
  }

  /**
   * Get server capabilities
   */
  protected getServerCapabilities(): string[] | undefined {
    return this.serverCapabilities;
  }

  /**
   * Create appropriate transport based on configuration
   */
  private createTransport(): HTTPTransport | WebSocketTransport {
    const transportType = this.remoteConfig.transport.type;
    const timeout = this.remoteConfig.transport.timeout ?? this.options.timeout!;

    switch (transportType) {
      case 'http':
        return new HTTPTransport(this.remoteConfig, timeout);
      
      case 'websocket':
        return new WebSocketTransport(this.remoteConfig, timeout);
      
      default:
        throw new Error(`Unsupported transport type: ${transportType as string}`);
    }
  }

  /**
   * Perform initial handshake with server
   */
  private async performHandshake(): Promise<void> {
    try {
      const handshakeMessage = {
        type: 'handshake',
        version: '1.0.0',
        capabilities: ['resources', 'tools', 'prompts']
      };

      const response = await this.transport!.sendMessage(handshakeMessage) as {
        version?: string;
        capabilities?: string[];
      };
      
      if (response?.version) {
        this.serverVersion = response.version;
      }
      
      if (Array.isArray(response?.capabilities)) {
        this.serverCapabilities = response.capabilities;
      }

      logger.debug(`Handshake completed with server ${this.serverName}`, {
        version: this.serverVersion,
        capabilities: this.serverCapabilities
      });
    } catch (error) {
      logger.error(`Handshake failed for server ${this.serverName}`, error as Error);
      // Don't fail connection for handshake errors
    }
  }
}