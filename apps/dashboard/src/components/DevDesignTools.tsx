import { ReactElement } from 'react';
import { DialRoot } from 'dialkit';
import 'dialkit/styles.css';
import { Mesurer } from 'mesurer';

/** Design-tuning overlays (DialKit panels, Mesurer ruler). Loaded in dev builds only. */
export default function DevDesignTools(): ReactElement {
  return (
    <>
      <DialRoot />
      <Mesurer />
    </>
  );
}
