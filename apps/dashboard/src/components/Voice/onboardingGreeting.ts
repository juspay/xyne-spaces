// "vinit.khandal" -> "Vinit"; '' when there is no usable name.
function firstName(name: string | undefined): string {
  const word = name?.split(/[\s._@-]+/).find(Boolean) ?? '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The spoken welcome for a user who just finished onboarding. Its examples are ones every role
 * can do, so it never offers an action (like inviting people) the user may not have.
 */
export function onboardingGreeting(name: string | undefined): string {
  const who = firstName(name);
  return (
    `Hi${who ? ` ${who}` : ''}, welcome to Xyne! I can help you get set up, like creating a channel ` +
    'or building an agent. Hold the orb or press Space and tell me what you would like to do.'
  );
}

// Whether the greeting was already spoken for this open of the panel; outlives the sidebar remounting.
let greeted = false;

/** True once per open: when `open` turns on, until it turns off again. */
export function shouldGreet(open: boolean): boolean {
  const first = open && !greeted;
  greeted = open;
  return first;
}
