/**
 * StatCard Component Tokens
 */

import { XYNE_FOUNDATION_TOKENS } from '../XYNE_FOUNDATION_TOKENS';
import { XYNE_DARK_FOUNDATION_TOKENS } from '../XYNE_DARK_FOUNDATION_TOKENS';

// Light theme StatCard tokens
export const StatCard = {
  sm: {
    maxWidth: XYNE_FOUNDATION_TOKENS.unit[200],
    height: 'auto',
    border: `${XYNE_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_FOUNDATION_TOKENS.colors.gray[200]}`,
    borderRadius: XYNE_FOUNDATION_TOKENS.border.radius[0],
    backgroundColor: XYNE_FOUNDATION_TOKENS.colors.gray[0],
    boxShadow: 'none',
    padding: {
      x: XYNE_FOUNDATION_TOKENS.unit[12],
      y: XYNE_FOUNDATION_TOKENS.unit[12],
    },
    textContainer: {
      gap: XYNE_FOUNDATION_TOKENS.unit[0],
      header: {
        gap: XYNE_FOUNDATION_TOKENS.unit[8],
        titleIcon: {
          width: XYNE_FOUNDATION_TOKENS.unit[20],
        },
        title: {
          fontSize: XYNE_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
          fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[500],
          color: XYNE_FOUNDATION_TOKENS.colors.gray[400],
        },
        helpIcon: {
          width: XYNE_FOUNDATION_TOKENS.unit[14],
          color: {
            default: XYNE_FOUNDATION_TOKENS.colors.gray[400],
            hover: XYNE_FOUNDATION_TOKENS.colors.gray[400],
            loading: XYNE_FOUNDATION_TOKENS.colors.gray[400],
          },
        },
      },
      stats: {
        gap: XYNE_FOUNDATION_TOKENS.unit[6],
        title: {
          gap: XYNE_FOUNDATION_TOKENS.unit[8],
          value: {
            number: {
              fontSize: XYNE_FOUNDATION_TOKENS.font.size.heading.lg.fontSize,
              fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_FOUNDATION_TOKENS.colors.gray[800],
            },
            line: {
              fontSize: XYNE_FOUNDATION_TOKENS.font.size.heading.sm.fontSize,
              fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_FOUNDATION_TOKENS.colors.gray[800],
            },
            bar: {
              fontSize: XYNE_FOUNDATION_TOKENS.font.size.heading.sm.fontSize,
              fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_FOUNDATION_TOKENS.colors.gray[800],
            },
            progress: {
              fontSize: XYNE_FOUNDATION_TOKENS.font.size.heading.sm.fontSize,
              fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_FOUNDATION_TOKENS.colors.gray[800],
            },
          },
          change: {
            margin: `${String(XYNE_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_FOUNDATION_TOKENS.unit[8])}`,
            arrow: {
              width: XYNE_FOUNDATION_TOKENS.unit[14],
            },
            text: {
              color: {
                increase: XYNE_FOUNDATION_TOKENS.colors.green[600],
                decrease: XYNE_FOUNDATION_TOKENS.colors.red[600],
              },
              fontSize: XYNE_FOUNDATION_TOKENS.font.size.body.xs.fontSize,
              fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
            },
          },
        },
        subtitle: {
          fontSize: XYNE_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
          fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[500],
          color: XYNE_FOUNDATION_TOKENS.colors.gray[400],
        },
      },
    },
    chart: {
      height: XYNE_FOUNDATION_TOKENS.unit[50],
      colors: {
        line: {
          increase: XYNE_FOUNDATION_TOKENS.colors.green[500],
          decrease: XYNE_FOUNDATION_TOKENS.colors.red[500],
        },
        area: {
          increase: XYNE_FOUNDATION_TOKENS.colors.green[500],
          decrease: XYNE_FOUNDATION_TOKENS.colors.red[500],
        },
        gradient: {
          end: XYNE_FOUNDATION_TOKENS.colors.gray[0],
          startOpacity: 0.2,
          endOpacity: 0.5,
        },
      },
      line: {
        strokeWidth: XYNE_FOUNDATION_TOKENS.unit[1.5],
        activeDot: {
          width: XYNE_FOUNDATION_TOKENS.border.radius[4],
          fill: XYNE_FOUNDATION_TOKENS.colors.gray[0],
        },
      },
      bar: {
        borderTopRightRadius: XYNE_FOUNDATION_TOKENS.border.radius[2],
        borderTopLeftRadius: XYNE_FOUNDATION_TOKENS.border.radius[2],
        borderBottomRightRadius: XYNE_FOUNDATION_TOKENS.border.radius[0],
        borderBottomLeftRadius: XYNE_FOUNDATION_TOKENS.border.radius[0],
        fill: {
          default: XYNE_FOUNDATION_TOKENS.colors.primary[500],
          hover: XYNE_FOUNDATION_TOKENS.colors.primary[100],
          loading: XYNE_FOUNDATION_TOKENS.colors.gray[200],
        },
      },
      progressBar: {
        height: XYNE_FOUNDATION_TOKENS.unit[20],
        borderRadius: XYNE_FOUNDATION_TOKENS.border.radius[4],
        gap: XYNE_FOUNDATION_TOKENS.unit[16],
        background: {
          fill: XYNE_FOUNDATION_TOKENS.colors.primary[500],
          empty: XYNE_FOUNDATION_TOKENS.colors.gray[0],
          pattern: {
            color: XYNE_FOUNDATION_TOKENS.colors.gray[200],
            size: `${XYNE_FOUNDATION_TOKENS.unit[10]} ${XYNE_FOUNDATION_TOKENS.unit[10]}`,
          },
        },
        label: {
          fontSize: XYNE_FOUNDATION_TOKENS.font.size.body.md.fontSize,
          fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
          color: XYNE_FOUNDATION_TOKENS.colors.gray[700],
        },
      },
      tooltip: {
        backgroundColor: XYNE_FOUNDATION_TOKENS.colors.gray[900],
        padding: {
          x: XYNE_FOUNDATION_TOKENS.unit[8],
          y: XYNE_FOUNDATION_TOKENS.unit[4],
        },
        borderRadius: XYNE_FOUNDATION_TOKENS.border.radius[4],
        color: XYNE_FOUNDATION_TOKENS.colors.gray[0],
        fontSize: XYNE_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
        fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[500],
      },
    },
  },
  lg: {
    maxWidth: XYNE_FOUNDATION_TOKENS.unit[350],
    height: 'auto',
    border: `${XYNE_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_FOUNDATION_TOKENS.colors.gray[200]}`,
    borderRadius: XYNE_FOUNDATION_TOKENS.border.radius[0],
    backgroundColor: XYNE_FOUNDATION_TOKENS.colors.gray[0],
    boxShadow: 'none',
    padding: {
      x: XYNE_FOUNDATION_TOKENS.unit[16],
      y: XYNE_FOUNDATION_TOKENS.unit[16],
    },
    textContainer: {
      gap: XYNE_FOUNDATION_TOKENS.unit[6],
      header: {
        gap: XYNE_FOUNDATION_TOKENS.unit[8],
        titleIcon: {
          width: XYNE_FOUNDATION_TOKENS.unit[20],
        },
        title: {
          fontSize: XYNE_FOUNDATION_TOKENS.font.size.body.md.fontSize,
          fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[500],
          color: XYNE_FOUNDATION_TOKENS.colors.gray[400],
        },
        helpIcon: {
          width: XYNE_FOUNDATION_TOKENS.unit[14],
          color: {
            default: XYNE_FOUNDATION_TOKENS.colors.gray[400],
            hover: XYNE_FOUNDATION_TOKENS.colors.gray[400],
            loading: XYNE_FOUNDATION_TOKENS.colors.gray[400],
          },
        },
      },
      stats: {
        gap: XYNE_FOUNDATION_TOKENS.unit[6],
        title: {
          gap: XYNE_FOUNDATION_TOKENS.unit[8],
          value: {
            number: {
              fontSize: XYNE_FOUNDATION_TOKENS.font.size.heading.xl.fontSize,
              fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_FOUNDATION_TOKENS.colors.gray[800],
            },
            line: {
              fontSize: XYNE_FOUNDATION_TOKENS.font.size.heading.lg.fontSize,
              fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_FOUNDATION_TOKENS.colors.gray[800],
            },
            bar: {
              fontSize: XYNE_FOUNDATION_TOKENS.font.size.heading.lg.fontSize,
              fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_FOUNDATION_TOKENS.colors.gray[800],
            },
            progress: {
              fontSize: XYNE_FOUNDATION_TOKENS.font.size.heading.lg.fontSize,
              fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_FOUNDATION_TOKENS.colors.gray[800],
            },
          },
          change: {
            margin: `${String(XYNE_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_FOUNDATION_TOKENS.unit[8])}`,
            arrow: {
              width: XYNE_FOUNDATION_TOKENS.unit[14],
            },
            text: {
              color: {
                increase: XYNE_FOUNDATION_TOKENS.colors.green[600],
                decrease: XYNE_FOUNDATION_TOKENS.colors.red[600],
              },
              fontSize: XYNE_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
              fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
            },
          },
        },
        subtitle: {
          fontSize: XYNE_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
          fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[500],
          color: XYNE_FOUNDATION_TOKENS.colors.gray[400],
        },
      },
    },
    chart: {
      height: XYNE_FOUNDATION_TOKENS.unit[50],
      colors: {
        line: {
          increase: XYNE_FOUNDATION_TOKENS.colors.green[500],
          decrease: XYNE_FOUNDATION_TOKENS.colors.red[500],
        },
        area: {
          increase: XYNE_FOUNDATION_TOKENS.colors.green[500],
          decrease: XYNE_FOUNDATION_TOKENS.colors.red[500],
        },
        gradient: {
          end: XYNE_FOUNDATION_TOKENS.colors.gray[0],
          startOpacity: 0.2,
          endOpacity: 0.5,
        },
      },
      line: {
        strokeWidth: XYNE_FOUNDATION_TOKENS.unit[1.5],
        activeDot: {
          width: XYNE_FOUNDATION_TOKENS.border.radius[4],
          fill: XYNE_FOUNDATION_TOKENS.colors.gray[0],
        },
      },
      bar: {
        borderTopRightRadius: XYNE_FOUNDATION_TOKENS.border.radius[2],
        borderTopLeftRadius: XYNE_FOUNDATION_TOKENS.border.radius[2],
        borderBottomRightRadius: XYNE_FOUNDATION_TOKENS.border.radius[2],
        borderBottomLeftRadius: XYNE_FOUNDATION_TOKENS.border.radius[2],
        fill: {
          default: XYNE_FOUNDATION_TOKENS.colors.primary[500],
          hover: XYNE_FOUNDATION_TOKENS.colors.primary[100],
          loading: XYNE_FOUNDATION_TOKENS.colors.gray[200],
        },
      },
      progressBar: {
        height: XYNE_FOUNDATION_TOKENS.unit[20],
        borderRadius: XYNE_FOUNDATION_TOKENS.border.radius[4],
        gap: XYNE_FOUNDATION_TOKENS.unit[16],
        background: {
          fill: XYNE_FOUNDATION_TOKENS.colors.primary[500],
          empty: XYNE_FOUNDATION_TOKENS.colors.gray[0],
          pattern: {
            color: XYNE_FOUNDATION_TOKENS.colors.gray[200],
            size: `${XYNE_FOUNDATION_TOKENS.unit[10]} ${XYNE_FOUNDATION_TOKENS.unit[10]}`,
          },
        },
        label: {
          fontSize: XYNE_FOUNDATION_TOKENS.font.size.body.md.fontSize,
          fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[600],
          color: XYNE_FOUNDATION_TOKENS.colors.gray[700],
        },
      },
      tooltip: {
        backgroundColor: XYNE_FOUNDATION_TOKENS.colors.gray[900],
        padding: {
          x: XYNE_FOUNDATION_TOKENS.unit[8],
          y: XYNE_FOUNDATION_TOKENS.unit[4],
        },
        borderRadius: XYNE_FOUNDATION_TOKENS.border.radius[4],
        color: XYNE_FOUNDATION_TOKENS.colors.gray[0],
        fontSize: XYNE_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
        fontWeight: XYNE_FOUNDATION_TOKENS.font.weight[500],
      },
    },
  },
};

