import { type ReactElement, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { OnboardingConnectLogo } from './OnboardingConnectLogos';
import {
  addPrototypeConnectKey,
  PROTOTYPE_CONNECTORS,
  tap4FooterAction,
  type PrototypeConnectKey,
} from './onboardingFlow';
import {
  GREETING_CHROME_DELAY,
  GREETING_CHROME_DURATION,
  GREETING_CHROME_STAGGER,
  GREETING_HERO_BLUR_PX,
  GREETING_HERO_DELAY,
  GREETING_HERO_DURATION,
  GREETING_HERO_EASE,
  GREETING_HERO_Y,
  GREETING_HOLD_MS,
  GREETING_OUT_DURATION,
  GREETING_REDUCED_HOLD_MS,
  greetingBeat,
  greetingBeatAfter,
  greetingHeroDesktopLines,
  greetingHelloText,
  greetingQuestionCanAdvance,
  greetingReadyDelayMs,
  type GreetingBeatId,
  type GreetingChoiceKey,
  type GreetingQuestionOption,
} from './onboardingGreeting';

const cinematicTextClassName =
  'whitespace-nowrap text-center text-[28px] font-[450] leading-[1.2] tracking-[-0.8px] text-[#1c1e1f] sm:text-[40px]';

/** Figma 303:3097 title — Regular 40 / -0.8px / #1c1e1f / leading-none / 450. */
const questionTitleClassName =
  'w-full whitespace-nowrap text-[32px] font-[450] leading-none tracking-[-0.8px] text-[#1c1e1f] sm:text-[40px]';

const optionLabelClassName =
  'text-[16px] font-medium leading-[1.2] tracking-[-0.64px] text-[#232229]';

const pillClassName =
  'inline-flex h-9 min-w-11 items-center justify-center rounded-full px-4 text-[15px] font-[550] leading-[1.5] tracking-[-0.1px]';

/** Selected chrome from 303:3097 — 50px on every question, including selected. */
const selectedRowClassName =
  'h-[50px] border-[0.427px] border-solid border-[#dfdfe0] bg-white shadow-[0px_6.834px_0.854px_rgba(0,0,0,0),0px_4.271px_0.854px_rgba(0,0,0,0.01),0px_2.563px_0.641px_rgba(0,0,0,0.02),0px_1.281px_0.641px_rgba(0,0,0,0.03),0px_0.427px_0.214px_rgba(0,0,0,0.04)]';

const idleRowClassName =
  'h-[50px] border-[0.427px] border-solid border-transparent hover:bg-[rgba(35,34,41,0.04)]';

const optionRowBaseClassName =
  'flex w-full items-center justify-between rounded-[16px] px-4 text-left';

/**
 * Figma 303:3211 — Something else is not a chip. Idle is 614×50, radius 0,
 * no hover fill. Placeholder uses text+icons/disabled (#23222966 /
 * rgba(35,34,41,0.4)). Focus draws a bottom stroke in text+icons/primary
 * (#232229); 303:3211 has no focus variant or motion tracks.
 */
const otherFieldClassName =
  'group relative flex h-[50px] w-full cursor-text items-center justify-between rounded-none px-4 text-left hover:bg-transparent';

const otherFieldStrokeClassName =
  'pointer-events-none absolute inset-x-0 bottom-0 h-px origin-center scale-x-0 bg-[#232229] transition-transform duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-focus-within:scale-x-100 motion-reduce:transition-none';

const CheckTick = (): ReactElement => (
  <img
    src='/login-preview/check-tick-single.svg'
    alt=''
    width={16}
    height={16}
    className='size-4 shrink-0'
    aria-hidden='true'
  />
);

const heroHidden = {
  opacity: 0,
  filter: `blur(${GREETING_HERO_BLUR_PX}px)`,
  transform: `translateY(${GREETING_HERO_Y})`,
};

const heroShown = {
  opacity: 1,
  filter: 'blur(0px)',
  transform: 'translateY(0%)',
};

const reducedHero = { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0%)' };

const chromeHidden = { opacity: 0, y: 12 };
const chromeShown = { opacity: 1, y: 0 };

const GreetingHeroTitle = ({
  text,
  className,
  as: Tag,
  reduceMotion,
}: {
  text: string;
  className: string;
  as: 'p' | 'h1';
  reduceMotion: boolean;
}): ReactElement => {
  const hidden = reduceMotion ? reducedHero : heroHidden;
  const shown = reduceMotion ? reducedHero : heroShown;
  const transition = reduceMotion
    ? { duration: 0 }
    : {
        duration: GREETING_HERO_DURATION,
        delay: GREETING_HERO_DELAY,
        ease: GREETING_HERO_EASE,
      };

  return (
    <Tag
      className={className}
      style={{ fontVariationSettings: '"GRAD" 0, "ROND" 0, "wdth" 96' }}
      data-hero-desktop-lines={1}
      data-hero-mobile-chunks={1}
    >
      <motion.span
        className='inline-block whitespace-nowrap'
        initial={hidden}
        animate={shown}
        transition={transition}
        aria-hidden='true'
      >
        {text}
      </motion.span>
      <span className='sr-only'>{text}</span>
    </Tag>
  );
};

const optionChromeClassName = (selected: boolean): string =>
  `${optionRowBaseClassName} ${optionLabelClassName} ${selected ? selectedRowClassName : idleRowClassName}`;

const QuestionOptionRow = ({
  option,
  selected,
  otherText,
  reduceMotion,
  onSelect,
  onOtherText,
}: {
  option: GreetingQuestionOption;
  selected: boolean;
  otherText: string;
  reduceMotion: boolean;
  onSelect: (key: GreetingChoiceKey) => void;
  onOtherText: (value: string) => void;
}): ReactElement => {
  const chromeVariants = {
    hidden: reduceMotion ? chromeShown : chromeHidden,
    show: {
      ...chromeShown,
      transition: {
        duration: reduceMotion ? 0 : GREETING_CHROME_DURATION,
        ease: GREETING_HERO_EASE,
      },
    },
  };

  if (option.input === true) {
    const filled = selected && otherText.trim().length > 0;
    return (
      <motion.div variants={chromeVariants} className='w-full'>
        <label className={otherFieldClassName} data-greeting-other-field='true'>
          <input
            type='text'
            value={otherText}
            placeholder={option.label}
            onFocus={() => onSelect(option.key)}
            onChange={event => {
              onSelect(option.key);
              onOtherText(event.target.value);
            }}
            className={`h-full min-w-0 flex-1 bg-transparent ${optionLabelClassName} placeholder:text-[rgba(35,34,41,0.4)] focus:outline-none`}
            style={{ fontVariationSettings: '"GRAD" 0, "ROND" 0, "wdth" 100' }}
            data-testid={`onboarding-greeting-option-${option.key}`}
            data-track-category='OnboardingPrototype'
            data-track-name='GreetingChoiceOther'
            aria-label={option.label}
          />
          {filled ? <CheckTick /> : null}
          <span aria-hidden='true' className={otherFieldStrokeClassName} />
        </label>
      </motion.div>
    );
  }

  return (
    <motion.button
      type='button'
      variants={chromeVariants}
      onClick={() => onSelect(option.key)}
      data-testid={`onboarding-greeting-option-${option.key}`}
      data-track-category='OnboardingPrototype'
      data-track-name='GreetingChoice'
      className={optionChromeClassName(selected)}
    >
      <span
        className={optionLabelClassName}
        style={{ fontVariationSettings: '"GRAD" 0, "ROND" 0, "wdth" 100' }}
      >
        {option.label}
      </span>
      {selected ? <CheckTick /> : null}
    </motion.button>
  );
};

/**
 * Full-screen white cinematic greeting for the public /onboarding prototype.
 * Question chrome is Figma 303:3097 on every beat. Titles use Linear.app hero reveal.
 */
export const OnboardingGreetingPrototype = ({
  displayName,
  onComplete,
}: {
  displayName: string;
  onComplete: () => void;
}): ReactElement => {
  const reduceMotion = useReducedMotion() === true;
  const [beatId, setBeatId] = useState<GreetingBeatId>('hello');
  const [ready, setReady] = useState(false);
  const [selectedKey, setSelectedKey] = useState<GreetingChoiceKey | null>(null);
  const [otherText, setOtherText] = useState('');
  const [checkedKeys, setCheckedKeys] = useState<PrototypeConnectKey[]>([]);
  const lockRef = useRef(false);
  const pendingPromptRef = useRef<'advance' | 'skip' | null>(null);
  const goRef = useRef<(action: 'advance' | 'skip') => void>(() => undefined);

  const beat = greetingBeat(beatId);
  const titleText =
    beat.kind === 'line' && beat.id === 'hello'
      ? greetingHelloText(displayName)
      : beat.kind === 'line' || beat.kind === 'prompt'
        ? beat.text
        : beat.kind === 'question' || beat.kind === 'connectors'
          ? beat.title
          : '';
  const selectedOption =
    beat.kind === 'question' ? beat.options.find(option => option.key === selectedKey) : undefined;
  const canQuestionNext = greetingQuestionCanAdvance(selectedOption, otherText);
  const submittedValue =
    selectedOption?.input === true ? otherText.trim() : (selectedOption?.label ?? '');
  const heroLineCount = greetingHeroDesktopLines(titleText).length;
  const outDuration = reduceMotion ? 0 : GREETING_OUT_DURATION;

  const go = (action: 'advance' | 'skip'): void => {
    if (lockRef.current) {
      return;
    }
    lockRef.current = true;
    pendingPromptRef.current = null;
    const next = greetingBeatAfter(beatId, action);
    if (next === 'complete') {
      onComplete();
      return;
    }
    setSelectedKey(null);
    setOtherText('');
    setReady(false);
    setBeatId(next);
  };
  goRef.current = go;

  useEffect((): (() => void) => {
    lockRef.current = false;
    pendingPromptRef.current = null;
    setReady(false);
    const fallback = window.setTimeout(
      (): void => {
        setReady(true);
      },
      greetingReadyDelayMs(reduceMotion, heroLineCount, beatId !== 'hello'),
    );
    return (): void => window.clearTimeout(fallback);
  }, [beatId, heroLineCount, reduceMotion]);

  useEffect((): (() => void) | undefined => {
    if (!ready || beat.kind !== 'line') {
      return undefined;
    }
    const hold = reduceMotion ? GREETING_REDUCED_HOLD_MS : GREETING_HOLD_MS;
    const timer = window.setTimeout((): void => goRef.current('advance'), hold);
    return (): void => window.clearTimeout(timer);
  }, [ready, beat.kind, beatId, reduceMotion]);

  useEffect((): void => {
    if (!ready || beat.kind !== 'prompt' || !pendingPromptRef.current) {
      return;
    }
    const action = pendingPromptRef.current;
    pendingPromptRef.current = null;
    goRef.current(action);
  }, [ready, beat.kind, beatId]);

  const handleSelect = (key: GreetingChoiceKey): void => {
    setSelectedKey(key);
  };

  const handleQuestionNext = (): void => {
    if (!ready || !canQuestionNext) {
      return;
    }
    go('advance');
  };

  const handlePrompt = (action: 'advance' | 'skip'): void => {
    pendingPromptRef.current = action;
    if (ready) {
      go(action);
    }
  };

  const handleConnectClick = (key: PrototypeConnectKey): void => {
    if (!ready || checkedKeys.includes(key)) {
      return;
    }
    setCheckedKeys((current): PrototypeConnectKey[] => addPrototypeConnectKey(current, key));
  };

  const handleConnectFooter = (): void => {
    if (!ready) {
      return;
    }
    go(tap4FooterAction(checkedKeys.length) === 'skip' ? 'skip' : 'advance');
  };

  const chromeItemVariants = {
    hidden: reduceMotion ? chromeShown : chromeHidden,
    show: {
      ...chromeShown,
      transition: {
        duration: reduceMotion ? 0 : GREETING_CHROME_DURATION,
        ease: GREETING_HERO_EASE,
      },
    },
  };

  const chromeGroupVariants = {
    hidden: {},
    show: {
      transition: {
        staggerChildren: reduceMotion ? 0 : GREETING_CHROME_STAGGER,
        delayChildren: reduceMotion ? 0 : GREETING_CHROME_DELAY,
      },
    },
  };

  return (
    <div
      className='relative flex h-[100dvh] w-full overflow-hidden bg-white'
      role='main'
      aria-label='Onboarding greeting'
      data-testid='onboarding-greeting'
      data-greeting-ready={ready ? 'true' : 'false'}
      data-greeting-beat={beatId}
      data-greeting-hello-name={displayName}
      data-greeting-other-text={otherText}
      data-greeting-submit-value={submittedValue}
    >
      <AnimatePresence mode='wait'>
        <motion.div
          key={beatId}
          className={
            beat.kind === 'line' || beat.kind === 'prompt'
              ? 'flex h-full w-full flex-col items-center justify-center px-6'
              : 'flex h-full w-full justify-center overflow-y-auto px-6 pb-10 pt-16 sm:pt-[200px] min-[1728px]:justify-start min-[1728px]:pl-[594px] min-[1728px]:pr-6'
          }
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{
            opacity: 0,
            transition: { duration: outDuration, ease: GREETING_HERO_EASE },
          }}
          data-testid={`onboarding-greeting-${beatId}`}
        >
          <div
            className={
              beat.kind === 'line' || beat.kind === 'prompt'
                ? 'flex w-full max-w-[1013px] flex-col items-center'
                : 'flex w-full max-w-[614px] flex-col items-start'
            }
          >
            {(beat.kind === 'line' || beat.kind === 'prompt') && (
              <GreetingHeroTitle
                as='p'
                text={titleText}
                className={cinematicTextClassName}
                reduceMotion={reduceMotion}
              />
            )}

            {beat.kind === 'prompt' && (
              <motion.div
                className='mt-8 flex items-center gap-4'
                initial='hidden'
                animate='show'
                variants={chromeGroupVariants}
              >
                <motion.button
                  type='button'
                  variants={chromeItemVariants}
                  onClick={() => handlePrompt('skip')}
                  className={`${pillClassName} text-[#232229]`}
                  data-testid='onboarding-greeting-skip'
                  data-track-category='OnboardingPrototype'
                  data-track-name='GreetingSkip'
                >
                  Skip
                </motion.button>
                <motion.button
                  type='button'
                  variants={chromeItemVariants}
                  onClick={() => handlePrompt('advance')}
                  className={`${pillClassName} bg-[#232229] text-white`}
                  data-testid='onboarding-greeting-continue'
                  data-track-category='OnboardingPrototype'
                  data-track-name='GreetingContinue'
                >
                  Continue
                </motion.button>
              </motion.div>
            )}

            {beat.kind === 'question' && (
              <div className='flex w-full flex-col items-start gap-12'>
                <GreetingHeroTitle
                  as='h1'
                  text={beat.title}
                  className={questionTitleClassName}
                  reduceMotion={reduceMotion}
                />
                <motion.div
                  className='flex w-full flex-col items-start gap-6'
                  initial='hidden'
                  animate='show'
                  variants={chromeGroupVariants}
                >
                  {beat.options.map(option => (
                    <QuestionOptionRow
                      key={option.key}
                      option={option}
                      selected={selectedKey === option.key}
                      otherText={otherText}
                      reduceMotion={reduceMotion}
                      onSelect={handleSelect}
                      onOtherText={setOtherText}
                    />
                  ))}
                </motion.div>
                <motion.div
                  className='flex w-full justify-end'
                  initial='hidden'
                  animate='show'
                  variants={chromeGroupVariants}
                >
                  <motion.button
                    type='button'
                    variants={chromeItemVariants}
                    onClick={handleQuestionNext}
                    disabled={!canQuestionNext}
                    className={`${pillClassName} bg-[#232229] text-white disabled:opacity-40`}
                    data-testid='onboarding-greeting-next'
                    data-track-category='OnboardingPrototype'
                    data-track-name='GreetingNext'
                    data-greeting-submit-value={submittedValue}
                  >
                    Next
                  </motion.button>
                </motion.div>
              </div>
            )}

            {beat.kind === 'connectors' && (
              <div className='flex w-full flex-col items-start gap-12'>
                <div className='flex w-full flex-col gap-3'>
                  <GreetingHeroTitle
                    as='h1'
                    text={beat.title}
                    className={questionTitleClassName}
                    reduceMotion={reduceMotion}
                  />
                  <motion.p
                    className='text-[16px] font-[450] leading-[1.5] tracking-[-0.64px] text-[rgba(35,34,41,0.55)]'
                    initial={reduceMotion ? chromeShown : chromeHidden}
                    animate={chromeShown}
                    transition={{
                      duration: reduceMotion ? 0 : GREETING_CHROME_DURATION,
                      delay: reduceMotion ? 0 : GREETING_CHROME_DELAY,
                      ease: GREETING_HERO_EASE,
                    }}
                  >
                    {beat.subtitle}
                  </motion.p>
                </div>
                <motion.ul
                  className='flex w-full flex-col items-start gap-6'
                  initial='hidden'
                  animate='show'
                  variants={chromeGroupVariants}
                >
                  {PROTOTYPE_CONNECTORS.map(connector => {
                    const checked = checkedKeys.includes(connector.key);
                    return (
                      <motion.li
                        key={connector.key}
                        variants={chromeItemVariants}
                        className='w-full'
                      >
                        <button
                          type='button'
                          onClick={() => handleConnectClick(connector.key)}
                          className={`${optionRowBaseClassName} gap-3 ${
                            checked ? selectedRowClassName : idleRowClassName
                          }`}
                          data-testid={
                            checked
                              ? `onboarding-greeting-connected-${connector.key}`
                              : `onboarding-greeting-connect-${connector.key}`
                          }
                          data-track-category='OnboardingPrototype'
                          data-track-name='GreetingConnect'
                        >
                          <OnboardingConnectLogo
                            connectorKey={connector.key}
                            className='h-7 w-7 shrink-0'
                          />
                          <span
                            className={`flex-1 text-left ${optionLabelClassName}`}
                            style={{ fontVariationSettings: '"GRAD" 0, "ROND" 0, "wdth" 100' }}
                          >
                            {connector.label}
                          </span>
                          {checked ? (
                            <CheckTick />
                          ) : (
                            <span className='text-[15px] font-[450] text-[rgba(35,34,41,0.4)]'>
                              Connect
                            </span>
                          )}
                        </button>
                      </motion.li>
                    );
                  })}
                </motion.ul>
                <motion.div
                  className='flex w-full justify-end'
                  initial='hidden'
                  animate='show'
                  variants={chromeGroupVariants}
                >
                  {tap4FooterAction(checkedKeys.length) === 'skip' ? (
                    <motion.button
                      type='button'
                      variants={chromeItemVariants}
                      onClick={handleConnectFooter}
                      className={`${pillClassName} text-[#232229]`}
                      data-testid='onboarding-greeting-connectors-skip'
                      data-track-category='OnboardingPrototype'
                      data-track-name='GreetingSkip'
                    >
                      Skip
                    </motion.button>
                  ) : (
                    <motion.button
                      type='button'
                      variants={chromeItemVariants}
                      onClick={handleConnectFooter}
                      className={`${pillClassName} bg-[#232229] text-white`}
                      data-testid='onboarding-greeting-connectors-continue'
                      data-track-category='OnboardingPrototype'
                      data-track-name='GreetingContinue'
                    >
                      Continue
                    </motion.button>
                  )}
                </motion.div>
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
