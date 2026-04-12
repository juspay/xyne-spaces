import { ReactElement, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { SignatureEditorModal } from './SignatureEditorModal';
import type { EmailSignature } from '@xyne/shared';

const SIGNATURE_ENABLED_KEY = 'signature-auto-append-enabled';

export const SignatureEditor = (): ReactElement => {
  const zero = useZero();
  const [signatures] = useCachedQuery(queries.userEmailSignatures());
  const [signatureEnabled, setSignatureEnabled] = useState(
    () => localStorage.getItem(SIGNATURE_ENABLED_KEY) !== 'false',
  );
  const [modal, setModal] = useState<{ open: boolean; editing: EmailSignature | undefined }>({
    open: false,
    editing: undefined,
  });

  const handleSaved = (data: { id?: string; name: string; content: string }): void => {
    const now = Date.now();
    if (data.id) {
      zero.mutate(
        mutators.emailSignature.update({
          id: data.id,
          name: data.name,
          content: data.content,
          timestamp: now,
        }),
      );
    } else {
      const newId = uuidv4();
      const isFirstSignature = !signatures || signatures.length === 0;
      zero.mutate(
        mutators.emailSignature.create({
          id: newId,
          name: data.name,
          content: data.content,
          timestamp: now,
          isDefault: isFirstSignature,
        }),
      );
    }
    setModal({ open: false, editing: undefined });
  };

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <button
            type='button'
            role='switch'
            aria-checked={signatureEnabled}
            onClick={() => {
              const next = !signatureEnabled;
              setSignatureEnabled(next);
              localStorage.setItem(SIGNATURE_ENABLED_KEY, String(next));
            }}
            title={signatureEnabled ? 'Disable auto-append' : 'Enable auto-append'}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
              signatureEnabled ? 'bg-[#6276be]' : 'bg-gray-200'
            }`}
            data-track-category='email-signature'
            data-track-name='toggle-signature-enabled'
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                signatureEnabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <div>
            <p className='text-sm font-medium text-gray-800'>Email Signatures</p>
            <p className='text-xs text-gray-500 mt-0.5'>
              Appended to every email reply you send from Xyne Desk.
            </p>
          </div>
        </div>
        <button
          type='button'
          onClick={() => setModal({ open: true, editing: undefined })}
          disabled={!signatureEnabled}
          className='px-3 py-1.5 text-sm font-medium text-white bg-[#6276be] rounded-lg hover:bg-[#4f62a8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          data-track-category='email-signature'
          data-track-name='open-create-signature'
        >
          + Add signature
        </button>
      </div>

      {!signatures || signatures.length === 0 ? (
        <div className='text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-xl'>
          No signatures yet. Click <strong>+ Add signature</strong> to create one.
        </div>
      ) : (
        <div
          className={`flex flex-col gap-2 transition-opacity duration-300 ${signatureEnabled ? 'opacity-100' : 'opacity-40'}`}
        >
          {signatures.map(sig => (
            <div
              key={sig.id}
              className={`flex items-center justify-between px-4 py-3 border rounded-xl bg-white transition-colors duration-300 ${
                signatureEnabled ? 'border-gray-200' : 'border-gray-100'
              }`}
            >
              <div className='flex items-center gap-2'>
                <span
                  className={`text-sm font-medium transition-colors duration-300 ${signatureEnabled ? 'text-gray-800' : 'text-gray-400'}`}
                >
                  {sig.name}
                </span>
                {sig.isDefault && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors duration-300 ${signatureEnabled ? 'bg-[#eef0fb] text-[#6276be]' : 'bg-gray-100 text-gray-400'}`}
                  >
                    Default
                  </span>
                )}
              </div>
              <div className='flex items-center gap-1'>
                <button
                  type='button'
                  title='Edit'
                  onClick={() => setModal({ open: true, editing: sig })}
                  className='p-1.5 text-gray-400 hover:text-gray-700 rounded-md hover:bg-gray-100 transition-colors'
                  data-track-category='email-signature'
                  data-track-name='edit-signature'
                >
                  <Pencil size={15} />
                </button>
                <button
                  type='button'
                  title='Delete'
                  onClick={() => zero.mutate(mutators.emailSignature.delete({ id: sig.id }))}
                  className='p-1.5 text-gray-400 hover:text-red-500 rounded-md hover:bg-gray-100 transition-colors'
                  data-track-category='email-signature'
                  data-track-name='delete-signature'
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SignatureEditorModal
        open={modal.open}
        onOpenChange={open => setModal(prev => ({ ...prev, open }))}
        {...(modal.editing ? { initial: modal.editing } : {})}
        onSaved={handleSaved}
        {...(modal.editing && !modal.editing.isDefault
          ? {
              onSetDefault: () =>
                zero.mutate(
                  mutators.emailSignature.setDefault({
                    id: modal.editing!.id,
                    timestamp: Date.now(),
                  }),
                ),
            }
          : {})}
      />
    </div>
  );
};
