import modernDesignMd from './open-design/modern.DESIGN.md?raw';
import modernTokensCss from './open-design/modern.tokens.css.txt?raw';
import monoDesignMd from './open-design/mono.DESIGN.md?raw';
import monoTokensCss from './open-design/mono.tokens.css.txt?raw';
import vibrantDesignMd from './open-design/vibrant.DESIGN.md?raw';
import vibrantTokensCss from './open-design/vibrant.tokens.css.txt?raw';
import editorialDesignMd from './open-design/editorial.DESIGN.md?raw';
import editorialTokensCss from './open-design/editorial.tokens.css.txt?raw';

export interface StarterSystem {
  id: string;
  name: string;
  summary: string;
  designMd: string;
  tokensCss: string;
  upstream: string;
}

const UPSTREAM = 'https://github.com/nexu-io/open-design/tree/main/design-systems';

export const STARTER_ATTRIBUTION = {
  project: 'Open Design',
  url: 'https://github.com/nexu-io/open-design',
  licence: 'Apache-2.0',
} as const;

export const STARTER_SYSTEMS: readonly StarterSystem[] = [
  {
    id: 'modern',
    name: 'Modern SaaS',
    summary: 'Cool neutrals, a blue-violet accent and polished product cards.',
    designMd: modernDesignMd,
    tokensCss: modernTokensCss,
    upstream: `${UPSTREAM}/modern`,
  },
  {
    id: 'mono',
    name: 'Minimal Mono',
    summary: 'Monospaced type and a near-greyscale palette.',
    designMd: monoDesignMd,
    tokensCss: monoTokensCss,
    upstream: `${UPSTREAM}/mono`,
  },
  {
    id: 'vibrant',
    name: 'Vibrant Tech',
    summary: 'Saturated accents on deep surfaces, for product marketing.',
    designMd: vibrantDesignMd,
    tokensCss: vibrantTokensCss,
    upstream: `${UPSTREAM}/vibrant`,
  },
  {
    id: 'editorial',
    name: 'Classic Editorial',
    summary: 'Serif headings, generous measure and restrained colour.',
    designMd: editorialDesignMd,
    tokensCss: editorialTokensCss,
    upstream: `${UPSTREAM}/editorial`,
  },
];
