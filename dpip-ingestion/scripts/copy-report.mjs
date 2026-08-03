import { copyFile } from 'node:fs/promises';

await copyFile('Report.html', 'console-source/Report.html');
