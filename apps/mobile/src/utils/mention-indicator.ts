const SELF_MENTION_INDICATOR = '\uFFF0';

const ensureSelfMentionIndicator = (indicators: string[]): string[] => {
  return indicators.includes(SELF_MENTION_INDICATOR)
    ? indicators
    : [...indicators, SELF_MENTION_INDICATOR];
};

export { SELF_MENTION_INDICATOR, ensureSelfMentionIndicator };
