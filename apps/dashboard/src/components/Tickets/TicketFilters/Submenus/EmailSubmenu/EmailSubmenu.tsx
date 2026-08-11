import { ReactElement, useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '../../../../ui/Button';
import Input from '../../../../ui/Input/Input';

interface EmailFilterValues {
  fromEmails: string[];
  toEmails: string[];
}

interface EmailSubmenuProps {
  selectedFromEmails: string[];
  selectedToEmails: string[];
  onChange: (values: EmailFilterValues) => void;
  onClose: () => void;
}

const parseAddresses = (value: string): string[] =>
  value
    .split(',')
    .map(address => address.trim())
    .filter(Boolean);

export const EmailSubmenu = ({
  selectedFromEmails,
  selectedToEmails,
  onChange,
  onClose,
}: EmailSubmenuProps): ReactElement => {
  const [fromValue, setFromValue] = useState(selectedFromEmails.join(', '));
  const [toValue, setToValue] = useState(selectedToEmails.join(', '));
  const fromInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fromInputRef.current?.focus();
  }, []);

  const apply = (): void => {
    onChange({
      fromEmails: parseAddresses(fromValue),
      toEmails: parseAddresses(toValue),
    });
    onClose();
  };

  const clear = (): void => {
    onChange({ fromEmails: [], toEmails: [] });
    onClose();
  };

  return (
    <div className='w-80 bg-background border border-border rounded-lg shadow-lg p-3 space-y-3'>
      <div className='flex items-center gap-2 text-sm font-medium'>
        <Mail className='w-4 h-4' />
        <span>Email filters</span>
      </div>
      <div className='block space-y-1.5'>
        <label htmlFor='from-email' className='text-xs font-medium text-muted-foreground'>
          From
        </label>
        <Input
          id='from-email'
          ref={fromInputRef}
          type='text'
          value={fromValue}
          onChange={event => setFromValue(event.target.value)}
          placeholder='sender@example.com'
          aria-label='Filter by sender email'
          onKeyDown={event => {
            if (event.key === 'Enter') apply();
          }}
        />
      </div>
      <div className='block space-y-1.5'>
        <label htmlFor='to-email' className='text-xs font-medium text-muted-foreground'>
          To
        </label>
        <Input
          id='to-email'
          type='text'
          value={toValue}
          onChange={event => setToValue(event.target.value)}
          placeholder='recipient@example.com'
          aria-label='Filter by recipient email'
          onKeyDown={event => {
            if (event.key === 'Enter') apply();
          }}
        />
      </div>
      <p className='text-xs text-muted-foreground'>Separate multiple addresses with commas.</p>
      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' size='sm' onClick={clear}>
          Clear
        </Button>
        <Button type='button' size='sm' onClick={apply}>
          Apply
        </Button>
      </div>
    </div>
  );
};
