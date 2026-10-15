export function withAlpha(
  color: string | null | undefined,
  alpha: number,
  fallback = 'transparent',
) {
  const value = color?.trim();

  if (!value) return fallback;

  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];

  if (!hex) return value;

  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
