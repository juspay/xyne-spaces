import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
  type EdgeInsets,
} from 'react-native-safe-area-context';

/** Real device insets, for `<Modal>` content that must ignore the call bar's inset override. */
export const RawSafeAreaInsetsContext = createContext<EdgeInsets | null>(null);

export function useRawSafeAreaInsets(): EdgeInsets {
  const libraryInsets = useSafeAreaInsets();
  return useContext(RawSafeAreaInsetsContext) ?? libraryInsets;
}

/**
 * `useSafeAreaInsets()` is pushed below the call bar; use it by default. Use the raw hook only
 * for full-screen routes that hide the bar or overlays that cover it.
 */
export function SafeAreaInsetsProvider({
  raw,
  content,
  children,
}: {
  raw: EdgeInsets;
  content: EdgeInsets;
  children: ReactNode;
}): ReactElement {
  return (
    <RawSafeAreaInsetsContext.Provider value={raw}>
      <SafeAreaInsetsContext.Provider value={content}>{children}</SafeAreaInsetsContext.Provider>
    </RawSafeAreaInsetsContext.Provider>
  );
}
