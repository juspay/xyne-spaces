/**
 * Charts Component Tokens
 */

import { XYNE_FOUNDATION_TOKENS } from '../XYNE_FOUNDATION_TOKENS';
import { XYNE_DARK_FOUNDATION_TOKENS } from '../XYNE_DARK_FOUNDATION_TOKENS';

// Light theme Charts tokens
export const Charts = {
  sm: {
    border: `${XYNE_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_FOUNDATION_TOKENS.colors.gray[200]}`,
    borderRadius: XYNE_FOUNDATION_TOKENS.border.radius[0],
    shadow: 'none',
    header: {
      padding: {
        x: XYNE_FOUNDATION_TOKENS.unit[16],
        y: XYNE_FOUNDATION_TOKENS.unit[8],
      },
      backgroundColor: XYNE_FOUNDATION_TOKENS.colors.gray[25],
      borderBottom: `${XYNE_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_FOUNDATION_TOKENS.colors.gray[200]}`,
      borderRadius: XYNE_FOUNDATION_TOKENS.border.radius[0],
      slots: {
        gap: XYNE_FOUNDATION_TOKENS.unit[12],
      },
    },
    content: {
      legend: {
        gap: XYNE_FOUNDATION_TOKENS.unit[16],
        item: {
          gap: XYNE_FOUNDATION_TOKENS.unit[8],
          color: {
            default: XYNE_FOUNDATION_TOKENS.colors.gray[600],
            hover: XYNE_FOUNDATION_TOKENS.colors.gray[700],
            active: XYNE_FOUNDATION_TOKENS.colors.gray[800],
          },
          fontSize: 12,
          fontWeight: 500,
        },
      },
      backgroundColor: XYNE_FOUNDATION_TOKENS.colors.gray[0],
      padding: {
        top: XYNE_FOUNDATION_TOKENS.unit[0],
        right: XYNE_FOUNDATION_TOKENS.unit[12],
        bottom: XYNE_FOUNDATION_TOKENS.unit[8],
        left: XYNE_FOUNDATION_TOKENS.unit[12],
      },
      gap: XYNE_FOUNDATION_TOKENS.unit[16],
    },
  },
  lg: {
    border: `${XYNE_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_FOUNDATION_TOKENS.colors.gray[200]}`,
    borderRadius: XYNE_FOUNDATION_TOKENS.border.radius[0],
    shadow: 'none',
    header: {
      padding: {
        x: XYNE_FOUNDATION_TOKENS.unit[16],
        y: XYNE_FOUNDATION_TOKENS.unit[8],
      },
      backgroundColor: XYNE_FOUNDATION_TOKENS.colors.gray[25],
      borderBottom: `${XYNE_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_FOUNDATION_TOKENS.colors.gray[200]}`,
      borderRadius: XYNE_FOUNDATION_TOKENS.border.radius[0],
      slots: {
        gap: XYNE_FOUNDATION_TOKENS.unit[12],
      },
    },
    content: {
      legend: {
        gap: XYNE_FOUNDATION_TOKENS.unit[16],
        item: {
          gap: XYNE_FOUNDATION_TOKENS.unit[8],
          color: {
            default: XYNE_FOUNDATION_TOKENS.colors.gray[600],
            hover: XYNE_FOUNDATION_TOKENS.colors.gray[700],
            active: XYNE_FOUNDATION_TOKENS.colors.gray[800],
          },
          fontSize: 12,
          fontWeight: 500,
        },
      },
      backgroundColor: XYNE_FOUNDATION_TOKENS.colors.gray[0],
      padding: {
        top: XYNE_FOUNDATION_TOKENS.unit[20],
        right: XYNE_FOUNDATION_TOKENS.unit[16],
        bottom: XYNE_FOUNDATION_TOKENS.unit[16],
        left: XYNE_FOUNDATION_TOKENS.unit[16],
      },
      gap: XYNE_FOUNDATION_TOKENS.unit[16],
    },
  },
};

// Dark theme Charts tokens
export const ChartsDark = {
  sm: {
    border: `${XYNE_DARK_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_DARK_FOUNDATION_TOKENS.colors.gray[200]}`,
    borderRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[0],
    shadow: 'none',
    header: {
      padding: {
        x: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
        y: XYNE_DARK_FOUNDATION_TOKENS.unit[8],
      },
      backgroundColor: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[25],
      borderBottom: `${XYNE_DARK_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_DARK_FOUNDATION_TOKENS.colors.gray[200]}`,
      borderRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[0],
      slots: {
        gap: XYNE_DARK_FOUNDATION_TOKENS.unit[12],
      },
    },
    content: {
      legend: {
        gap: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
        item: {
          gap: XYNE_DARK_FOUNDATION_TOKENS.unit[8],
          color: {
            default: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[600],
            hover: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[700],
            active: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[800],
          },
          fontSize: 12,
          fontWeight: 500,
        },
      },
      backgroundColor: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
      padding: {
        top: XYNE_DARK_FOUNDATION_TOKENS.unit[0],
        right: XYNE_DARK_FOUNDATION_TOKENS.unit[12],
        bottom: XYNE_DARK_FOUNDATION_TOKENS.unit[8],
        left: XYNE_DARK_FOUNDATION_TOKENS.unit[12],
      },
      gap: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
    },
  },
  lg: {
    border: `${XYNE_DARK_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_DARK_FOUNDATION_TOKENS.colors.gray[200]}`,
    borderRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[0],
    shadow: 'none',
    header: {
      padding: {
        x: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
        y: XYNE_DARK_FOUNDATION_TOKENS.unit[8],
      },
      backgroundColor: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[25],
      borderBottom: `${XYNE_DARK_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_DARK_FOUNDATION_TOKENS.colors.gray[200]}`,
      borderRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[0],
      slots: {
        gap: XYNE_DARK_FOUNDATION_TOKENS.unit[12],
      },
    },
    content: {
      legend: {
        gap: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
        item: {
          gap: XYNE_DARK_FOUNDATION_TOKENS.unit[8],
          color: {
            default: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[600],
            hover: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[700],
            active: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[800],
          },
          fontSize: 12,
          fontWeight: 500,
        },
      },
      backgroundColor: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
      padding: {
        top: XYNE_DARK_FOUNDATION_TOKENS.unit[20],
        right: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
        bottom: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
        left: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
      },
      gap: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
    },
  },
};
