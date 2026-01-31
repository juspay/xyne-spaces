/**
 * PDF Report Service - TypeScript wrapper for Python PDF generator
 * Integrates with Enhanced Reporter to generate PDF reports automatically
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface PdfGenerationResult {
  success: boolean;
  pdfPath?: string;
  error?: string;
}

export class PdfReportService {
  private static instance: PdfReportService;

  private constructor() {}

  public static getInstance(): PdfReportService {
    if (!PdfReportService.instance) {
      PdfReportService.instance = new PdfReportService();
    }
    return PdfReportService.instance;
  }

  /**
   * Generate PDF report using Python script
   */
  public async generatePdfReport(cronRunId: string): Promise<PdfGenerationResult> {
    try {
      console.log(` Starting PDF report generation for CRON_RUN_ID: ${cronRunId}`);

      // Check if Python script exists
      const pythonScriptPath = path.join(__dirname, 'pdf-report-generator.py');
      if (!fs.existsSync(pythonScriptPath)) {
        throw new Error(`Python script not found: ${pythonScriptPath}`);
      }

      // Check if Python is available
      const pythonCommand = await this.getPythonCommand();
      if (!pythonCommand) {
        throw new Error('Python not found. Please ensure Python 3 is installed and available in PATH.');
      }

      // Execute Python script
      const result = await this.executePythonScript(pythonCommand, pythonScriptPath, cronRunId);
      
      if (result.success && result.pdfPath) {
        console.log(` PDF report generated successfully: ${result.pdfPath}`);
        return result;
      } else {
        console.error(` PDF generation failed: ${result.error}`);
        return result;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(` Error in PDF report generation: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Generate PDF report if CRON_RUN_ID is available
   */
  public async generateReportIfNeeded(): Promise<PdfGenerationResult | null> {
    try {
      const cronRunId = process.env.CRON_RUN_ID;
      
      if (!cronRunId) {
        console.log(' No CRON_RUN_ID found, skipping PDF report generation');
        return null;
      }

      console.log(` CRON_RUN_ID detected: ${cronRunId}, generating PDF report...`);
      return await this.generatePdfReport(cronRunId);

    } catch (error) {
      console.error(' Error in generateReportIfNeeded:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check for available Python command, preferring virtual environment
   */
  private async getPythonCommand(): Promise<string | null> {
    // First, check if virtual environment exists and has the required packages
    const venvPath = path.join(process.cwd(), 'venv-pdf');
    const venvPythonPath = path.join(venvPath, 'bin', 'python');
    
    if (fs.existsSync(venvPythonPath)) {
      console.log(` Found virtual environment at: ${venvPath}`);
      
      // Test if the virtual environment has the required packages
      try {
        const testResult = await this.executeCommand(venvPythonPath, ['-c', 'import reportlab, requests; print("Dependencies OK")']);
        if (testResult.success) {
          console.log(` Using virtual environment Python: ${venvPythonPath}`);
          return venvPythonPath;
        } else {
          console.log(` Virtual environment found but missing dependencies`);
        }
      } catch (error) {
        console.log(` Error testing virtual environment: ${error}`);
      }
    }
    
    // Fallback to system Python
    const pythonCommands = ['python3', 'python'];
    
    for (const cmd of pythonCommands) {
      try {
        const result = await this.executeCommand(cmd, ['--version']);
        if (result.success) {
          console.log(` Using system Python command: ${cmd}`);
          return cmd;
        }
      } catch (error) {
        // Continue to next command
      }
    }
    
    return null;
  }

  /**
   * Execute Python script with proper error handling
   */
  private async executePythonScript(
    pythonCommand: string, 
    scriptPath: string, 
    cronRunId: string
  ): Promise<PdfGenerationResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let pdfPath: string | undefined;

      // Set up environment variables for the Python script
      const env = {
        ...process.env,
        CRON_RUN_ID: cronRunId
      };

      console.log(` Executing: ${pythonCommand} ${scriptPath} ${cronRunId}`);

      const pythonProcess = spawn(pythonCommand, [scriptPath, cronRunId], {
        env,
        cwd: process.cwd()
      });

      pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        
        // Look for PDF output path in stdout
        const pdfPathMatch = output.match(/PDF_OUTPUT_PATH:(.+)/);
        if (pdfPathMatch) {
          pdfPath = pdfPathMatch[1].trim();
        }
        
        // Log Python output in real-time
        console.log(output.trim());
      });

      pythonProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.error(output.trim());
      });

      pythonProcess.on('close', (code) => {
        if (code === 0 && pdfPath) {
          resolve({
            success: true,
            pdfPath: pdfPath
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Python script exited with code ${code}`
          });
        }
      });

      pythonProcess.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to start Python process: ${error.message}`
        });
      });

      // Set timeout for the process (5 minutes)
      setTimeout(() => {
        pythonProcess.kill();
        resolve({
          success: false,
          error: 'PDF generation timed out after 5 minutes'
        });
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Execute a command and return result
   */
  private async executeCommand(command: string, args: string[]): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      let output = '';
      
      const process = spawn(command, args);
      
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      process.on('close', (code) => {
        resolve({
          success: code === 0,
          output: output.trim()
        });
      });
      
      process.on('error', () => {
        resolve({
          success: false,
          output: ''
        });
      });
    });
  }

  /**
   * Check if required Python dependencies are installed
   */
  public async checkDependencies(): Promise<{ success: boolean; missing: string[] }> {
    try {
      const pythonCommand = await this.getPythonCommand();
      if (!pythonCommand) {
        return {
          success: false,
          missing: ['python3']
        };
      }

      const requiredPackages = ['reportlab', 'requests'];
      const missing: string[] = [];

      for (const pkg of requiredPackages) {
        const result = await this.executeCommand(pythonCommand, ['-c', `import ${pkg}`]);
        if (!result.success) {
          missing.push(pkg);
        }
      }

      return {
        success: missing.length === 0,
        missing
      };

    } catch (error) {
      return {
        success: false,
        missing: ['python3', 'reportlab', 'requests']
      };
    }
  }

  /**
   * Install missing Python dependencies
   */
  public async installDependencies(): Promise<{ success: boolean; error?: string }> {
    try {
      const pythonCommand = await this.getPythonCommand();
      if (!pythonCommand) {
        return {
          success: false,
          error: 'Python not found'
        };
      }

      console.log(' Installing Python dependencies...');
      
      const packages = ['reportlab', 'requests'];
      const result = await this.executeCommand(pythonCommand, ['-m', 'pip', 'install', ...packages]);

      if (result.success) {
        console.log(' Python dependencies installed successfully');
        return { success: true };
      } else {
        return {
          success: false,
          error: result.output
        };
      }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Export singleton instance
export const pdfReportService = PdfReportService.getInstance();
