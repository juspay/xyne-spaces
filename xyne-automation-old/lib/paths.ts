import * as path from 'path';

/**
 * Get the report timestamp from environment or use 'latest' as default
 */
export const getReportTimestamp = (): string => {
  return process.env.REPORT_TIMESTAMP || 'latest';
};

/**
 * Get the base report directory path
 */
export const getReportDir = (timestamp?: string): string => {
  const ts = timestamp || getReportTimestamp();
  return path.resolve(__dirname, '..', 'report', ts);
};

/**
 * Get screenshot directory paths for the given timestamp
 */
export const getScreenshotDirectories = (timestamp?: string) => {
  const ts = timestamp || getReportTimestamp();
  const reportDir = getReportDir(ts);

  return {
    failureScreenshots: path.join(reportDir, 'failure-screenshots'),
    visualRegression: path.join(reportDir, 'visual-regression-screenshots'),
  };
};
