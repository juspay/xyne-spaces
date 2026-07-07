export const MENTION_RANKING_CAC_KEY = 'mention_ranking_config';

export interface MentionRankingCacConfig {
  weightChannelMember: number;
  weightEngagedInContext: number;
  weightAffinity: number;
  weightSpecialMention: number;
  weightGroupMatch: number;
  matchPrefix: number;
  matchSubstring: number;
  matchFuzzy: number;
  zeroStateCap: number;
  queryStateCap: number;
  recentInChannelWindowDays: number;
}

export const DEFAULT_MENTION_RANKING_CAC_CONFIG: MentionRankingCacConfig = {
  weightChannelMember: 0.25,
  weightEngagedInContext: 0.15,
  weightAffinity: 0.3,
  weightSpecialMention: 0.1,
  weightGroupMatch: 0.1,
  matchPrefix: 1.0,
  matchSubstring: 0.6,
  matchFuzzy: 0.3,
  zeroStateCap: 8,
  queryStateCap: 10,
  recentInChannelWindowDays: 30,
};
