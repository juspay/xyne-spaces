import { toJsonSafeValue } from './jsonSafe';

describe('toJsonSafeValue', () => {
  it('normalizes BlockNote table fields for Prisma JSON persistence', () => {
    const table = {
      type: 'table',
      content: {
        columnWidths: [undefined, 120],
        headerRows: 1,
        headerCols: undefined,
      },
    };

    expect(toJsonSafeValue(table)).toEqual({
      type: 'table',
      content: {
        columnWidths: [null, 120],
        headerRows: 1,
      },
    });
  });
});
