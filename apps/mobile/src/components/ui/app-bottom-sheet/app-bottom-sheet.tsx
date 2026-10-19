import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useImperativeHandle,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
  Platform,
} from 'react-native';
import GorhomBottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  type BottomSheetProps,
} from '@gorhom/bottom-sheet';
import { useCSSVariable } from 'uniwind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptics } from '@/src/utils/haptics';
import { FullWindowOverlay } from '@/src/components/full-window-overlay';
import { DEFAULT_PORTAL_HOST, Portal, PortalHost } from '@/src/components/primitives/portal';
import { Easing } from 'react-native-reanimated';

/**
 * Sizing mode for the sheet.
 *
 * - 'fullscreen': fixed at 100% height (e.g. members/projects steps, instant call).
 * - 'dynamic':    content-driven height up to the safe screen area (e.g. actions, call details).
 * - 'snap':       explicit snap points (e.g. emoji picker at 52%). `snapPoints` is required.
 */
export type AppBottomSheetMode = 'fullscreen' | 'dynamic' | 'snap';

export type AppBottomSheetRef = {
  present: () => void;
  dismiss: () => void;
  close: () => void;
  snapToIndex: ComponentRef<typeof GorhomBottomSheet>['snapToIndex'];
  expand: ComponentRef<typeof GorhomBottomSheet>['expand'];
  collapse: ComponentRef<typeof GorhomBottomSheet>['collapse'];
};

type BaseAppBottomSheetProps = Omit<
  BottomSheetProps,
  | 'snapPoints'
  | 'index'
  | 'enableDynamicSizing'
  | 'maxDynamicContentSize'
  | 'enableOverDrag'
  | 'enablePanDownToClose'
  | 'keyboardBlurBehavior'
  | 'activeOffsetY'
  | 'backdropComponent'
  | 'backgroundStyle'
  | 'handleIndicatorStyle'
  | 'handleHeight'
  | 'topInset'
  | 'bottomInset'
  | 'onClose'
> & {
  /** Controlled open state. When omitted, the sheet manages its own index. */
  isOpen?: boolean;
  /** Initial open state for uncontrolled compatibility. Defaults to false. */
  defaultOpen?: boolean;
  /** Fired when the sheet opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Fired once the base sheet reaches the closed index. */
  onClose?: () => void;
  /** Compatibility alias for older BottomSheetModal call sites. */
  onDismiss?: () => void;
  /** Portal host used to layer the sheet above app chrome. Defaults to the root host. */
  portalHostName?: string;
  /** Disable iOS native FullWindowOverlay when debugging the element inspector. */
  disableFullWindowOverlay?: boolean;
  /** Keyboard behavior. Defaults to 'interactive'. */
  keyboardBehavior?: NonNullable<BottomSheetProps['keyboardBehavior']>;
  /** Backdrop opacity. Defaults to 0.5. */
  backdropOpacity?: number;
  /**
   * Pan distance (negative = up, positive = down) required before the sheet
   * starts dragging. Defaults to `[-20, 20]`.
   */
  activeOffsetY?: [number, number];
  /**
   * Swipe down to dismiss. Defaults to true. Set false for fullscreen
   * editors whose header Back should pop an inner screen, not the sheet.
   */
  enablePanDownToClose?: boolean;
  /** Render the drag handle indicator. Defaults to true. */
  showHandleIndicator?: boolean;
  /** Merge/override the default handle indicator style. */
  handleIndicatorStyle?: StyleProp<ViewStyle>;
  /** Merge/override the default sheet background style. */
  backgroundStyle?: StyleProp<ViewStyle>;
  /** Animation duration in milliseconds. Defaults to 320ms. */
  animationDuration?: number;
  /** Skip the first imperative snap when a controlled sheet mounts already open. */
  skipInitialImperativeSnap?: boolean;
  /**
   * Reconcile a native close emitted while this controlled sheet is opening.
   * Keep disabled for shared sheets; message-actions opts in for its direct-open mount.
   */
  allowNativeCloseWhileOpening?: boolean;
  children: ReactNode;
};

type DynamicModeProps = {
  /** Sizing mode. Defaults to 'dynamic'. */
  mode?: 'dynamic';
};

type FullscreenModeProps = {
  mode: 'fullscreen';
};

