/**
 * Local server manager for spawning and managing child processes
 */

import { spawn, type ChildProcess } from 'child_process';
import { BaseMCPServerManager } from '../base/server-manager.js';
import type {
  MCPConnectionOptions,
  MCPProcessInfo
} from '../types/index.js';
import type { MCPLocalServerConfig } from '../../core/types/config.js';
import { createMCPConnectionError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Local server manager for MCP servers running as child processes
 */
export class LocalMCPServerManager extends BaseMCPServerManager {
  private readonly localConfig: MCPLocalServerConfig;
  private childProcess: ChildProcess | undefined;
  private processStartTime: Date | undefined;
  private serverVersion: string | undefined;
  private serverCapabilities: string[] | undefined;

  constructor(
    serverId: string,
    serverName: string,
    config: MCPLocalServerConfig,
    options?: MCPConnectionOptions
  ) {
    super(serverId, serverName, config, options);
    this.localConfig = config;
  }

  /**
   * Get process information
   */
  public getProcessInfo(): MCPProcessInfo | undefined {
    if (!this.childProcess) {
      return undefined;
    }

    return {
      pid: this.childProcess.pid,
      command: this.localConfig.command,
      args: this.localConfig.args || [],
      cwd: this.localConfig.cwd,
      env: this.localConfig.env,
      startTime: this.processStartTime
    };
  }

  /**
   * Connect to the server by spawning the child process
   */
  protected async doConnect(): Promise<void> {
    if (this.childProcess) {
      throw createMCPConnectionError(
        this.serverName,
        `Server ${this.serverName} already has a running process`,
        {
          originalError: new Error(`Process already running with PID: ${this.childProcess.pid}`)
        }
      );
    }

    return new Promise((resolve, reject) => {
      // Set connection timeout
      const timeout = setTimeout(() => {
        this.killProcess().catch(() => {
          // Ignore kill errors in timeout
        });
        reject(createMCPConnectionError(
          this.serverName,
          `Connection timeout for server ${this.serverName}`,
          {
            originalError: new Error(`Timeout after ${this.options.timeout}ms`)
          }
        ));
      }, this.options.timeout);
      
      // Don't let timeout keep process alive in tests
      timeout.unref();

      try {
        // Spawn process with immediate event handler setup
        this.spawnProcessWithHandlers(resolve, reject, timeout);

      } catch (error) {
        clearTimeout(timeout);
        reject(createMCPConnectionError(
          this.serverName,
          `Failed to spawn process for server ${this.serverName}`,
          {
            originalError: error as Error
          }
        ));
      }
    });
  }

  /**
   * Disconnect from the server by terminating the child process
   */
  protected async doDisconnect(): Promise<void> {
    if (!this.childProcess) {
      return;
    }

    return new Promise((resolve) => {
      if (!this.childProcess) {
        return resolve();
      }

      const process = this.childProcess;
      const pid = process.pid;

      // Set up exit handler
      const onExit = (): void => {
        logger.debug(`Process terminated for server ${this.serverName} (PID: ${pid})`);
        this.childProcess = undefined;
        this.processStartTime = undefined;
        if (forceKillTimeout) {
          clearTimeout(forceKillTimeout);
        }
        resolve();
      };

      process.once('exit', onExit);

      // Try graceful shutdown first
      this.sendTerminationSignal('SIGTERM');

      // Force kill after timeout
      const forceKillTimeout = setTimeout(() => {
        if (this.childProcess === process && process.pid) {
          logger.warn(`Force killing process for server ${this.serverName} (PID: ${pid})`);
          try {
            process.kill('SIGKILL');
          } catch (error) {
            logger.error(`Failed to force kill process ${pid}`, error as Error);
          }
        }
      }, 5000); // 5 second grace period
    });
  }

  /**
   * Send message to the child process
   */
  protected async doSendMessage(message: unknown): Promise<unknown> {
    if (!this.childProcess || !this.childProcess.stdin) {
      throw createMCPConnectionError(
        this.serverName,
        `No active process for server ${this.serverName}`,
        {}
      );
    }

    return new Promise((resolve, reject) => {
      try {
        const messageString = JSON.stringify(message);
        
        // Set up response handler (simplified for now)
        const timeout = setTimeout(() => {
          reject(createMCPConnectionError(
            this.serverName,
            `Message timeout for server ${this.serverName}`,
            {
              originalError: new Error(`Timeout after ${this.options.timeout}ms`)
            }
          ));
        }, this.options.timeout);

        // Send message to process stdin
        this.childProcess!.stdin!.write(messageString + '\n', (error) => {
          clearTimeout(timeout);
          if (error) {
            reject(createMCPConnectionError(
              this.serverName,
              `Failed to send message to server ${this.serverName}`,
              {
                originalError: error
              }
            ));
          } else {
            // For now, just resolve with success
            // In a real implementation, we'd parse the response
            resolve({ success: true });
          }
        });

      } catch (error) {
        reject(createMCPConnectionError(
          this.serverName,
          `Error sending message to server ${this.serverName}`,
          {
            originalError: error as Error
          }
        ));
      }
    });
  }

  /**
   * Perform heartbeat check
   */
  protected async performHeartbeat(): Promise<void> {
    if (!this.childProcess) {
      throw new Error(`No active process for server ${this.serverName}`);
    }

    // Check if process is still alive
    if (this.childProcess.exitCode !== null) {
      throw new Error(`Process for server ${this.serverName} has exited`);
    }

    // For now, just check process status
    // In a real implementation, we'd send a ping message
    this.lastHeartbeat = new Date();
    this.emitEvent('heartbeat');
    await Promise.resolve(); // Satisfy @typescript-eslint/require-await
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
   * Spawn the child process
   */
  private spawnProcessWithHandlers(
    resolve: () => void,
    reject: (error: Error) => void,
    timeout: NodeJS.Timeout
  ): void {
    const command = this.localConfig.command;
    const args = this.localConfig.args || [];
    const options = {
      cwd: this.localConfig.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.localConfig.env
      },
      stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe']
    };

    logger.debug(`Spawning process for server ${this.serverName}: ${command} ${args.join(' ')}`);
    
    try {
      this.childProcess = spawn(command, args, options);
      
      if (!this.childProcess) {
        clearTimeout(timeout);
        return reject(new Error('Failed to spawn child process'));
      }

      // Set up event handlers IMMEDIATELY after spawn
      this.setupProcessHandlers(resolve, reject, timeout);
      
    } catch (error) {
      clearTimeout(timeout);
      reject(createMCPConnectionError(
        this.serverName,
        `Failed to spawn process for server ${this.serverName}`,
        {
          originalError: error as Error
        }
      ));
    }
  }


  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(
    resolve: () => void, 
    reject: (error: Error) => void,
    timeout?: NodeJS.Timeout
  ): void {
    if (!this.childProcess) {
      return;
    }

    const process = this.childProcess;

    // Handle successful spawn
    process.once('spawn', () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      this.processStartTime = new Date();
      logger.debug(`Process spawned successfully for server ${this.serverName} (PID: ${process.pid})`);
      resolve();
    });

    // Handle process errors
    process.on('error', (error) => {
      // Clear timeout to prevent double rejection
      if (timeout) {
        clearTimeout(timeout);
      }
      logger.error(`Process error for server ${this.serverName}:`, error);
      this.handleConnectionError(error);
      reject(error);
    });

    // Handle process exit
    process.on('exit', (code, signal) => {
      logger.info(`Process exited for server ${this.serverName} (code: ${code}, signal: ${signal})`);
      this.emitEvent('disconnected', { exitCode: code, signal });
      
      if (code !== 0 && this.status === 'connected') {
        this.handleConnectionError(new Error(`Process exited with code ${code}`));
      }
    });

    // Handle stdout data
    process.stdout?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      logger.debug(`Received stdout from ${this.serverName}: ${message}`);
      this.emitEvent('message', { type: 'stdout', message });
    });

    // Handle stderr data
    process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      logger.debug(`Received stderr from ${this.serverName}: ${message}`);
      this.emitEvent('message', { type: 'stderr', message });
    });

    // Add cleanup handler for process
    this.addCleanupHandler(async () => {
      await this.killProcess();
    });
  }

  /**
   * Send termination signal to process
   */
  private sendTerminationSignal(signal: NodeJS.Signals): void {
    if (!this.childProcess || !this.childProcess.pid) {
      return;
    }

    try {
      process.kill(this.childProcess.pid, signal);
      logger.debug(`Sent ${signal} to process ${this.childProcess.pid} for server ${this.serverName}`);
    } catch (error) {
      logger.error(`Failed to send ${signal} to process for server ${this.serverName}`, error as Error);
    }
  }

  /**
   * Kill the child process
   */
  private async killProcess(): Promise<void> {
    if (!this.childProcess) {
      return;
    }

    const process = this.childProcess;
    const pid = process.pid;
    this.childProcess = undefined;

    if (pid) {
      try {
        // Send SIGKILL directly to the stored process
        process.kill('SIGKILL');
        logger.debug(`Force killed process ${pid} for server ${this.serverName}`);
        await Promise.resolve(); // Satisfy @typescript-eslint/require-await
      } catch (error) {
        logger.error(`Error killing process for server ${this.serverName}`, error as Error);
      }
    }
  }

  /**
   * Force terminate the process immediately (for tests)
   */
  public forceTerminate(): void {
    if (this.childProcess && this.childProcess.pid) {
      try {
        this.childProcess.kill('SIGKILL');
        logger.debug(`Force terminated process ${this.childProcess.pid} for server ${this.serverName}`);
      } catch {
        logger.debug(`Process ${this.childProcess.pid} already terminated`);
      }
      this.childProcess = undefined;
    }
  }
}