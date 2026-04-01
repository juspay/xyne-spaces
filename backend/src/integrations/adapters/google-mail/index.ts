import { AdapterFactory } from '../../core/adapterFactory';
import { ExternalSourcePlatform } from '../../core/types';
import { GoogleMailAuthenticator } from './authenticator';
import { GoogleMailFlow } from './flow';
import { GoogleMailTransformer } from './transformer';

export const googleMailAdapter = AdapterFactory.create(
  ExternalSourcePlatform.GOOGLE,
  new GoogleMailAuthenticator(),
  new GoogleMailTransformer(),
  new GoogleMailFlow()
);

export { GoogleMailAuthenticator } from './authenticator';
export { GoogleMailFlow } from './flow';
export { GoogleMailTransformer } from './transformer';
export * from './types';
