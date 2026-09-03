import { copyFile } from 'node:fs/promises';

await Promise.all([
  copyFile('Report.html', 'console-source/Report.html'),
  copyFile('DPIP_Overview.html', 'console-source/DPIP_Overview.html'),
]);
