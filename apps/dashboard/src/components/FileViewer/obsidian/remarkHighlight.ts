/* Obsidian highlight: `==text==` → <mark>. Inert, no attributes beyond class. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { replaceInText } from './mdastText';

export default function remarkHighlight() {
  return (tree: any): void => {
    replaceInText(tree, /==([^=\n]+)==/, (m) => ({
      type: 'obsidianInline',
      data: { hName: 'mark', hProperties: { className: ['obsidian-highlight'] } },
      children: [{ type: 'text', value: m[1] }],
    }));
  };
}
