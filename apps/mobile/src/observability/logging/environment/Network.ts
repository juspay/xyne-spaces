export type NetworkSnapshot = Readonly<{
  type: string | null;
  isInternetReachable: boolean | null;
}>;

export interface NetworkSubscription {
  remove(): void;
}

export interface Network {
  read(): Promise<NetworkSnapshot>;
  subscribe(listener: (snapshot: NetworkSnapshot) => void): NetworkSubscription;
}
