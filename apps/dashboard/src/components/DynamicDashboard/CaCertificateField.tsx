import { AlertTriangle, CheckCircle2, Paperclip } from 'lucide-react';
import { ReactElement, useState } from 'react';
import { Textarea } from '../ui/Textarea';
import { inspectCaCertificate } from './dataSources.utils';

interface CaCertificateFieldProps {
  value: string;
  onChange: (ca: string) => void;
}

const TEXTAREA_CLASS =
  'bg-white text-xyne-gray-900 caret-xyne-gray-900 font-mono text-[12px] leading-[18px] ' +
  'placeholder:text-xyne-gray-400 selection:bg-xyne-primary-500/20 selection:text-xyne-gray-900 ' +
  'whitespace-pre';

const PLACEHOLDER = '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----';

const CA_TEXTAREA_ID = 'data-source-ca-certificate';

/**
 * Optional CA certificate for databases whose server certificate is signed by an
 * internal or self-signed CA. Paste is the source of truth; the file picker is a
 * shortcut that reads the .pem client-side and fills the same textarea, so there
 * is one value to validate and one value to submit.
 */
export const CaCertificateField = ({ value, onChange }: CaCertificateFieldProps): ReactElement => {
  const [readError, setReadError] = useState<string | null>(null);
  const status = inspectCaCertificate(value);

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setReadError(null);
    try {
      onChange(await file.text());
    } catch {
      setReadError('Could not read that file. Paste the certificate contents instead.');
    }
  };

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between gap-2'>
        <label
          htmlFor={CA_TEXTAREA_ID}
          className='block text-[13px] leading-[18px] font-medium text-xyne-gray-900'
        >
          CA certificate
          <span className='text-xyne-gray-400 font-normal ml-1'>(optional)</span>
        </label>

        <label
          className='inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-xyne-gray-200
                     text-[12px] leading-[16px] text-xyne-gray-900 bg-white cursor-pointer
                     hover:bg-xyne-gray-50 transition-colors'
        >
          <Paperclip size={12} aria-hidden />
          Upload .pem
          <input
            type='file'
            accept='.pem,.crt,.cer,.txt,application/x-pem-file'
            data-track-category='DATA_SOURCE'
            data-track-name='Ca_Certificate_Upload'
            className='sr-only'
            onChange={e => {
              void handleFile(e.target.files?.[0]);
              // Allow re-picking the same file after an edit.
              e.target.value = '';
            }}
          />
        </label>
      </div>

      <Textarea
        id={CA_TEXTAREA_ID}
        value={value}
        onChange={e => {
          setReadError(null);
          onChange(e.target.value);
        }}
        rows={6}
        spellCheck={false}
        placeholder={PLACEHOLDER}
        data-track-category='DATA_SOURCE'
        data-track-name='Ca_Certificate_Paste'
        className={TEXTAREA_CLASS}
      />

      {readError !== null && (
        <div className='flex items-start gap-1.5 text-[12px] leading-[16px] text-xyne-red-500'>
          <AlertTriangle size={13} className='mt-px shrink-0' aria-hidden />
          {readError}
        </div>
      )}

      {readError === null && status.kind === 'invalid' && (
        <div className='flex items-start gap-1.5 text-[12px] leading-[16px] text-xyne-red-500'>
          <AlertTriangle size={13} className='mt-px shrink-0' aria-hidden />
          {status.message}
        </div>
      )}

      {readError === null && status.kind === 'valid' && (
        <div className='flex items-start gap-1.5 text-[12px] leading-[16px] text-emerald-600'>
          <CheckCircle2 size={13} className='mt-px shrink-0' aria-hidden />
          {status.count === 1 ? '1 certificate detected' : `${status.count} certificates detected`}
        </div>
      )}

      {readError === null && status.kind === 'empty' && (
        <p className='text-[12px] leading-[16px] text-xyne-gray-400'>
          Required only if your database uses an internal or self-signed certificate.
        </p>
      )}
    </div>
  );
};
