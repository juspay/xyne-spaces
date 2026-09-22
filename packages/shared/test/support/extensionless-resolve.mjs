// The package is compiled for bundlers, which resolve extensionless relative
// imports (`./zero/schema`). Node's ESM loader does not, so tests that import
// modules pulling in those paths register this hook to retry with `.js` and
// `/index.js`.
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (error) {
          const relative = specifier.startsWith('./') || specifier.startsWith('../');
          const retryable = error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'ERR_UNSUPPORTED_DIR_IMPORT';
          if (!relative || !retryable) throw error;
          for (const suffix of ['.js', '/index.js']) {
            try {
              return await next(specifier + suffix, context);
            } catch {}
          }
          throw error;
        }
      }
    `),
  import.meta.url,
);
