import * as XLSX from 'xlsx';

export interface ExcelParserMessage {
  type: 'PARSE';
  arrayBuffer: ArrayBuffer;
}

export interface ExcelParserResponse {
  type: 'SUCCESS' | 'ERROR';
  sheets?: { name: string; data: unknown[][] }[];
  error?: string;
}

self.onmessage = (event: MessageEvent<ExcelParserMessage>) => {
  const { type, arrayBuffer } = event.data;

  if (type === 'PARSE') {
    try {
      // Parse XLSX in worker thread (truly off main thread)
      const workbook = XLSX.read(arrayBuffer, {
        type: 'array',
        cellDates: true,
        cellNF: true,
      });

      const parsedSheets = workbook.SheetNames.map(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) return { name: sheetName, data: [] };
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        const sheetData: unknown[][] = [];

        for (let row = range.s.r; row <= range.e.r; row++) {
          const rowData: unknown[] = [];
          for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
            const cell = worksheet[cellAddress] as XLSX.CellObject | undefined;
            rowData.push(cell ? XLSX.utils.format_cell(cell) : '');
          }
          sheetData.push(rowData);
        }

        return { name: sheetName, data: sheetData };
      });

      const response: ExcelParserResponse = {
        type: 'SUCCESS',
        sheets: parsedSheets,
      };

      self.postMessage(response);
    } catch (error) {
      const response: ExcelParserResponse = {
        type: 'ERROR',
        error: error instanceof Error ? error.message : 'Unknown error parsing Excel file',
      };
      self.postMessage(response);
    }
  }
};
