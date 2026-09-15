import { Check } from 'lucide-react';
import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/classNames';

interface ElectronEnrollmentStepsProps {
  onLogin?: () => void;
  loading?: boolean;
  enrollmentComponent?: React.ReactNode;
  currentStep?: number;
  hasError?: boolean;
}

export function ElectronEnrollmentSteps({
  currentStep = 2,
  enrollmentComponent,
}: ElectronEnrollmentStepsProps): ReactElement {
  const { t } = useTranslation('common');
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
  const activeStep = currentStep;

  const steps = [
    {
      title: t('auth.enrollmentSteps.signInTitle'),
      description: t('auth.enrollmentSteps.signInDescription'),
    },
    {
      title: t('auth.enrollmentSteps.deviceEnrollmentTitle'),
      description: t('auth.enrollmentSteps.deviceEnrollmentDescription'),
    },
    {
      title: t('auth.enrollmentSteps.accessPortalTitle'),
      description: t('auth.enrollmentSteps.accessPortalDescription'),
      content: (
        <div className='space-y-3'>
          <p className='text-sm text-muted-foreground leading-relaxed'>
            {t('auth.enrollmentSteps.accessPortalContent')}
          </p>
          {enrollmentComponent}
        </div>
      ),
    },
  ];

  return (
    <div className='flex flex-col'>
      {/* Logo and Branding */}
      <div className='mb-4'>
        <img src='/svgs/xyne.svg' alt={t('auth.enrollmentSteps.logoAlt')} />
      </div>

      <h2 className='text-lg font-semibold text-foreground mb-6'>
        {t('auth.enrollmentSteps.heading')}
      </h2>
      <div className='space-y-0'>
        {steps.map((step, index) => {
          const isActive = index === activeStep;
          const isCompleted = index < activeStep;

          return (
            <div key={index} className='relative pl-10 pb-8 last:pb-0'>
              {/* Connecting Line */}
              {index !== steps.length - 1 && (
                <div
                  className={cn(
                    'absolute left-3.5 top-8 bottom-0 w-0.5',
                    isCompleted ? 'bg-action-primary' : 'bg-border',
                  )}
                  aria-hidden='true'
                />
              )}

              {/* Step Indicator */}
              <div
                className={cn(
                  'absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold border-2 transition-colors duration-200',
                  isActive
                    ? 'border-action-primary bg-action-primary text-action-primary-foreground'
                    : isCompleted
                      ? 'border-action-primary bg-action-primary text-action-primary-foreground'
                      : 'border-muted-foreground/30 bg-background text-muted-foreground',
                )}
              >
                {isCompleted ? <Check className='h-4 w-4' /> : index + 1}
              </div>

              <div className='pt-1'>
                <h3
                  className={cn(
                    'text-sm font-semibold mb-1',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.title}
                </h3>

                {isActive ? (
                  <div className='mt-2 animate-in fade-in slide-in-from-top-2 duration-300'>
                    {step.content}
                  </div>
                ) : (
                  <p className='text-sm text-muted-foreground/80'>{step.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className='mt-16 text-sm text-muted-foreground space-y-2 pl-2'>
        {isElectron && (
          <p>
            {t('auth.enrollmentSteps.pleaseReferTo')}{' '}
            <a
              href='https://docs.google.com/document/d/1dad4KPVMjGWE7nC3OxhXGvrL-g7AlqUprxqKklgAZcc/edit?usp=sharing'
              target='_blank'
              rel='noopener noreferrer'
              className='underline text-primary hover:text-primary/80'
            >
              {t('auth.enrollmentSteps.thisDocument')}
            </a>{' '}
            {t('auth.enrollmentSteps.forMoreDetails')}
          </p>
        )}
        <p>
          {t('auth.enrollmentSteps.reportIssuePrefix')}{' '}
          <a
            target='_blank'
            rel='noreferrer'
            href='https://juspay.slack.com/archives/C0A2BFNLBB8'
            className='font-bold text-primary hover:text-primary/80 hover:underline'
          >
            #xyne-spaces-troubleshooting
          </a>{' '}
          {t('auth.enrollmentSteps.reportIssueSuffix')}
        </p>
      </div>
    </div>
  );
}
