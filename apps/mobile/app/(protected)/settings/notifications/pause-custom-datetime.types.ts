export type PauseCustomDateTimeValueProps = {
  value: Date;
  onChange: (next: Date) => void;
};

export type PauseCustomDateTimeAndroidProps = PauseCustomDateTimeValueProps & {
  labelColor: string;
  descriptionColor: string;
  dividerColor: string;
  onPressDate: () => void;
  onPressTime: () => void;
};
