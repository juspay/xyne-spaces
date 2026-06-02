/**
 * Deterministic avatar from a name string.
 *
 * `nameToHsl` hashes the name to produce a stable per-user color so the same
 * person always gets the same hue. `Avatar` renders a rounded badge with the
 * person's initials over that color, optionally overridden by an explicit `color`.
 */

export function nameToHsl(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${((hash % 360) + 360) % 360}, 55%, 48%)`;
}

function initialsFor(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

interface AvatarProps {
  name: string;
  /** Override background color. Falls back to a hash-derived hue. */
  color?: string;
  size?: number;
  /** "rounded-lg" for agents, "rounded-full" for people. */
  shape?: "square" | "circle";
  className?: string;
}

export function Avatar({ name, color, size = 32, shape = "circle", className }: AvatarProps) {
  const bg = color && color !== "#ffffff" && color !== "#FFFFFF" ? color : nameToHsl(name);
  const radius = shape === "square" ? "rounded-lg" : "rounded-full";
  return (
    <span
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.4 }}
      className={`flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white ${radius} ${className || ""}`}
    >
      {initialsFor(name)}
    </span>
  );
}
