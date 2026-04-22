/**
 * Integrations Module
 * Import adapters to trigger auto-registration
 */

// Import adapters (triggers AdapterFactory.create() → auto-registration)
import './adapters/zoho';
import './adapters/slack-webhook-tickets';
import './adapters/microsoft';
import './adapters/google';


// Export public API
export * from './core/types';
export * from './core/errors';
export * from './core/adapterRegistry';

// Routes
export { default as externalSourceSyncRoutes } from './routes/external-source-sync';
