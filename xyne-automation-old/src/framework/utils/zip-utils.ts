/**
 * Utility for creating zip archives
 */

import * as fs from 'fs';
import * as path from 'path';
import archiver = require('archiver');

export interface ZipOptions {
  sourceDir: string;
  outputFile: string;
  verbose?: boolean;
}

export async function createZipArchive(options: ZipOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(options.outputFile);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });

    output.on('close', () => {
      if (options.verbose) {
        console.log(` Zip archive created: ${options.outputFile} (${archive.pointer()} total bytes)`);
      }
      resolve();
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn(`Zip warning: ${err}`);
      } else {
        reject(err);
      }
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(options.sourceDir, false);
    archive.finalize();
  });
}
