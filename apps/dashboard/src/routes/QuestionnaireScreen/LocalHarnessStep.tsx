import { ReactElement, useState } from 'react';
import { ArrowRight } from '@xyne/icons';
import { Check, Laptop, Loader2 } from 'lucide-react';
import type { LocalHarnessInstallation } from '../../types/electron';
import { setLocalHarnessDefaultProvider } from '../../services/claw/localHarnessService';

export type HarnessProvider = LocalHarnessInstallation['provider'];

/* eslint-disable @typescript-eslint/naming-convention */
const HARNESS_LABEL: Record<HarnessProvider, string> = {
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex CLI',
};

const HARNESS_VENDOR: Record<HarnessProvider, string> = {
  'claude-code': 'Anthropic',
  'codex-cli': 'OpenAI',
};
/* eslint-enable @typescript-eslint/naming-convention */

const PLATFORM_NOUN: Record<string, string> = {
  darwin: 'Mac',
  win32: 'PC',
  linux: 'machine',
};

export const platformNoun = (platform: string): string => PLATFORM_NOUN[platform] ?? 'machine';

export const machineLabel = (deviceName: string): string =>
  deviceName.replace(/\s*\([^)]*\)\s*$/, '').trim() || 'This machine';

const tildify = (binaryPath: string): string => {
  const match = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Z]:\\Users\\[^\\]+)(.*)$/.exec(binaryPath);
  return match ? `~${match[2]}` : binaryPath;
};

interface PanelProps {
  installations: LocalHarnessInstallation[];
  noun: string;
  selected: HarnessProvider | null;
  onSelect: (provider: HarnessProvider) => void;
  connected: HarnessProvider | null;
  onConnected: (provider: HarnessProvider) => void;
  onBack: () => void;
  onNext: () => void;
}

