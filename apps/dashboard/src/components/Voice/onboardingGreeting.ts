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
    'or building an agent. Hold the orb or press Space and tell me what you would like to do, ' +
    'or ask me what I can do.'
  );
}
