import { type ReactElement } from 'react';
import { Hash, Lock } from 'lucide-react';

/** Same channel semantics as the SDLC hub picker: a hash for public, a lock otherwise. */
export function channelIcon(visibility: string | null | undefined): ReactElement {
  return visibility === 'PUBLIC' ? (
    <Hash className='size-4 text-muted-foreground' />
  ) : (
    <Lock className='size-4 text-muted-foreground' />
  );
}
