import type { ReactElement } from 'react';
import { UNDECRYPTABLE_MESSAGE_TEXT } from '../../../utils/undecryptableMessage';

export const UndecryptableMessage = (): ReactElement => (
  <span className='text-muted-foreground italic' data-testid='undecryptable-message'>
    {UNDECRYPTABLE_MESSAGE_TEXT}
  </span>
);
