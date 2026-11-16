import 'dotenv/config';
import { loadKmsSecrets } from '@/config/kmsSecrets';

loadKmsSecrets()
  .then(() => import('./index.js'))
  .catch((error: unknown) => {
    process.stderr.write(`Failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
