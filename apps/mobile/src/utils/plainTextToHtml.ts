const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export const plainTextToHtml = (text: string): string =>
  text
    .split('\n')
    // react-native-enriched collapses an empty <p></p> into the surrounding
    // paragraph break on Android. A <br> gives the empty paragraph one native
    // line break, preserving a plain-text "\n\n" round trip.
    .map(line => (line.length === 0 ? '<p><br></p>' : `<p>${escapeHtml(line)}</p>`))
    .join('');