// Dark theme StatCard tokens
export const StatCardDark = {
  sm: {
    maxWidth: XYNE_DARK_FOUNDATION_TOKENS.unit[200],
    height: 'auto',
    border: `${XYNE_DARK_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_DARK_FOUNDATION_TOKENS.colors.gray[200]}`,
    borderRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[0],
    backgroundColor: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
    boxShadow: 'none',
    padding: {
      x: XYNE_DARK_FOUNDATION_TOKENS.unit[12],
      y: XYNE_DARK_FOUNDATION_TOKENS.unit[12],
    },
    textContainer: {
      gap: XYNE_DARK_FOUNDATION_TOKENS.unit[0],
      header: {
        gap: XYNE_DARK_FOUNDATION_TOKENS.unit[8],
        titleIcon: {
          width: XYNE_DARK_FOUNDATION_TOKENS.unit[20],
        },
        title: {
          fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
          fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[500],
          color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[500],
        },
        helpIcon: {
          width: XYNE_DARK_FOUNDATION_TOKENS.unit[14],
          color: {
            default: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[400],
            hover: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[400],
            loading: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[400],
          },
        },
      },
      stats: {
        gap: XYNE_DARK_FOUNDATION_TOKENS.unit[6],
        title: {
          gap: XYNE_DARK_FOUNDATION_TOKENS.unit[8],
          value: {
            number: {
              fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.heading.lg.fontSize,
              fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[800],
            },
            line: {
              fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.heading.sm.fontSize,
              fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[800],
            },
            bar: {
              fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.heading.sm.fontSize,
              fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[800],
            },
            progress: {
              fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.heading.sm.fontSize,
              fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[800],
            },
          },
          change: {
            margin: `${String(XYNE_DARK_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_DARK_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_DARK_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_DARK_FOUNDATION_TOKENS.unit[8])}`,
            arrow: {
              width: XYNE_DARK_FOUNDATION_TOKENS.unit[14],
            },
            text: {
              color: {
                increase: XYNE_DARK_FOUNDATION_TOKENS.colors.green[600],
                decrease: XYNE_DARK_FOUNDATION_TOKENS.colors.red[600],
              },
              fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.body.xs.fontSize,
              fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
            },
          },
        },
        subtitle: {
          fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
          fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[500],
          color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[400],
        },
      },
    },
    chart: {
      height: XYNE_DARK_FOUNDATION_TOKENS.unit[50],
      colors: {
        line: {
          increase: XYNE_DARK_FOUNDATION_TOKENS.colors.green[500],
          decrease: XYNE_DARK_FOUNDATION_TOKENS.colors.red[500],
        },
        area: {
          increase: XYNE_DARK_FOUNDATION_TOKENS.colors.green[500],
          decrease: XYNE_DARK_FOUNDATION_TOKENS.colors.red[500],
        },
        gradient: {
          end: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
          startOpacity: 0.2,
          endOpacity: 0.5,
        },
      },
      line: {
        strokeWidth: XYNE_DARK_FOUNDATION_TOKENS.unit[1.5],
        activeDot: {
          width: XYNE_DARK_FOUNDATION_TOKENS.border.radius[4],
          fill: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
        },
      },
      bar: {
        borderTopRightRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[2],
        borderTopLeftRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[2],
        borderBottomRightRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[0],
        borderBottomLeftRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[0],
        fill: {
          default: XYNE_DARK_FOUNDATION_TOKENS.colors.primary[500],
          hover: XYNE_DARK_FOUNDATION_TOKENS.colors.primary[100],
          loading: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[200],
        },
      },
      progressBar: {
        height: XYNE_DARK_FOUNDATION_TOKENS.unit[20],
        borderRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[4],
        gap: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
        background: {
          fill: XYNE_DARK_FOUNDATION_TOKENS.colors.primary[500],
          empty: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
          pattern: {
            color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[200],
            size: `${XYNE_DARK_FOUNDATION_TOKENS.unit[10]} ${XYNE_DARK_FOUNDATION_TOKENS.unit[10]}`,
          },
        },
        label: {
          fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.body.md.fontSize,
          fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
          color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[700],
        },
      },
      tooltip: {
        backgroundColor: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[900],
        padding: {
          x: XYNE_DARK_FOUNDATION_TOKENS.unit[8],
          y: XYNE_DARK_FOUNDATION_TOKENS.unit[4],
        },
        borderRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[4],
        color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
        fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
        fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[500],
      },
    },
  },
  lg: {
    maxWidth: XYNE_DARK_FOUNDATION_TOKENS.unit[350],
    height: 'auto',
    border: `${XYNE_DARK_FOUNDATION_TOKENS.border.width[0]} solid ${XYNE_DARK_FOUNDATION_TOKENS.colors.gray[200]}`,
    borderRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[0],
    backgroundColor: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
    boxShadow: 'none',
    padding: {
      x: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
      y: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
    },
    textContainer: {
      gap: XYNE_DARK_FOUNDATION_TOKENS.unit[6],
      header: {
        gap: XYNE_DARK_FOUNDATION_TOKENS.unit[8],
        titleIcon: {
          width: XYNE_DARK_FOUNDATION_TOKENS.unit[20],
        },
        title: {
          fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.body.md.fontSize,
          fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[500],
          color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[500],
        },
        helpIcon: {
          width: XYNE_DARK_FOUNDATION_TOKENS.unit[14],
          color: {
            default: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[400],
            hover: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[400],
            loading: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[400],
          },
        },
      },
      stats: {
        gap: XYNE_DARK_FOUNDATION_TOKENS.unit[6],
        title: {
          gap: XYNE_DARK_FOUNDATION_TOKENS.unit[8],
          value: {
            number: {
              fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.heading.xl.fontSize,
              fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[800],
            },
            line: {
              fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.heading.lg.fontSize,
              fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[800],
            },
            bar: {
              fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.heading.lg.fontSize,
              fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[800],
            },
            progress: {
              fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.heading.lg.fontSize,
              fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
              color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[800],
            },
          },
          change: {
            margin: `${String(XYNE_DARK_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_DARK_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_DARK_FOUNDATION_TOKENS.unit[0])} ${String(XYNE_DARK_FOUNDATION_TOKENS.unit[8])}`,
            arrow: {
              width: XYNE_DARK_FOUNDATION_TOKENS.unit[14],
            },
            text: {
              color: {
                increase: XYNE_DARK_FOUNDATION_TOKENS.colors.green[600],
                decrease: XYNE_DARK_FOUNDATION_TOKENS.colors.red[600],
              },
              fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
              fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
            },
          },
        },
        subtitle: {
          fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
          fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[500],
          color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[500],
        },
      },
    },
    chart: {
      height: XYNE_DARK_FOUNDATION_TOKENS.unit[50],
      colors: {
        line: {
          increase: XYNE_DARK_FOUNDATION_TOKENS.colors.green[500],
          decrease: XYNE_DARK_FOUNDATION_TOKENS.colors.red[500],
        },
        area: {
          increase: XYNE_DARK_FOUNDATION_TOKENS.colors.green[500],
          decrease: XYNE_DARK_FOUNDATION_TOKENS.colors.red[500],
        },
        gradient: {
          end: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
          startOpacity: 0.2,
          endOpacity: 0.5,
        },
      },
      line: {
        strokeWidth: XYNE_DARK_FOUNDATION_TOKENS.unit[1.5],
        activeDot: {
          width: XYNE_DARK_FOUNDATION_TOKENS.border.radius[4],
          fill: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
        },
      },
      bar: {
        borderTopRightRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[2],
        borderTopLeftRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[2],
        borderBottomRightRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[2],
        borderBottomLeftRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[2],
        fill: {
          default: XYNE_DARK_FOUNDATION_TOKENS.colors.primary[500],
          hover: XYNE_DARK_FOUNDATION_TOKENS.colors.primary[100],
          loading: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[200],
        },
      },
      progressBar: {
        height: XYNE_DARK_FOUNDATION_TOKENS.unit[20],
        borderRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[4],
        gap: XYNE_DARK_FOUNDATION_TOKENS.unit[16],
        background: {
          fill: XYNE_DARK_FOUNDATION_TOKENS.colors.primary[500],
          empty: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
          pattern: {
            color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[200],
            size: `${XYNE_DARK_FOUNDATION_TOKENS.unit[10]} ${XYNE_DARK_FOUNDATION_TOKENS.unit[10]}`,
          },
        },
        label: {
          fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.body.md.fontSize,
          fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[600],
          color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[700],
        },
      },
      tooltip: {
        backgroundColor: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[900],
        padding: {
          x: XYNE_DARK_FOUNDATION_TOKENS.unit[8],
          y: XYNE_DARK_FOUNDATION_TOKENS.unit[4],
        },
        borderRadius: XYNE_DARK_FOUNDATION_TOKENS.border.radius[4],
        color: XYNE_DARK_FOUNDATION_TOKENS.colors.gray[0],
        fontSize: XYNE_DARK_FOUNDATION_TOKENS.font.size.body.sm.fontSize,
        fontWeight: XYNE_DARK_FOUNDATION_TOKENS.font.weight[500],
      },
    },
  },
};
