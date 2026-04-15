import { ReactElement, useCallback, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { logger } from '../../utils/logger';
import { Copy, Check } from 'lucide-react';

interface ContextField {
  label: string;
  value: string | undefined | null;
}

function ContextChip({ label, value }: { label: string; value: string }): ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);

  return (
    <button
      onClick={handleCopy}
      data-track-category='Inspector'
      data-track-name='Copy_Context_Field'
      className='inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 border border-border text-sm font-mono hover:bg-muted transition-colors cursor-pointer group'
      title={`Click to copy: ${value}`}
    >
      <span className='text-muted-foreground font-sans text-xs uppercase tracking-wider'>
        {label}
      </span>
      <span className='text-foreground truncate max-w-[280px]'>{value}</span>
      {copied ? (
        <Check size={12} className='text-green-500 shrink-0' />
      ) : (
        <Copy
          size={12}
          className='text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0'
        />
      )}
    </button>
  );
}

export default function ContextBar(): ReactElement {
  const { user } = useAuth();

  const fields: ContextField[] = [
    { label: 'Email', value: user?.email },
    { label: 'User ID', value: user?.id },
    { label: 'Role', value: user?.['role'] || 'user' },
    { label: 'Session', value: logger.clientSessionId },
    { label: 'Platform', value: logger.platformName },
    { label: 'Zero Client', value: logger.zeroClientId },
    { label: 'Zero Group', value: logger.zeroClientGroupId },
    { label: 'Notif WS ID', value: logger.notificationWsId },
  ];

  const validFields = fields.filter(f => f.value);

  return (
    <div className='flex flex-wrap items-center gap-2.5 px-4 py-2.5 bg-card border-b border-border'>
      <span className='text-sm font-semibold text-muted-foreground uppercase tracking-wider mr-1'>
        Your Current Session Info
      </span>
      {validFields.map(field => (
        <ContextChip key={field.label} label={field.label} value={field.value!} />
      ))}
    </div>
  );
}
