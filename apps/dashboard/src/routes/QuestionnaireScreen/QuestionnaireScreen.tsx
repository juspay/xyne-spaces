import { ReactElement, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Cookies from 'js-cookie';
import { ArrowRight } from '@xyne/icons';
import { ChevronDown, ChevronRight, ChevronUp, Folder, Loader2, UserRound } from 'lucide-react';
import { QuestionnaireType } from '@xyne/shared';
import { useAuth } from '../../hooks/useAuth';
import { useZero } from '../../hooks/useZero';
import { useChannelByName } from '../../hooks/useChannels';
import { useProfilePictureUrl } from '../../hooks/useProfilePicture';
import { authActor } from '../../machines/authMachine';
import { mutators } from '../../zero/mutators';
import {
  saveQuestionnaireResponse,
  uploadProfilePicture as uploadProfilePictureViaApi,
} from '../../services/userProfile/userProfileService';
import { v4 as uuidv4 } from 'uuid';
import type { LocalHarnessInstallation } from '../../types/electron';
import {
  LocalHarnessStepPanel,
  LocalHarnessStepPreview,
  machineLabel,
  platformNoun,
  type HarnessProvider,
} from './LocalHarnessStep';

type StepKey = 'name' | 'company' | 'harness' | 'ai';

const TEAM_SIZE_OPTIONS = ['0-10', '11-100', '100-1000', '1000+'] as const;
type TeamSize = (typeof TEAM_SIZE_OPTIONS)[number];

const QuestionnaireScreen = (): ReactElement | null => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const z = useZero();

  const generalChannel = useChannelByName('general');

  const [currentStep, setCurrentStep] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const currentStepRef = useRef(0);
  currentStepRef.current = currentStep;

  const [displayName, setDisplayName] = useState(user?.['displayName'] || user?.name || '');
  const [role, setRole] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companySize, setCompanySize] = useState<TeamSize | ''>('');
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [harnesses, setHarnesses] = useState<LocalHarnessInstallation[]>([]);
  const [harnessDevice, setHarnessDevice] = useState({ name: 'This machine', platform: '' });
  const [selectedHarness, setSelectedHarness] = useState<HarnessProvider | null>(null);
  const [connectedHarness, setConnectedHarness] = useState<HarnessProvider | null>(null);

  const { url: existingPictureUrl } = useProfilePictureUrl(user?.id || '', user?.picture);
  const effectivePhotoUrl = photoPreviewUrl || existingPictureUrl || null;

  const steps: StepKey[] = [
    'name',
    'company',
    ...(harnesses.length > 0 ? (['harness'] as StepKey[]) : []),
    'ai',
  ];
  const step: StepKey = steps[currentStep] ?? 'name';

  useEffect(() => {
    const isNewUserCookie = Cookies.get('is_new_user');
    if (!isNewUserCookie) {
      void navigate('/');
    }
  }, [navigate]);

  useEffect(() => {
    const api = window.electronAPI?.localHarness;
    if (!api) return;
    let cancelled = false;
    void Promise.all([api.detect(), api.getStatus()])
      .then(([found, status]) => {
        if (cancelled || currentStepRef.current > 1) return;
        setHarnesses(found.filter(install => install.authenticated));
        setHarnessDevice({ name: machineLabel(status.deviceName), platform: status.platform });
      })
      .catch(() => {});
    return (): void => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!displayName && user) {
      setDisplayName(user['displayName'] || user.name || '');
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (photoPreviewUrl && photoPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingPhoto(true);
    try {
      const previewUrl = URL.createObjectURL(file);
      setPhotoPreviewUrl(previewUrl);
      await uploadProfilePictureViaApi(file);
    } catch {
      setPhotoPreviewUrl(null);
    } finally {
      setIsUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleComplete = async (): Promise<void> => {
    if (isCompleting) return;
    setIsCompleting(true);

    try {
      await z.mutate(
        mutators.userProfile.upsert({
          profileId: uuidv4(),
          displayName: displayName.trim() || undefined,
          role: role.trim() || undefined,
          timestamp: Date.now(),
        }),
      ).server;

      await saveQuestionnaireResponse({
        questionnaireType: QuestionnaireType.ONBOARDING,
        payload: {
          ...(companyName.trim()
            ? {
                company_name: {
                  question: 'Company name',
                  answer: companyName.trim(),
                },
              }
            : {}),
          ...(companySize
            ? {
                company_size: {
                  question: 'Company size',
                  answer: companySize,
                },
              }
            : {}),
        },
      });
    } catch {
      // Non-blocking: profile upsert failure shouldn't trap the user on the questionnaire
    }

    authActor.send({ type: 'COMPLETE_ONBOARDING' });

    const workspaceId = user?.workspaceId;
    if (workspaceId) {
      const landing = generalChannel?.id ? `/chat/dir/${generalChannel.id}` : '/chat/dir';
      void navigate(`/${workspaceId}${landing}`);
    }
  };

  const canAdvance = (): boolean => {
    if (step === 'name') return displayName.trim().length > 0;
    if (step === 'company') return companyName.trim().length > 0 && companySize !== '';
    return true;
  };

  const handleNext = (): void => {
    if (currentStep < steps.length - 1) {
      if (!canAdvance()) return;
      setCurrentStep(currentStep + 1);
      return;
    }
    void handleComplete();
  };

  if (step === 'ai') {
    return (
      <div className='relative h-[100dvh] w-full overflow-hidden bg-white'>
        <img
          src='/svgs/xyne.svg'
          alt='Xyne'
          className='absolute left-12 top-[34px] h-[30px] w-auto lg:left-16'
        />

        <div className='mx-auto flex h-full w-full max-w-[920px] flex-col items-center pt-[156px]'>
          <div className='flex h-[118px] w-[118px] items-center justify-center rounded-[30px] bg-gradient-to-b from-[#FF8C8C] to-[#FF4F4F] shadow-[0_16px_40px_rgba(255,79,79,0.24)]'>
            <img src='/svgs/icons/genius-star-white.svg' alt='' className='h-[66px] w-[66px]' />
          </div>

          <h1 className='mt-[34px] text-center text-[40px] leading-[48px] font-bold text-[#242936]'>
            Meet Xyne AI
          </h1>
          <p className='mt-[14px] max-w-[430px] text-center text-[18px] leading-[28px] font-medium text-[#5F646D]'>
            It&apos;s wherever you are, and it already knows what you&apos;re looking at
          </p>

          <div className='mt-[72px] grid grid-cols-2 gap-[38px]'>
            <div>
              <div className='relative h-[176px] w-[400px] overflow-hidden rounded-[18px] border border-[#E1E5EC] bg-[#F8FAFD] shadow-[inset_0_-44px_62px_rgba(145,158,178,0.14)]'>
                <div className='absolute inset-x-0 top-[80px] h-px bg-[#D9DEE7]' />
                <div className='absolute left-0 top-[97px] h-[66px] w-[338px] rounded-r-[14px] bg-white shadow-[0_13px_28px_rgba(30,41,59,0.18)]'>
                  <div className='absolute -left-[12px] top-[16px] h-[36px] w-[36px] overflow-hidden rounded-full bg-gradient-to-br from-[#98C464] to-[#DCA47C]'>
                    <div className='absolute left-[13px] top-[9px] h-[18px] w-[18px] rounded-full bg-[#D19A72]' />
                    <div className='absolute bottom-[-10px] left-[8px] h-[30px] w-[28px] rounded-t-full bg-[#6A2F1F]' />
                  </div>
                  <div className='absolute left-[38px] top-[15px] flex items-baseline gap-2.5'>
                    <span className='text-[16px] leading-none font-bold text-[#242936]'>Alex</span>
                    <span className='text-[14px] leading-none text-[#747B87]'>11:05</span>
                  </div>
                  <div className='absolute left-[38px] top-[39px] text-[17px] leading-none text-[#242936]'>
                    Who owns the pricing page now?
                  </div>
                </div>
                <div className='absolute left-[188px] top-[57px] flex h-[45px] w-[168px] items-center justify-center gap-5 rounded-[13px] border border-[#DDE3EC] bg-white shadow-[0_8px_18px_rgba(30,41,59,0.14)]'>
                  <span className='text-[16px] leading-none font-normal text-[#8A929F]'>☺</span>
                  <span className='relative h-4 w-4'>
                    <span className='absolute left-[3px] top-[7px] h-px w-[10px] rounded-full bg-[#8A929F]' />
                    <span className='absolute left-[3px] top-[4px] h-[7px] w-[7px] rotate-45 border-b border-l border-[#8A929F]' />
                    <span className='absolute right-[1px] top-[7px] h-[7px] w-[6px] rounded-tr-full border-r border-t border-[#8A929F]' />
                  </span>
                  <span className='relative h-4 w-4'>
                    <span className='absolute left-[1px] top-[3px] h-[11px] w-[14px] rounded-t-full border border-b-0 border-[#8A929F]' />
                    <span className='absolute left-[1px] top-[9px] h-[6px] w-[3px] rounded-sm bg-[#8A929F]' />
                    <span className='absolute right-[1px] top-[9px] h-[6px] w-[3px] rounded-sm bg-[#8A929F]' />
                  </span>
                  <img src='/svgs/icons/ai-bot-gradient-star.svg' alt='' className='h-4 w-4' />
                </div>
              </div>
              <p className='mt-[22px] text-center text-[18px] leading-[24px] font-semibold text-black'>
                Call from anywhere
              </p>
            </div>

            <div>
              <div className='relative h-[176px] w-[400px] overflow-hidden rounded-[18px] border border-[#E1E5EC] bg-[#F8FAFD] shadow-[inset_0_-44px_62px_rgba(145,158,178,0.14)]'>
                <div className='absolute inset-x-0 top-[66px] h-px bg-[#D9DEE7]' />
                <div className='absolute left-[62px] top-[58px] h-[92px] w-[342px] rounded-[14px] bg-white shadow-[0_13px_28px_rgba(30,41,59,0.18)]'>
                  <div className='absolute left-[20px] top-[23px] whitespace-nowrap text-[17px] leading-[23px] text-[#242936]'>
                    <span className='rounded-[5px] bg-[#DCEAFF] px-1 text-[#4D8BFF]'>@xyne</span>
                    <span className='ml-2'>create a ticket from this convo</span>
                  </div>
                  <div className='absolute bottom-[18px] left-[20px] flex gap-5 text-[19px] leading-none text-[#747C89]'>
                    <span>+</span>
                    <span>☺</span>
                    <span>@</span>
                    <span>#</span>
                  </div>
                </div>
              </div>
              <p className='mt-[22px] text-center text-[18px] leading-[24px] font-semibold text-black'>
                Or just say @xyne
              </p>
            </div>
          </div>

          <button
            type='button'
            onClick={() => void handleComplete()}
            disabled={isCompleting}
            className='mt-[120px] inline-flex h-[56px] items-center gap-3 rounded-[12px] bg-[#FF6868] px-6 text-[18px] font-semibold text-white transition-colors hover:bg-[#FF5A5A] disabled:cursor-not-allowed disabled:opacity-60'
            data-track-category='Questionnaire'
            data-track-name='EnterWorkspace'
          >
            {isCompleting ? 'Entering...' : 'Enter Workspace'}
            <ArrowRight className='h-5 w-5' />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='h-[100dvh] w-full bg-white grid grid-cols-1 md:grid-cols-2 overflow-hidden'>
      {/* Left panel */}
      <div className='relative flex flex-col px-6 py-8 md:p-0 overflow-y-auto overflow-x-hidden'>
        <img
          src='/svgs/xyne.svg'
          alt='Xyne'
          className='h-7 w-auto self-start md:absolute md:left-12 lg:left-16 md:top-[34px] md:h-[30px]'
        />

        {step === 'name' && (
          <div className='flex-1 flex flex-col justify-center max-w-[520px] w-full md:absolute md:left-12 lg:left-16 md:top-[329px] md:bottom-[38px] md:w-[calc(100%_-_96px)] md:max-w-[600px] md:justify-start'>
            <h1 className='text-[30px] leading-[36px] md:text-[30px] md:leading-[36px] font-bold text-[#1f2430]'>
              Whats your name?
            </h1>
            <p className='mt-2 text-[14px] leading-[22px] text-[#777B85]'>
              Adding your name and profile photo helps your teammates recognise and connect with you
              more easily
            </p>

            <input
              type='text'
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder='Enter your full name'
              autoComplete='off'
              className='mt-[24px] h-[44px] w-full px-[13px] border border-[#DDE3EC] rounded-[9px] bg-white text-[#272B35] text-[14px] placeholder:text-[#B2B6BE] focus:outline-none focus:border-[#AEB7C5] transition-colors'
              data-track-category='Questionnaire'
              data-track-name='DisplayNameInput'
            />

            <div className='mt-[52px] h-px w-full bg-[#ECEFF3]' />

            <div className='mt-[52px]'>
              <p className='text-[14px] leading-[20px] font-semibold text-[#272B35]'>
                Whats your role in your team?
              </p>
              <input
                type='text'
                value={role}
                onChange={e => setRole(e.target.value)}
                placeholder='Ex: Product Manager'
                autoComplete='off'
                className='mt-[10px] h-[44px] w-full px-[13px] border border-[#DDE3EC] rounded-[9px] bg-white text-[#272B35] text-[14px] placeholder:text-[#B2B6BE] focus:outline-none focus:border-[#AEB7C5] transition-colors'
                data-track-category='Questionnaire'
                data-track-name='RoleInput'
              />
            </div>

            <div className='mt-[46px] flex items-center justify-between'>
              <p className='text-[14px] leading-[20px] font-semibold text-[#272B35]'>
                Your profile photo{' '}
                <span className='text-[#8E939D] font-normal text-[12px]'>(optional)</span>
              </p>
              <button
                type='button'
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingPhoto}
                className='inline-flex h-[32px] min-w-[78px] items-center justify-center px-3 border border-[#DDE3EC] rounded-[8px] bg-white text-[14px] leading-none text-[#272B35] hover:bg-[#F8FAFC] transition-colors disabled:opacity-50'
                data-track-category='Questionnaire'
                data-track-name='UploadPhoto'
              >
                {isUploadingPhoto ? <Loader2 className='w-4 h-4 animate-spin' /> : null}
                Upload
              </button>
              <input
                ref={fileInputRef}
                type='file'
                accept='image/jpeg,image/png,image/webp'
                onChange={e => void handlePhotoChange(e)}
                className='hidden'
              />
            </div>

            <button
              type='button'
              onClick={handleNext}
              disabled={!displayName.trim()}
              className='mt-auto mb-4 md:mb-0 self-start inline-flex h-[48px] items-center gap-2.5 px-5 bg-[#FF6868] text-white text-[15px] font-semibold rounded-[10px] hover:bg-[#FF5A5A] disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
              data-track-category='Questionnaire'
              data-track-name='Step1Next'
            >
              Next
              <ArrowRight className='w-4 h-4' />
            </button>
          </div>
        )}

        {step === 'company' && (
          <div className='flex-1 flex flex-col justify-center max-w-[520px] w-full md:absolute md:left-12 lg:left-[100px] md:top-[276px] md:bottom-[38px] md:w-[calc(100%_-_96px)] lg:w-[calc(100%_-_200px)] md:max-w-[776px] md:justify-start'>
            <h1 className='text-[28px] leading-[34px] font-bold text-[#242936]'>
              Tell us about your company
            </h1>
            <p className='mt-2 text-[14px] leading-[22px] text-[#777B85]'>
              This helps us set up your Xyne workspace for your team.
            </p>

            <div className='mt-[28px] h-px w-full bg-[#ECEFF3]' />

            <div className='mt-[54px]'>
              <p className='text-[14px] leading-[20px] font-semibold text-[#272B35]'>
                Company name
              </p>
              <input
                type='text'
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder='Ex: Nike'
                autoComplete='organization'
                className='mt-[12px] h-[44px] w-full px-[13px] border border-[#DDE3EC] rounded-[9px] bg-white text-[#272B35] text-[14px] placeholder:text-[#B2B6BE] focus:outline-none focus:border-[#AEB7C5] transition-colors'
                data-track-category='Questionnaire'
                data-track-name='CompanyNameInput'
              />
            </div>

            <div className='mt-[28px]'>
              <p className='text-[14px] leading-[20px] font-semibold text-[#272B35]'>
                Company size
              </p>
              <div
                className='mt-[12px] grid grid-cols-2 gap-3'
                role='radiogroup'
                aria-label='Company size'
              >
                {TEAM_SIZE_OPTIONS.map(size => {
                  const isSelected = companySize === size;
                  return (
                    <button
                      key={size}
                      type='button'
                      role='radio'
                      aria-checked={isSelected}
                      onClick={() => setCompanySize(size)}
                      className={`h-[44px] rounded-[9px] border px-[13px] text-left text-[14px] font-medium transition-colors ${
                        isSelected
                          ? 'border-[#FF6868] bg-[#FFF1F1] text-[#242936]'
                          : 'border-[#DDE3EC] bg-white text-[#777B85] hover:border-[#C8D0DC] hover:bg-[#F8FAFC]'
                      }`}
                      data-track-category='Questionnaire'
                      data-track-name='CompanySizeSelect'
                      data-track-metadata={JSON.stringify({ size })}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className='mt-auto mb-4 md:mb-0 flex items-center gap-5'>
              <button
                type='button'
                onClick={() => setCurrentStep(0)}
                className='text-[14px] text-[#8E939D] hover:text-[#272B35] transition-colors'
                data-track-category='Questionnaire'
                data-track-name='Step2Back'
              >
                Back
              </button>
              <button
                type='button'
                onClick={handleNext}
                disabled={!companyName.trim() || !companySize}
                className='inline-flex h-[48px] items-center gap-2.5 px-5 bg-[#FF6868] text-white text-[15px] font-semibold rounded-[10px] hover:bg-[#FF5A5A] disabled:bg-[#B9B9B9] disabled:opacity-100 disabled:cursor-not-allowed transition-colors'
                data-track-category='Questionnaire'
                data-track-name='Step2Next'
              >
                Next
                <ArrowRight className='w-4 h-4' />
              </button>
            </div>
          </div>
        )}

        {step === 'harness' && (
          <LocalHarnessStepPanel
            installations={harnesses}
            noun={platformNoun(harnessDevice.platform)}
            selected={selectedHarness}
            onSelect={setSelectedHarness}
            connected={connectedHarness}
            onConnected={setConnectedHarness}
            onBack={() => setCurrentStep(currentStep - 1)}
            onNext={handleNext}
          />
        )}
      </div>

      {/* Right panel */}
      <div className='hidden md:flex items-center justify-center bg-[#F8F9FB] border-l border-[#ECEFF3]'>
        {step === 'name' && (
          <div className='w-[368px] rounded-[16px] border border-[#E2E5EA] bg-white shadow-[0_18px_38px_rgba(27,36,52,0.13)] overflow-hidden'>
            <div className='h-[48px] flex items-center justify-center'>
              <div className='w-[86px] h-[20px] rounded-full border border-[#E5EAF0] bg-[#F3F5F8] shadow-[inset_0_1px_3px_rgba(20,31,48,0.08)]' />
            </div>
            {effectivePhotoUrl ? (
              <img
                src={effectivePhotoUrl}
                alt=''
                className='mx-[23px] h-[324px] w-[322px] rounded-[20px] object-cover'
              />
            ) : (
              <div className='mx-[23px] h-[324px] w-[322px] rounded-[20px] bg-[#FAFAFB] flex items-center justify-center'>
                <span className='text-[68px] leading-none font-bold text-[#E1E2E5]'>
                  {(displayName.trim()[0] || '?').toUpperCase()}
                </span>
              </div>
            )}
            <div className='px-[23px] pb-[25px] pt-[14px] text-center'>
              <p className='text-[18px] leading-[24px] font-bold text-[#242936]'>
                {displayName.trim() || 'Your name'}
              </p>
              <p className='mt-1 text-[16px] leading-[20px] text-[#9399A6]'>{user?.email}</p>
            </div>
          </div>
        )}

        {step === 'company' && (
          <div className='relative h-full w-full overflow-hidden bg-[#F8F9FB]'>
            <div className='absolute left-0 right-0 top-[164px] h-[calc(100%-164px)] bg-[#F5F8FC]' />
            <div className='absolute left-[16.5%] right-0 top-[164px] z-[3] h-[18px] border-t border-[#DDE5F0] bg-white' />
            <div className='absolute bottom-0 left-[calc(16.5%+416px)] right-0 top-[182px] z-[4] rounded-tl-[42px] border-l border-t border-[#DDE5F0] bg-white' />

            <div className='absolute left-[11%] top-[164px] z-10 flex h-[84px] w-[468px] max-w-[68%] -translate-y-1/2 items-center rounded-[16px] border border-[#DDE3EC] bg-white px-[22px] shadow-[0_16px_34px_rgba(25,35,55,0.16)]'>
              <span className='max-w-[350px] truncate text-[22px] leading-none font-bold text-[#172032]'>
                {companyName.trim() || 'Company name'}
              </span>
              <span className='ml-4 flex flex-col items-center justify-center gap-0.5 text-[#8B95A6]'>
                <ChevronUp className='size-4' strokeWidth={2.25} />
                <ChevronDown className='size-4' strokeWidth={2.25} />
              </span>
            </div>

            <div className='absolute bottom-0 left-[16.5%] top-[164px] z-[2] w-[416px] overflow-hidden bg-[#F5F8FC] pt-[116px] shadow-[inset_0_0_36px_rgba(136,153,180,0.12)]'>
              <div className='absolute inset-y-0 left-0 w-[28px] bg-white/80' />
              <div className='absolute inset-y-0 left-[28px] w-[1px] bg-[#EDF2F8]' />
              <div className='px-[18px] pl-[74px]'>
                <div className='h-[45px] w-full rounded-[14px] bg-[#E2E8F1]' />

                <div className='mt-[30px] flex items-center gap-4'>
                  <Folder className='size-5 text-[#8792A3]' />
                  <div className='h-[45px] flex-1 rounded-[14px] bg-[#DCE4EF]' />
                  <ChevronRight className='size-5 text-[#8792A3]' />
                </div>

                <div className='mt-[22px] flex items-center gap-4'>
                  <Folder className='size-5 text-[#8792A3]' />
                  <div className='h-[45px] flex-1 rounded-[14px] bg-[#DCE4EF]' />
                  <ChevronRight className='size-5 text-[#8792A3]' />
                </div>

                <div className='mt-[30px] flex items-center gap-4 text-[#8792A3]'>
                  <UserRound className='size-5' />
                  <span className='text-[20px] leading-none'>Direct Messages</span>
                  <ChevronRight className='ml-auto size-5' />
                </div>

                <div className='mt-[22px] h-[45px] w-full rounded-[14px] bg-[#DCE4EF]' />
                <div className='mt-[28px] h-[45px] w-full rounded-[14px] bg-[#DCE4EF]' />
              </div>
            </div>
          </div>
        )}

        {step === 'harness' && (
          <LocalHarnessStepPreview
            installations={harnesses}
            selected={selectedHarness}
            connected={connectedHarness}
            deviceName={harnessDevice.name}
          />
        )}
      </div>
    </div>
  );
};

export default QuestionnaireScreen;
