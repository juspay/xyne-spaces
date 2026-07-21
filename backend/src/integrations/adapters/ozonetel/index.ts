import { AdapterFactory } from '../../core/adapterFactory';
import { ExternalSourcePlatform } from '../../core/types';
import { OzonetelAuthenticator } from './authenticator';
import { OzonetelFlow } from './flow';
import { OzonetelPostprocessor } from './postprocessor';
import { OzonetelTransformer } from './transformer';

export const ozonetelAdapter = AdapterFactory.create(
  ExternalSourcePlatform.OZONETEL,
  new OzonetelAuthenticator(),
  new OzonetelTransformer(),
  new OzonetelFlow(),
  new OzonetelPostprocessor(),
);

export { OzonetelAuthenticator } from './authenticator';
export { OzonetelFlow } from './flow';
export { OzonetelPostprocessor } from './postprocessor';
export { OzonetelTransformer } from './transformer';
export * from './types';
