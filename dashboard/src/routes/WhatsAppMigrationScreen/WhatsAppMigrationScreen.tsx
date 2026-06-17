import { type ReactElement } from 'react';
import WhatsAppMigrationPanel from '../JiraMigrationScreen/WhatsAppMigrationPanel';

const WhatsAppMigrationScreen = (): ReactElement => {
  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <div className='h-full overflow-y-auto'>
        <div className='border-b border-border bg-[linear-gradient(135deg,rgba(34,197,94,0.08),rgba(59,130,246,0.06),transparent)] p-6'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
            <div>
              <div className='inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-800'>
                Admin Migration Console
              </div>
              <h2 className='mt-3 text-xl font-bold tracking-tight text-foreground'>
                WhatsApp Migration Planner
              </h2>
              <p className='mt-2 max-w-2xl text-sm text-muted-foreground'>
                Upload a WhatsApp export zip, map participant names to emails, preview media
                coverage, and import the conversation into an existing Xyne channel.
              </p>
            </div>
            <div className='grid grid-cols-2 gap-3 text-left lg:min-w-[320px]'>
              <div className='rounded-xl border border-border bg-background/80 p-3 shadow-sm'>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>
                  Execution
                </p>
                <p className='mt-1 text-sm font-semibold text-foreground'>Async backend job</p>
                <p className='mt-1 text-xs text-muted-foreground'>Progress tracked in Redis</p>
              </div>
              <div className='rounded-xl border border-border bg-background/80 p-3 shadow-sm'>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>
                  Recovery
                </p>
                <p className='mt-1 text-sm font-semibold text-foreground'>Zip-based import</p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Preview before starting migration
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className='p-6'>
          <WhatsAppMigrationPanel />
        </div>
      </div>
    </div>
  );
};

export default WhatsAppMigrationScreen;
