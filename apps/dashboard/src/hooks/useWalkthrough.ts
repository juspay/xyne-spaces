import { useCallback, useEffect } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { walkthroughConfig, WalkthroughFeature } from '../config/walkthroughConfig';

declare global {
  interface Window {
    walkthroughDriver?: ReturnType<typeof driver>;
  }
}

interface UseWalkthroughOptions {
  feature: WalkthroughFeature;
  autoPlay?: boolean;
}

export const useWalkthrough = ({
  feature,
  autoPlay = true,
}: UseWalkthroughOptions): { startWalkthrough: (forceReplay?: boolean) => void } => {
  const startWalkthrough = useCallback(
    (forceReplay = false): void => {
      console.log(
        `[Walkthrough] Attempting to start feature: ${feature}, forceReplay: ${forceReplay}`,
      );

      const hasSeen = localStorage.getItem(`walkthrough_${feature}`);
      if (!forceReplay && hasSeen === 'true') {
        console.log(`[Walkthrough] Skipped because it was already seen. localStorage check: true`);
        return;
      }

      const steps = walkthroughConfig[feature];
      if (!steps || steps.length === 0) {
        console.log(`[Walkthrough] No steps configured for feature: ${feature}`);
        return;
      }

      console.log(`[Walkthrough] Initializing driver.js with ${steps.length} steps.`);

      const driverObj = driver({
        showProgress: true,
        animate: true,
        steps: steps,
        onDestroyStarted: () => {
          if (
            !driverObj.hasNextStep() ||
            confirm('Are you sure you want to skip the walkthrough?')
          ) {
            console.log(`[Walkthrough] Marking as seen in localStorage.`);
            localStorage.setItem(`walkthrough_${feature}`, 'true');
            driverObj.destroy();
          }
        },
      });

      // Share driver instance globally so we can intercept and auto-advance in config if needed
      window.walkthroughDriver = driverObj;

      driverObj.drive();
    },
    [feature],
  );

  useEffect(() => {
    if (autoPlay) {
      console.log(`[Walkthrough] autoPlay is true for ${feature}, setting up trigger...`);
      // Use requestAnimationFrame or longer timeout to ensure paint
      const timeout = setTimeout((): void => {
        const firstStepElem = walkthroughConfig[feature]?.[1]?.element;
        // Check if element exists before starting, if a dom selector is provided in the second step (1st step is generic popover)
        if (
          firstStepElem &&
          typeof firstStepElem === 'string' &&
          !document.querySelector(firstStepElem)
        ) {
          console.log(
            `[Walkthrough] Element ${firstStepElem} not found in DOM yet. Trying anyway but Driver.js might fail.`,
          );
        }
        startWalkthrough(false);
      }, 1000); // Increased wait time to 1 second
      return (): void => clearTimeout(timeout);
    } else {
      console.log(`[Walkthrough] autoPlay is false for ${feature}.`);
    }
    return undefined;
  }, [autoPlay, startWalkthrough, feature]);

  return { startWalkthrough };
};
