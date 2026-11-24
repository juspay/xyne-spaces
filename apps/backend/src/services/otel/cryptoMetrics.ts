import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// Tracks client-side field encryption latency (AES-256-GCM via WebCrypto)
let _cryptoEncryptClientLatency: Histogram | null = null;
export function getCryptoEncryptClientLatency(): Histogram {
  if (!_cryptoEncryptClientLatency) {
    _cryptoEncryptClientLatency = getMeter().createHistogram('crypto_encrypt_client_latency', {
      description: 'Latency of client-side encryption operations in milliseconds',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [
          0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 200,
        ],
      },
    });
  }
  return _cryptoEncryptClientLatency;
}


// Tracks server-side encrypted field decryption latency (used in decryption middleware)
let _cryptoDecryptServerLatency: Histogram | null = null;
export function getCryptoDecryptServerLatency(): Histogram {
  if (!_cryptoDecryptServerLatency) {
    _cryptoDecryptServerLatency = getMeter().createHistogram('crypto_decrypt_server_latency', {
      description: 'Latency of server-side decryption operations in milliseconds',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [
          0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 200,
        ],
      },
    });
  }
  return _cryptoDecryptServerLatency;
}

// Measures time to fetch user's encryption session key from database/cache
let _cryptoKeyFetchLatency: Histogram | null = null;
export function getCryptoKeyFetchLatency(): Histogram {
  if (!_cryptoKeyFetchLatency) {
    _cryptoKeyFetchLatency = getMeter().createHistogram('crypto_key_fetch_latency', {
      description: 'Latency of session key fetch operations in milliseconds',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [
          1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000,
        ],
      },
    });
  }
  return _cryptoKeyFetchLatency;
}

// Total duration for transforming pokePart data (encryption/decryption round-trip)

// Total duration for transforming pokePart data (encryption/decryption round-trip)
let _cryptoTransformTotalLatency: Histogram | null = null;
export function getCryptoTransformTotalLatency(): Histogram {
  if (!_cryptoTransformTotalLatency) {
    _cryptoTransformTotalLatency = getMeter().createHistogram('crypto_transform_total_latency', {
      description: 'Total latency of pokePart field transformation pipeline in milliseconds',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [
          1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000,
        ],
      },
    });
  }
  return _cryptoTransformTotalLatency;
}

// Counts crypto operations (encrypt/decrypt/fetch) with attributes for type/status

// Counts crypto operations (encrypt/decrypt/fetch) with attributes for type/status
let _cryptoOperations: Counter | null = null;
export function getCryptoOperations(): Counter {
  if (!_cryptoOperations) {
    _cryptoOperations = getMeter().createCounter('crypto_operations', {
      description: 'Total number of crypto operations with type and status',
      unit: '1',
    });
  }
  return _cryptoOperations;
}

let _cryptoWalkMutationArgsLatency: Histogram | null = null;
export function getCryptoWalkMutationArgsLatency(): Histogram {
  if (!_cryptoWalkMutationArgsLatency) {
    _cryptoWalkMutationArgsLatency = getMeter().createHistogram('crypto_walk_mutation_args_latency', {
      description: 'Latency of walkMutationArgs (client-encrypted field decryption before mutation)',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 200],
      },
    });
  }
  return _cryptoWalkMutationArgsLatency;
}

let _cryptoMutationReEncryptLatency: Histogram | null = null;
export function getCryptoMutationReEncryptLatency(): Histogram {
  if (!_cryptoMutationReEncryptLatency) {
    _cryptoMutationReEncryptLatency = getMeter().createHistogram('crypto_mutation_re_encrypt_latency', {
      description: 'Latency of reEncryptForStorage per mutate operation (insert/update/upsert)',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 200],
      },
    });
  }
  return _cryptoMutationReEncryptLatency;
}

let _cryptoMutationDecryptRunLatency: Histogram | null = null;
export function getCryptoMutationDecryptRunLatency(): Histogram {
  if (!_cryptoMutationDecryptRunLatency) {
    _cryptoMutationDecryptRunLatency = getMeter().createHistogram('crypto_mutation_decrypt_run_latency', {
      description: 'Latency of decryptRunResult inside transaction run() calls',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 200],
      },
    });
  }
  return _cryptoMutationDecryptRunLatency;
}

let _cryptoMutationOperations: Counter | null = null;
export function getCryptoMutationOperations(): Counter {
  if (!_cryptoMutationOperations) {
    _cryptoMutationOperations = getMeter().createCounter('crypto_mutation_operations', {
      description: 'Count of crypto operations in the mutation pipeline',
    });
  }
  return _cryptoMutationOperations;
}

// Unreadable / derived-facts migration of the Zero mutators (recorded via zero/zeroMetrics.ts).
function lazyCounter(name: string, description: string): () => Counter {
  let counter: Counter | null = null;
  return () => (counter ??= getMeter().createCounter(name, { description, unit: '1' }));
}

export const getContractApplied = lazyCounter(
  'zero_contract_applied',
  'Mutations run with a request contract (args made unreadable), by mutator',
);
export const getFactsDerived = lazyCounter(
  'zero_facts_derived',
  'Values facts were derived from, by mutator, side (args / db_read), table, column and source (local / enc-rust)',
);
export const getFactsErrors = lazyCounter(
  'zero_facts_errors',
  'Failed fact extractions, by mutator, side and source',
);
export const getUnreadableWrapped = lazyCounter(
  'zero_unreadable_wrapped',
  'Values turned into UnreadableString, by mutator, side (args / db_read), table and column',
);
export const getStorageWrites = lazyCounter(
  'zero_storage_writes',
  'Encrypted-column values written by Zero mutators, by mutator, table, column and mode (dek_at_rest / dek_passthrough)',
);
export const getComposed = lazyCounter(
  'zero_composed',
  'Values built by a compose template (server builds them from encrypted parts), by mutator, template, source (local / enc-rust) and result (changed / unchanged)',
);
export const getComposeErrors = lazyCounter(
  'zero_compose_errors',
  'Failed composes, by mutator, template and source',
);
