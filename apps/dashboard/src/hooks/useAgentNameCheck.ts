import { useEffect, useRef, useState } from 'react';
import { checkAgentName } from '../services/claw/clawAgentWizardService';

export interface AgentNameCheck {
  checking: boolean;
  nameError: string | null;
  slugError: string | null;
  nameValid: boolean;
}

const IDLE: AgentNameCheck = {
  checking: false,
  nameError: null,
  slugError: null,
  nameValid: false,
};

/**
 * Debounced (500ms) name+slug availability check for the Identity step.
 * Mirrors the reference wizard's behavior:
 *  - `checking` flips true immediately on input so Next stays gated while we wait,
 *  - a monotonic request id drops out-of-order responses (fast typing),
 *  - the check fails open (nameValid=true) on API error so an outage can't block create.
 */
export function useAgentNameCheck(name: string, slug: string): AgentNameCheck {
  const [state, setState] = useState<AgentNameCheck>(IDLE);
  const reqId = useRef(0);

  useEffect(() => {
    const trimmed = name.trim();
    if (!trimmed || !slug) {
      reqId.current += 1; // invalidate any in-flight response
      setState(IDLE);
      return;
    }
    // Gate Next right away, before the debounce even fires.
    setState({ checking: true, nameError: null, slugError: null, nameValid: false });
    const id = (reqId.current += 1);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const r = await checkAgentName(trimmed, slug);
          if (id !== reqId.current) return; // superseded
          setState({
            checking: false,
            nameError: r.nameAvailable ? null : 'Agent name already taken',
            slugError: r.slugAvailable ? null : 'Handle already taken',
            nameValid: r.nameAvailable && r.slugAvailable,
          });
        } catch {
          if (id !== reqId.current) return;
          setState({ checking: false, nameError: null, slugError: null, nameValid: true });
        }
      })();
    }, 500);
    return () => clearTimeout(timer);
  }, [name, slug]);

  return state;
}
