/**
 * Pictures that are only a drawing of the person's initials (ui-avatars and
 * the like). iOS draws their SVG text off-centre and clipped, since it ignores
 * the baseline attributes the text is centred with, and they say nothing our
 * own initials do not, so the face draws its own initials instead.
 */
const GENERATED_INITIALS_HOSTS = ['ui-avatars.com'];

export function isGeneratedInitialsPicture(uri: string | null | undefined): boolean {
  if (!uri) return false;
  const host = /^https?:\/\/([^/?#]+)/i.exec(uri)?.[1]?.toLowerCase() ?? '';
  return GENERATED_INITIALS_HOSTS.some(known => host === known || host.endsWith(`.${known}`));
}
