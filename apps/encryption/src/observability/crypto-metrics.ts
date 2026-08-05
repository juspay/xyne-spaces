import { metrics } from '@opentelemetry/api';
import type { Attributes, Counter } from '@opentelemetry/api';

let decryptFailureCounter: Counter | null = null;

function getDecryptFailureCounter(): Counter {
  if (!decryptFailureCounter) {
    decryptFailureCounter = metrics.getMeter('xyne-spaces-encryption').createCounter('encryption_decrypt_failures', {
      description: 'Total number of encryption-service decrypt failures',
      unit: '1',
    });
  }

  return decryptFailureCounter;
}

export function recordDecryptFailure(operation: string, attributes: Attributes = {}): void {
  getDecryptFailureCounter().add(1, {
    operation,
    ...attributes,
  });
}
