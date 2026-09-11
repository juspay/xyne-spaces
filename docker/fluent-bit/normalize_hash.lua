-- Normalizes an error log message into a stable template and hashes it,
-- so VictoriaLogs can group recurring occurrences of "the same" error
-- (e.g. `stats by (fingerprint) count(), min(_time), max(_time)`).

local function normalize(message)
  if message == nil then
    return ''
  end
  local m = string.lower(tostring(message))

  -- UUIDs
  m = string.gsub(m, '%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x', '<uuid>')
  -- ISO-ish timestamps (m is already lower-cased, so match lower t/z)
  m = string.gsub(m, '%d%d%d%d%-%d%d%-%d%d[t ]%d%d:%d%d:%d%d[%.%d]*z?', '<ts>')
  -- hex addresses / long hex ids (e.g. 0x7ffee, object hashes)
  m = string.gsub(m, '0x%x+', '<hex>')
  -- decimal digits are valid %x, so use the same token as plain numbers below
  m = string.gsub(m, '%x%x%x%x%x%x%x%x%x%x%x%x+', '<num>')
  -- plain numbers (ids, ports, line numbers, durations)
  m = string.gsub(m, '%d+', '<num>')
  -- quoted string literals (paths, values interpolated into the message)
  m = string.gsub(m, '"[^"]*"', '<str>')
  m = string.gsub(m, "'[^']*'", '<str>')
  -- collapse whitespace
  m = string.gsub(m, '%s+', ' ')
  m = string.gsub(m, '^%s+', '')
  m = string.gsub(m, '%s+$', '')

  return m
end

-- djb2: no crypto lib is bundled with Fluent Bit's Lua runtime, and plain
-- Lua 5.1 (no LuaJIT bitops) has no bitwise operators, so this sticks to
-- plain arithmetic. Fast, dependency-free, fine for dedup fingerprints at
-- log-error volumes.
local function djb2(str)
  local hash = 5381
  for i = 1, #str do
    hash = ((hash * 33) + string.byte(str, i)) % 4294967296
  end
  return string.format('%08x', hash)
end

function normalize_and_hash(tag, timestamp, record)
  local template = normalize(record['message'])
  -- module can carry dynamic data (e.g. `vespa-search, <searchId>`); normalize
  -- it too so it doesn't blow up VictoriaLogs stream cardinality as a label.
  local normalized_module = normalize(record['module'])
  record['normalized_message'] = template
  record['normalized_module'] = normalized_module
  record['fingerprint'] = djb2(normalized_module .. '|' .. template)

  -- code = 1: keep record, replaced with modified fields
  return 1, timestamp, record
end
