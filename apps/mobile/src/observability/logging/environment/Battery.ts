export type LogBatteryState = 'unknown' | 'unplugged' | 'charging' | 'full' | 'not_charging';

export type BatterySnapshot = Readonly<{
  level: number | null;
  state: LogBatteryState;
  lowPowerMode: boolean;
}>;

export type BatteryReading = Readonly<{
  level?: number | null;
  state?: LogBatteryState;
  lowPowerMode?: boolean;
}>;

export interface BatterySubscription {
  remove(): void;
}

export interface Battery {
  read(): Promise<BatterySnapshot>;
  subscribe(listener: (reading: BatteryReading) => void): BatterySubscription;
}
