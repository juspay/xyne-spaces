/**
 * Xyne Dark Foundation Tokens
 *
 * Dark-mode variant of the foundation tokens. The gray scale is inverted
 * so that blend component-token generators (which only read foundation
 * tokens and ignore the theme parameter) produce dark backgrounds and
 * light text automatically.
 *
 * Non-gray colors, typography, spacing, borders, and opacity are
 * identical to the light tokens.
 */

// Design tokens intentionally use non-camelCase naming (e.g., '2xl', numeric keys)
/* eslint-disable @typescript-eslint/naming-convention */
const DARK_FOUNDATION_TOKENS = {
  // Color System — gray scale inverted for dark mode
  colors: {
    gray: {
      0: '#0E121B',
      25: '#131722',
      50: '#181B25',
      100: '#222530',
      150: '#2B303B',
      200: '#363B48',
      300: '#525866',
      400: '#717784',
      500: '#99A0AE',
      600: '#CACFD8',
      700: '#E1E4EA',
      800: '#F2F4F8',
      900: '#F5F7FA',
      950: '#FCFCFD',
      1000: '#FFFFFF',
    },

    // Accent colors stay the same — they work on both light and dark
    primary: {
      50: '#162456',
      100: '#1C398E',
      200: '#193CB8',
      300: '#1447E6',
      400: '#2B7FFF',
      500: '#51A2FF',
      600: '#8EC5FF',
      700: '#BEDBFF',
      800: '#DBEAFE',
      900: '#EFF6FF',
      950: '#F5F9FF',
    },

    purple: {
      50: '#3C0366',
      100: '#59168B',
      200: '#6E11B0',
      300: '#8200DB',
      400: '#AD46FF',
      500: '#C27AFF',
      600: '#DAB2FF',
      700: '#E9D4FF',
      800: '#F3E8FF',
      900: '#FAF5FF',
      950: '#FDF8FF',
    },

    orange: {
      50: '#441306',
      100: '#7E2A0C',
      200: '#9F2D00',
      300: '#CA3500',
      400: '#FF6900',
      500: '#FF8904',
      600: '#FFB86A',
      700: '#FFD6A8',
      800: '#FFEDD4',
      900: '#FFF7ED',
      950: '#FFFBF5',
    },

    red: {
      50: '#460809',
      100: '#82181A',
      200: '#9F0712',
      300: '#C10007',
      400: '#FB2C36',
      500: '#FF6467',
      600: '#FFA2A2',
      700: '#FFC9C9',
      800: '#FFE2E2',
      900: '#FEF2F2',
      950: '#FFF5F5',
    },

    green: {
      50: '#052E16',
      100: '#0D542B',
      200: '#016630',
      300: '#008236',
      400: '#00C951',
      500: '#00D492',
      600: '#7BF1A8',
      700: '#B9F8CF',
      800: '#DCFCE7',
      900: '#F0FDF4',
      950: '#F5FFF8',
    },

    yellow: {
      50: '#432004',
      100: '#733E0A',
      200: '#894B00',
      300: '#A65F00',
      400: '#EFB100',
      500: '#FCC800',
      600: '#FFDF20',
      700: '#FFF085',
      800: '#FEF9C2',
      900: '#FEFCE8',
      950: '#FFFEF0',
    },
  },

  // Typography — same as light
  font: {
    family: {
      display: '"Google Sans Flex", sans-serif',
      body: '"Google Sans Flex", sans-serif',
      heading: '"Google Sans Flex", sans-serif',
      mono: 'SF Mono, monospace',
    },

    weight: {
      100: 100,
      200: 200,
      300: 300,
      400: 400,
      500: 500,
      600: 600,
      700: 700,
      800: 800,
      900: 900,
    },

    letterSpacing: {
      compressed: -2,
      condensed: -1,
      normal: 0,
      expanded: 1,
      extended: 2,
    },

    size: {
      base: 16,
      body: {
        xs: { fontSize: 10, lineHeight: 14, letterSpacing: 0 },
        sm: { fontSize: 12, lineHeight: 18, letterSpacing: 0 },
        md: { fontSize: 14, lineHeight: 20, letterSpacing: 0 },
        lg: { fontSize: 16, lineHeight: 24, letterSpacing: 0 },
      },
      heading: {
        sm: { fontSize: 18, lineHeight: 24, letterSpacing: 0 },
        md: { fontSize: 20, lineHeight: 28, letterSpacing: 0 },
        lg: { fontSize: 24, lineHeight: 32, letterSpacing: 0 },
        xl: { fontSize: 32, lineHeight: 38, letterSpacing: 0 },
        '2xl': { fontSize: 40, lineHeight: 46, letterSpacing: 0 },
      },
      display: {
        sm: { fontSize: 48, lineHeight: 56, letterSpacing: 0 },
        md: { fontSize: 56, lineHeight: 64, letterSpacing: 0 },
        lg: { fontSize: 64, lineHeight: 70, letterSpacing: 0 },
        xl: { fontSize: 72, lineHeight: 78, letterSpacing: 0 },
      },
      code: {
        sm: { fontSize: 10, lineHeight: 14, letterSpacing: 0 },
        md: { fontSize: 12, lineHeight: 18, letterSpacing: 0 },
        lg: { fontSize: 14, lineHeight: 18, letterSpacing: 0 },
      },
    },
  },

  // Spacing — same as light
  unit: {
    0: '0px',
    0.5: '0.5px',
    1: '1px',
    1.5: '1.5px',
    2: '2px',
    3: '3px',
    4: '4px',
    5: '5px',
    6: '6px',
    7: '7px',
    8: '8px',
    9: '9px',
    10: '10px',
    11: '11px',
    12: '12px',
    13: '13px',
    14: '14px',
    15: '15px',
    16: '16px',
    18: '18px',
    20: '20px',
    22: '22px',
    24: '24px',
    28: '28px',
    32: '32px',
    36: '36px',
    40: '40px',
    42: '42px',
    44: '44px',
    48: '48px',
    50: '50px',
    52: '52px',
    56: '56px',
    64: '64px',
    80: '80px',
    120: '120px',
    144: '144px',
    190: '190px',
    200: '200px',
    350: '350px',
    auto: 'auto',
  },

  // Borders — same as light
  border: {
    width: {
      0: '0px',
      1: '1px',
      1.5: '1.5px',
      2: '2px',
      3: '3px',
      4: '4px',
    },
    radius: {
      0: '0px',
      2: '2px',
      4: '4px',
      6: '6px',
      8: '8px',
      10: '10px',
      12: '12px',
      16: '16px',
      20: '20px',
      24: '24px',
      28: '28px',
      full: '9999px',
    },
  },

  // Shadows — adjusted for dark backgrounds
  shadows: {
    xs: '0px 1px 1px 0px rgba(0, 0, 0, 0.20)',
    sm: '0px 2px 3px 0px rgba(0, 0, 0, 0.25)',
    md: '0px 2px 8px 1px rgba(0, 0, 0, 0.30)',
    lg: '0px 3px 16px 3px rgba(0, 0, 0, 0.30)',
    xl: '0px 10px 20px 3px rgba(0, 0, 0, 0.30)',
    '2xl': '0px 12px 24px 4px rgba(0, 0, 0, 0.30)',
    full: '0px 24px 48px 8px rgba(0, 0, 0, 0.30)',
    focusPrimary: '0px 0px 0px 3px #162456',
    focusError: '0px 0px 0px 3px #460809',
  },

  // Opacity — same as light
  opacity: {
    0: 0,
    5: 0.05,
    10: 0.1,
    20: 0.2,
    30: 0.3,
    40: 0.4,
    50: 0.5,
    60: 0.6,
    70: 0.7,
    80: 0.8,
    90: 0.9,
    100: 1,
  },
};
/* eslint-enable @typescript-eslint/naming-convention */

export const XYNE_DARK_FOUNDATION_TOKENS = DARK_FOUNDATION_TOKENS;
export default XYNE_DARK_FOUNDATION_TOKENS;