type SnapModeProps = {
  mode: 'snap';
  /** Snap points for the sheet (e.g. `['52%']`). Required for `mode: 'snap'`. */
  snapPoints: NonNullable<BottomSheetProps['snapPoints']>;
  /** Initial snap index. Defaults to 0. */
  index?: number;
};

export type AppBottomSheetProps = BaseAppBottomSheetProps &
  (DynamicModeProps | FullscreenModeProps | SnapModeProps);

const renderBackdrop = (opacity: number) =>
  function AppBottomSheetBackdrop(props: BottomSheetBackdropProps): React.ReactElement {
    return (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={opacity}
        pressBehavior='close'
      />
    );
  };

const DEFAULT_HANDLE_INDICATOR_STYLE: ViewStyle = {
  backgroundColor: '#CCC',
  width: 36,
  height: 5,
  borderRadius: 999,
};

const PORTAL_CONTAINER_STYLE: ViewStyle = {
  ...StyleSheet.absoluteFill,
  zIndex: 10000,
  elevation: 10000,
};
const NESTED_OVERLAY_STYLE: ViewStyle = {
  ...StyleSheet.absoluteFill,
  zIndex: 10001,
  elevation: 10001,
};
const INTERACTION_LAYER_CLOSE_FALLBACK_BUFFER_MS = 100;

/**
 * Host name for sheets opened from inside an AppBottomSheet (composer attach,
 * emoji picker, etc.). Those sheets must render in this overlay — a second
 * FullWindowOverlay stacks *behind* the parent sheet on iOS.
 */
export const SheetOverlayPortalContext = createContext<string | undefined>(undefined);

