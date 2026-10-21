const fs = require('fs');

/**
 * Read a file as text, returning null when it does not exist.
 * Avoids an exists-then-read race; any error other than ENOENT is rethrown.
 */
function readFileIfExists(filePath, encoding = 'utf8') {
  try {
    return fs.readFileSync(filePath, encoding);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

module.exports = { readFileIfExists };
