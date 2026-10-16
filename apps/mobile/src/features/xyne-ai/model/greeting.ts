const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export function firstName(name: string | undefined, email: string | undefined): string | undefined {
  const first = name?.trim().split(/\s+/)[0] || email?.split('@')[0]?.split(/[._-]+/)[0];
  return first ? capitalize(first) : undefined;
}

export function greeting(now: Date, name: string | undefined): string {
  const hour = now.getHours();
  const salutation =
    hour < 5
      ? 'Working late'
      : hour < 12
        ? 'Good morning'
        : hour < 17
          ? 'Good afternoon'
          : 'Good evening';
  return name ? `${salutation}, ${name}` : salutation;
}