export const AppBottomSheet = forwardRef<AppBottomSheetRef, AppBottomSheetProps>(
  function AppBottomSheet(props, ref) {
    const {
      isOpen,
      defaultOpen = false,
      onOpenChange,
      onClose,
      onDismiss,
      portalHostName = DEFAULT_PORTAL_HOST,
      disableFullWindowOverlay = false,
      onChange,
      keyboardBehavior = 'interactive',
      backdropOpacity = 0.5,
      activeOffsetY = [-20, 20],
      enablePanDownToClose = true,
      showHandleIndicator = true,
      handleIndicatorStyle,
      backgroundStyle,
      animationDuration = 320,
      skipInitialImperativeSnap = false,
      allowNativeCloseWhileOpening = false,
      children,
      enableBlurKeyboardOnGesture = true,
      android_keyboardInputMode: androidKeyboardInputMode = 'adjustPan',
      ...restPropsWithAppSizing
    } = props;

    const {
      mode = 'dynamic',
      snapPoints,
      index: providedIndex,
      ...restProps
    } = restPropsWithAppSizing as typeof restPropsWithAppSizing & {
      mode?: AppBottomSheetMode;
      snapPoints?: BottomSheetProps['snapPoints'];
      index?: number;
    };

    const sheetRef = useRef<ComponentRef<typeof GorhomBottomSheet>>(null);
    const portalName = useId();
    const parentOverlayHostName = useContext(SheetOverlayPortalContext);
    const nestedOverlayHostName = `${portalName}_nested`;
    const resolvedPortalHostName = parentOverlayHostName ?? portalHostName;
    const isNestedOverlay = parentOverlayHostName !== undefined;
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const sheetBg = useCSSVariable('--color-bottomsheet-bg') as string;

    const initialIndex = mode === 'snap' ? (providedIndex ?? 0) : 0;
    const isControlled = isOpen !== undefined;
    const [uncontrolledIndex, setUncontrolledIndex] = useState(defaultOpen ? initialIndex : -1);
    const currentIndex = isControlled ? (isOpen ? initialIndex : -1) : uncontrolledIndex;
    const hasReportedClosedRef = useRef(currentIndex === -1);
    const isOpeningRef = useRef(currentIndex !== -1);
    const wasControlledOpenRef = useRef(isControlled && currentIndex !== -1);
    const didMountRef = useRef(false);
    const interactionLayerCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isInteractionLayerActive, setIsInteractionLayerActive] = useState(currentIndex !== -1);

    const backdropComponent = useMemo(() => renderBackdrop(backdropOpacity), [backdropOpacity]);

    const defaultBackgroundStyle: ViewStyle = useMemo(
      () => ({
        backgroundColor: sheetBg,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }),
      [sheetBg],
    );

    const mergedHandleIndicatorStyle = useMemo(() => {
      if (!showHandleIndicator) return { opacity: 0, height: 0 };
      if (!handleIndicatorStyle) return DEFAULT_HANDLE_INDICATOR_STYLE;
      return [DEFAULT_HANDLE_INDICATOR_STYLE, handleIndicatorStyle];
    }, [showHandleIndicator, handleIndicatorStyle]);

    const clearInteractionLayerCloseFallback = useCallback((): void => {
      if (interactionLayerCloseTimerRef.current === null) return;
      clearTimeout(interactionLayerCloseTimerRef.current);
      interactionLayerCloseTimerRef.current = null;
    }, []);

    const releaseInteractionLayer = useCallback((): void => {
      clearInteractionLayerCloseFallback();
      setIsInteractionLayerActive(false);
    }, [clearInteractionLayerCloseFallback]);

    const sizingProps =
      mode === 'snap'
        ? {
            snapPoints: snapPoints as NonNullable<BottomSheetProps['snapPoints']>,
            enableDynamicSizing: false,
          }
        : mode === 'fullscreen'
          ? {
              snapPoints: ['100%'],
              enableDynamicSizing: false,
            }
          : {
              enableDynamicSizing: true,
              maxDynamicContentSize: windowHeight - insets.top - insets.bottom,
            };

    // Both are already de-duplicated against repeat calls, so every sheet in the
    // app gets exactly one open and one close haptic from here.
    const markOpen = useCallback(() => {
      clearInteractionLayerCloseFallback();
      hasReportedClosedRef.current = false;
      setIsInteractionLayerActive(true);
      void haptics.gestureStart();
      onOpenChange?.(true);
    }, [clearInteractionLayerCloseFallback, onOpenChange]);

    const markClosed = useCallback(() => {
      releaseInteractionLayer();
      isOpeningRef.current = false;
      if (hasReportedClosedRef.current) return;
      hasReportedClosedRef.current = true;
      void haptics.gestureEnd();
      onOpenChange?.(false);
      onClose?.();
      onDismiss?.();
    }, [onClose, onDismiss, onOpenChange, releaseInteractionLayer]);

    const scheduleInteractionLayerCloseFallback = useCallback((): void => {
      clearInteractionLayerCloseFallback();
      interactionLayerCloseTimerRef.current = setTimeout(
        () => {
          interactionLayerCloseTimerRef.current = null;
          markClosed();
        },
        Math.max(0, animationDuration) + INTERACTION_LAYER_CLOSE_FALLBACK_BUFFER_MS,
      );
    }, [animationDuration, clearInteractionLayerCloseFallback, markClosed]);

    const open = useCallback(() => {
      clearInteractionLayerCloseFallback();
      hasReportedClosedRef.current = false;
      isOpeningRef.current = true;
      setIsInteractionLayerActive(true);
      if (!isControlled) {
        setUncontrolledIndex(initialIndex);
      }
      onOpenChange?.(true);
      sheetRef.current?.snapToIndex(initialIndex);
    }, [clearInteractionLayerCloseFallback, initialIndex, isControlled, onOpenChange]);

    const close = useCallback(() => {
      isOpeningRef.current = false;
      if (!isControlled) {
        setUncontrolledIndex(-1);
      }
      scheduleInteractionLayerCloseFallback();
      sheetRef.current?.close();
      onOpenChange?.(false);
    }, [isControlled, onOpenChange, scheduleInteractionLayerCloseFallback]);

    useLayoutEffect(
      () => (): void => {
        clearInteractionLayerCloseFallback();
      },
      [clearInteractionLayerCloseFallback],
    );

    // A controlled index change updates gorhom declaratively, but explicitly
    // close the native sheet as well. This gives the platform one authoritative
    // dismissal to finish before the portal stops intercepting touches; removing
    // the interaction layer first lets the release of the closing tap hit a
    // pressable underneath the sheet.
    useLayoutEffect(() => {
      if (!isControlled) return;

      const isFirstRender = !didMountRef.current;
      didMountRef.current = true;

      if (isOpen) {
        clearInteractionLayerCloseFallback();
        wasControlledOpenRef.current = true;
        hasReportedClosedRef.current = false;
        isOpeningRef.current = true;
        setIsInteractionLayerActive(true);
        // Gorhom treats its `index` prop as an initial value in some mounted
        // states. Re-apply the controlled index so changing a sheet view from
        // one immutable snap point to another always reaches that point.
        if (!(skipInitialImperativeSnap && isFirstRender)) {
          sheetRef.current?.snapToIndex(initialIndex);
        }
        return;
      }

      isOpeningRef.current = false;
      if (wasControlledOpenRef.current && !hasReportedClosedRef.current) {
        wasControlledOpenRef.current = false;
        // Keep the portal touch-owning until native onChange(-1) confirms the
        // close. The fallback prevents a missed native callback from leaving
        // the sheet interaction layer active forever.
        scheduleInteractionLayerCloseFallback();
        sheetRef.current?.close();
        return;
      }
      releaseInteractionLayer();
    }, [
      clearInteractionLayerCloseFallback,
      initialIndex,
      isControlled,
      isOpen,
      releaseInteractionLayer,
      scheduleInteractionLayerCloseFallback,
      skipInitialImperativeSnap,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        present: open,
        dismiss: close,
        close,
        snapToIndex: (...args): void => {
          if (!isControlled) {
            setUncontrolledIndex(args[0]);
          }
          sheetRef.current?.snapToIndex(...args);
        },
        expand: (...args): void => {
          if (!isControlled) {
            setUncontrolledIndex(initialIndex);
          }
          sheetRef.current?.expand(...args);
        },
        collapse: (...args): void => {
          if (!isControlled) {
            setUncontrolledIndex(0);
          }
          sheetRef.current?.collapse(...args);
        },
      }),
      [close, initialIndex, isControlled, open],
    );

    const handleChange: NonNullable<BottomSheetProps['onChange']> = useCallback(
      (index, position, type) => {
        if (!isControlled) {
          setUncontrolledIndex(index);
        }
        onChange?.(index, position, type);
        if (index === -1) {
          if (isControlled && isOpeningRef.current && !allowNativeCloseWhileOpening) {
            scheduleInteractionLayerCloseFallback();
            return;
          }
          markClosed();
        } else {
          isOpeningRef.current = false;
          markOpen();
        }
      },
      [
        allowNativeCloseWhileOpening,
        isControlled,
        markClosed,
        markOpen,
        onChange,
        scheduleInteractionLayerCloseFallback,
      ],
    );

    const sheet = (
      <GorhomBottomSheet
        key={insets.top}
        ref={sheetRef}
        index={currentIndex}
        {...restProps}
        {...sizingProps}
        enableOverDrag={false}
        enablePanDownToClose={enablePanDownToClose}
        backdropComponent={backdropComponent}
        keyboardBehavior={keyboardBehavior}
        keyboardBlurBehavior='restore'
        enableBlurKeyboardOnGesture={enableBlurKeyboardOnGesture}
        android_keyboardInputMode={androidKeyboardInputMode}
        activeOffsetY={activeOffsetY}
        backgroundStyle={
          backgroundStyle ? [defaultBackgroundStyle, backgroundStyle] : defaultBackgroundStyle
        }
        bottomInset={Platform.OS !== 'ios' ? insets.bottom : 0}
        topInset={insets.top}
        handleIndicatorStyle={mergedHandleIndicatorStyle}
        onChange={handleChange}
        animationConfigs={{
          duration: animationDuration,
          easing: Easing.out(Easing.cubic),
        }}
      >
        {children}
      </GorhomBottomSheet>
    );

    return (
      <Portal hostName={resolvedPortalHostName} name={`${portalName}_app_bottom_sheet`}>
        <FullWindowOverlay disableFullWindowOverlay={disableFullWindowOverlay || isNestedOverlay}>
          <SheetOverlayPortalContext.Provider value={nestedOverlayHostName}>
            <View
              pointerEvents={isInteractionLayerActive ? 'auto' : 'none'}
              style={PORTAL_CONTAINER_STYLE}
              className='flex-1 h-full'
            >
              {sheet}
              <View pointerEvents='box-none' style={NESTED_OVERLAY_STYLE}>
                <PortalHost name={nestedOverlayHostName} />
              </View>
            </View>
          </SheetOverlayPortalContext.Provider>
        </FullWindowOverlay>
      </Portal>
    );
  },
);
