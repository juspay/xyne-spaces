export type LotusCacContext = Record<string, string>;

export type ResolvedLotusConfig = Record<string, unknown>;

export type LotusCacFetchResult = {
  key: string;
  config: unknown;
};

export type LotusCacFetchAllResult = {
  configs: ResolvedLotusConfig;
};
