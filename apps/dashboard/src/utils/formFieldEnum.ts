const safeParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export const parseFieldEnumOptions = (value: unknown): string[] | undefined => {
  const parsedValue = typeof value === 'string' ? safeParseJson(value) : value;
  if (!Array.isArray(parsedValue)) return undefined;

  const options = parsedValue.filter((item): item is string => typeof item === 'string');
  return options.length > 0 ? options : undefined;
};