export const LocalHarnessStepPanel = ({
  installations,
  noun,
  selected,
  onSelect,
  connected,
  onConnected,
  onBack,
  onNext,
}: PanelProps): ReactElement => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = selected ?? installations[0]?.provider ?? null;

  const handleConnect = async (): Promise<void> => {
    const api = window.electronAPI?.localHarness;
    if (!api || !provider || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    try {
      await api.setProviderEnabled(provider, true);
      await setLocalHarnessDefaultProvider(provider).catch(() => null);
      onConnected(provider);
      setTimeout(onNext, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not connect this ${noun}`);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className='flex-1 flex flex-col justify-center max-w-[520px] w-full md:absolute md:left-12 lg:left-16 md:top-[276px] md:bottom-[38px] md:w-[calc(100%_-_96px)] md:max-w-[600px] md:justify-start'>
      <h1 className='text-[28px] leading-[34px] font-bold text-[#242936]'>
        This {noun} can run your agents
      </h1>
      <p className='mt-2 text-[14px] leading-[22px] text-[#777B85]'>
        {installations.length === 1
          ? `${HARNESS_LABEL[installations[0]!.provider]} is already signed in here.`
          : 'Two coding CLIs are already signed in here.'}{' '}
        Connect one and your agents think on this {noun}, on your own plan. Tools, permissions and
        approvals stay in Xyne.
      </p>

      <div className='mt-[28px] h-px w-full bg-[#ECEFF3]' />

      <div
        className='mt-[36px] flex flex-col gap-3'
        role='radiogroup'
        aria-label='Which CLI to connect'
      >
        {installations.map(install => {
          const isSelected = install.provider === provider;
          return (
            <button
              key={install.provider}
              type='button'
              role='radio'
              aria-checked={isSelected}
              disabled={isConnecting || connected !== null}
              onClick={() => onSelect(install.provider)}
              className={`flex w-full items-center gap-3 rounded-[9px] border px-[14px] py-[12px] text-left transition-colors disabled:cursor-not-allowed ${
                isSelected
                  ? 'border-[#FF6868] bg-[#FFF1F1]'
                  : 'border-[#DDE3EC] bg-white hover:border-[#C8D0DC] hover:bg-[#F8FAFC]'
              }`}
              data-track-category='Questionnaire'
              data-track-name='SelectLocalHarness'
              data-track-metadata={JSON.stringify({ provider: install.provider })}
            >
              <span
                className={`flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${
                  isSelected ? 'border-[#FF6868]' : 'border-[#C8D0DC]'
                }`}
              >
                {isSelected && <span className='size-2 rounded-full bg-[#FF6868]' />}
              </span>
              <span className='min-w-0 flex-1'>
                <span className='flex items-baseline gap-2'>
                  <span className='text-[14px] leading-[20px] font-semibold text-[#272B35]'>
                    {HARNESS_LABEL[install.provider]}
                  </span>
                  <span className='truncate text-[12px] leading-[18px] text-[#8E939D]'>
                    {install.version || HARNESS_VENDOR[install.provider]}
                  </span>
                </span>
                <span className='mt-[3px] block truncate font-mono text-[12px] leading-[16px] text-[#9399A6]'>
                  {tildify(install.binaryPath)}
                </span>
              </span>
              <span className='flex shrink-0 items-center gap-1.5 text-[12px] leading-none text-[#5C9E7A]'>
                <span className='size-1.5 rounded-full bg-[#5C9E7A]' />
                Signed in
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p role='alert' className='mt-4 text-[13px] leading-[20px] text-[#D8453F]'>
          {error}
        </p>
      )}

      {connected ? (
        <p className='mt-[26px] flex items-start gap-2 text-[14px] leading-[22px] text-[#272B35]'>
          <Check className='mt-[3px] size-4 shrink-0 text-[#3F9E6B]' strokeWidth={2.5} />
          <span>
            Connected. Every agent you run will think on this {noun}, using{' '}
            <span className='font-semibold'>{HARNESS_LABEL[connected]}</span>.
          </span>
        </p>
      ) : (
        <div className='mt-auto mb-4 md:mb-0 flex items-center gap-5'>
          <button
            type='button'
            onClick={onBack}
            disabled={isConnecting}
            className='text-[14px] text-[#8E939D] hover:text-[#272B35] transition-colors disabled:opacity-50'
            data-track-category='Questionnaire'
            data-track-name='LocalHarnessBack'
          >
            Back
          </button>
          <button
            type='button'
            onClick={() => void handleConnect()}
            disabled={isConnecting || !provider}
            className='inline-flex h-[48px] items-center gap-2.5 px-5 bg-[#FF6868] text-white text-[15px] font-semibold rounded-[10px] hover:bg-[#FF5A5A] disabled:bg-[#B9B9B9] disabled:opacity-100 disabled:cursor-not-allowed transition-colors'
            data-track-category='Questionnaire'
            data-track-name='ConnectLocalHarness'
          >
            {isConnecting ? (
              <>
                <Loader2 className='h-4 w-4 animate-spin' />
                Connecting...
              </>
            ) : (
              <>
                Connect this {noun}
                <ArrowRight className='w-4 h-4' />
              </>
            )}
          </button>
          <button
            type='button'
            onClick={onNext}
            disabled={isConnecting}
            className='text-[14px] text-[#8E939D] hover:text-[#272B35] transition-colors disabled:opacity-50'
            data-track-category='Questionnaire'
            data-track-name='SkipLocalHarness'
          >
            Not now
          </button>
        </div>
      )}

      <p className='mt-[18px] text-[12px] leading-[18px] text-[#9399A6]'>
        You can change this any time in Claw Agents → Settings.
      </p>
    </div>
  );
};

interface PreviewProps {
  installations: LocalHarnessInstallation[];
  selected: HarnessProvider | null;
  connected: HarnessProvider | null;
  deviceName: string;
}

export const LocalHarnessStepPreview = ({
  installations,
  selected,
  connected,
  deviceName,
}: PreviewProps): ReactElement => {
  const provider = connected ?? selected ?? installations[0]?.provider ?? null;

  return (
    <div className='w-[368px] rounded-[16px] border border-[#E2E5EA] bg-white shadow-[0_18px_38px_rgba(27,36,52,0.13)] overflow-hidden'>
      <div className='h-[48px] flex items-center justify-center border-b border-[#EFF2F6]'>
        <div className='w-[86px] h-[20px] rounded-full border border-[#E5EAF0] bg-[#F3F5F8] shadow-[inset_0_1px_3px_rgba(20,31,48,0.08)]' />
      </div>

      <div className='px-[26px] pb-[28px] pt-[30px]'>
        <div className='flex items-center gap-3'>
          <div className='flex size-[42px] shrink-0 items-center justify-center rounded-[12px] border border-[#E2E5EA] bg-[#F8FAFD]'>
            <Laptop className='size-5 text-[#5F646D]' />
          </div>
          <div className='min-w-0'>
            <p className='truncate text-[15px] leading-[20px] font-semibold text-[#242936]'>
              {deviceName}
            </p>
            <p className='text-[13px] leading-[18px] text-[#9399A6]'>
              {provider ? HARNESS_LABEL[provider] : 'Your machine'}
            </p>
          </div>
        </div>

        <div className='relative my-[22px] ml-[20px] h-[54px] w-px'>
          <div
            className={`absolute inset-0 transition-colors duration-500 ${
              connected
                ? 'bg-[#5C9E7A]'
                : 'bg-[linear-gradient(180deg,#D4DAE4_50%,transparent_50%)] bg-[length:1px_6px]'
            }`}
          />
          {!connected && (
            <span className='absolute left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-[#FF6868] animate-[railTravelVertical_1.4s_ease-in-out_infinite] motion-reduce:hidden' />
          )}
        </div>

        <div className='flex items-center gap-3'>
          <div className='flex size-[42px] shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-b from-[#FF8C8C] to-[#FF4F4F] shadow-[0_8px_18px_rgba(255,79,79,0.24)]'>
            <img src='/svgs/icons/genius-star-white.svg' alt='' className='size-[22px]' />
          </div>
          <div className='min-w-0'>
            <p className='text-[15px] leading-[20px] font-semibold text-[#242936]'>Xyne Spaces</p>
            <p className='text-[13px] leading-[18px] text-[#9399A6]'>
              Tools, permissions and approvals
            </p>
          </div>
        </div>

        <div className='mt-[26px] rounded-[10px] border border-[#E7EBF1] bg-[#F8FAFD] px-[14px] py-[12px]'>
          <p className='text-[13px] leading-[19px] text-[#5F646D]'>
            {connected
              ? 'Your agents now think on this machine, on your own plan.'
              : 'The model runs here. Everything else keeps running on Xyne.'}
          </p>
        </div>
      </div>
    </div>
  );
};
