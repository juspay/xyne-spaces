// The data-bridge runtime is authored as a real .ts file (so it typechecks and
// gives agent code true types) and pulled in as a string, because it is compiled
// by Sandpack inside the preview iframe rather than bundled with the dashboard.
import XYNE_DATA_RUNTIME_CODE from './xyneDataRuntime.source.ts?raw';

/** Reserved in the tool's RESERVED_PATH_PREFIXES so an app cannot shadow it. */
export const XYNE_DATA_RUNTIME_PATH = '/lib/xyne-data.ts';

export { XYNE_DATA_RUNTIME_CODE };
