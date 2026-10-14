const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');
const xml2js = require('xml2js');
const {
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-android-backup-protection';
const PLUGIN_VERSION = '1.2.0';

const OWNED_LEGACY_RULES_RESOURCE = 'lotus_backup_rules';
const OWNED_EXTRACTION_RULES_RESOURCE = 'lotus_data_extraction_rules';

// These are app-owned SharedPreferences files containing authentication and
// incoming-call handoff state. Encrypted/authenticated contents are not useful
// after restore without the device-bound keys and must not be copied to another
// installation or device. SecureStore.xml is expo-secure-store's Android file.
const PROTECTED_SHARED_PREF_FILES = Object.freeze([
  'SecureStore.xml',
  'XyneAuthContext.xml',
  'CallNotificationData.xml',
]);

const XML_PARSER_OPTIONS = Object.freeze({
  explicitArray: true,
  emptyTag: {},
  ignoreAttrs: false,
  mergeAttrs: false,
});

function createSharedPrefExclude(fileName) {
  return { $: { domain: 'sharedpref', path: fileName } };
}

function serializeBackupXml(parsed) {
  const builder = new xml2js.Builder({
    xmldec: { version: '1.0', encoding: 'utf-8' },
    renderOpts: { pretty: true, indent: '  ', newline: '\n' },
  });
  const xml = builder.buildObject(parsed);
  return xml.endsWith('\n') ? xml : `${xml}\n`;
}

function buildLegacyBackupRules() {
  return serializeBackupXml({
    'full-backup-content': {
      exclude: PROTECTED_SHARED_PREF_FILES.map(createSharedPrefExclude),
    },
  });
}

function buildDataExtractionRules() {
  return serializeBackupXml({
    'data-extraction-rules': {
      'cloud-backup': [{ exclude: PROTECTED_SHARED_PREF_FILES.map(createSharedPrefExclude) }],
      'device-transfer': [{ exclude: PROTECTED_SHARED_PREF_FILES.map(createSharedPrefExclude) }],
    },
  });
}

function xmlResourceName(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const match = /^@xml\/([A-Za-z0-9_.]+)$/.exec(value.trim());
  return match ? match[1] : null;
}

/**
 * Keep another plugin's @xml resource. Only assign our owned file when the
 * attribute is unset. Non-resource values are a conflict, not a silent replace.
 */
function resolveBackupXmlResource(existingValue, ownedResourceName) {
  if (!existingValue) {
    return { resourceName: ownedResourceName, shouldAssign: true };
  }
  const resourceName = xmlResourceName(existingValue);
  if (!resourceName) {
    throw new Error(
      `[${PLUGIN_NAME}] Refusing to replace backup attribute ${JSON.stringify(existingValue)}; expected @xml/<name>`,
    );
  }
  return { resourceName, shouldAssign: false };
}

function assertNoDtdOrEntities(contents) {
  if (/<!DOCTYPE/i.test(contents) || /<!ENTITY/i.test(contents)) {
    throw new Error(`[${PLUGIN_NAME}] Refusing backup XML with DTD or entity declarations`);
  }
}

async function parseBackupXml(contents) {
  if (typeof contents !== 'string' || contents.trim().length === 0) {
    throw new Error(`[${PLUGIN_NAME}] Refusing empty backup XML`);
  }
  assertNoDtdOrEntities(contents);
  try {
    return await new xml2js.Parser(XML_PARSER_OPTIONS).parseStringPromise(contents);
  } catch (error) {
    throw new Error(
      `[${PLUGIN_NAME}] Refusing unparsable backup XML: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function requireRoot(parsed, expectedRoot, kind) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`[${PLUGIN_NAME}] Refusing to replace unrecognized ${kind}`);
  }
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== expectedRoot) {
    throw new Error(`[${PLUGIN_NAME}] Refusing to replace unrecognized ${kind}`);
  }
  const root = parsed[expectedRoot];
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error(`[${PLUGIN_NAME}] Refusing to replace unrecognized ${kind}`);
  }
  return root;
}

function asElementArray(value, kind) {
  if (value === null || value === undefined) {
    return [];
  }
  const items = Array.isArray(value) ? value : [value];
  return items.map(item => {
    if (item === null || item === undefined || item === '') {
      return {};
    }
    if (typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`[${PLUGIN_NAME}] Unsupported ${kind} child in backup XML`);
    }
    return item;
  });
}

function isActiveSharedPrefExclude(element, fileName) {
  const attrs = element && typeof element === 'object' ? element.$ : undefined;
  return Boolean(attrs) && attrs.domain === 'sharedpref' && attrs.path === fileName;
}

function ensureSharedPrefExcludes(parent, kind) {
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
    throw new Error(`[${PLUGIN_NAME}] Unsupported ${kind} in backup XML`);
  }
  const excludes = asElementArray(parent.exclude, `${kind} exclude`);
  parent.exclude = excludes;
  for (const fileName of PROTECTED_SHARED_PREF_FILES) {
    if (excludes.some(element => isActiveSharedPrefExclude(element, fileName))) {
      continue;
    }
    excludes.push(createSharedPrefExclude(fileName));
  }
}

function ensureNamedSections(root, tagName) {
  const sections = asElementArray(root[tagName], tagName);
  if (sections.length === 0) {
    sections.push({});
  }
  root[tagName] = sections;
  for (const section of sections) {
    ensureSharedPrefExcludes(section, tagName);
  }
}

function countActiveSharedPrefExcludesInTree(node, fileName) {
  if (!node || typeof node !== 'object') {
    return 0;
  }
  const items = Array.isArray(node) ? node : [node];
  let count = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    for (const exclude of asElementArray(item.exclude, 'exclude')) {
      if (isActiveSharedPrefExclude(exclude, fileName)) {
        count += 1;
      }
    }
    for (const [key, value] of Object.entries(item)) {
      if (key === '$' || key === '_' || key === 'exclude') {
        continue;
      }
      count += countActiveSharedPrefExcludesInTree(value, fileName);
    }
  }
  return count;
}

async function countActiveSharedPrefExcludes(xml, fileName) {
  const parsed = await parseBackupXml(xml);
  return countActiveSharedPrefExcludesInTree(parsed, fileName);
}

async function mergeLegacyBackupRules(existingXml) {
  if (!existingXml) {
    return buildLegacyBackupRules();
  }
  const parsed = await parseBackupXml(existingXml);
  const root = requireRoot(parsed, 'full-backup-content', 'legacy backup rules');
  ensureSharedPrefExcludes(root, 'full-backup-content');
  return serializeBackupXml(parsed);
}

async function mergeDataExtractionRules(existingXml) {
  if (!existingXml) {
    return buildDataExtractionRules();
  }
  const parsed = await parseBackupXml(existingXml);
  const root = requireRoot(parsed, 'data-extraction-rules', 'data-extraction rules');
  ensureNamedSections(root, 'cloud-backup');
  ensureNamedSections(root, 'device-transfer');
  return serializeBackupXml(parsed);
}

async function writeMergedRuleFile(filePath, mergeFn) {
  const existing = readFileIfExists(filePath);
  const next = await mergeFn(existing);
  if (existing !== next) {
    fs.writeFileSync(filePath, next);
  }
}

function withBackupManifest(config) {
  return withAndroidManifest(config, cfg => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error(`[${PLUGIN_NAME}] Android application element not found`);
    }

    // Keep the existing allowBackup policy and all other manifest attributes
    // unchanged. If another plugin already named backup/extraction XML, keep
    // that pointer and merge excludes into those files instead of replacing it.
    const legacy = resolveBackupXmlResource(
      application.$['android:fullBackupContent'],
      OWNED_LEGACY_RULES_RESOURCE,
    );
    const extraction = resolveBackupXmlResource(
      application.$['android:dataExtractionRules'],
      OWNED_EXTRACTION_RULES_RESOURCE,
    );
    if (legacy.shouldAssign) {
      application.$['android:fullBackupContent'] = `@xml/${legacy.resourceName}`;
    }
    if (extraction.shouldAssign) {
      application.$['android:dataExtractionRules'] = `@xml/${extraction.resourceName}`;
    }
    return cfg;
  });
}

function withBackupRuleFiles(config) {
  return withDangerousMod(config, [
    'android',
    async cfg => {
      const xmlDirectory = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(xmlDirectory, { recursive: true });

      const manifestPath = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'AndroidManifest.xml',
      );
      let legacyResource = OWNED_LEGACY_RULES_RESOURCE;
      let extractionResource = OWNED_EXTRACTION_RULES_RESOURCE;
      if (fs.existsSync(manifestPath)) {
        const manifest = fs.readFileSync(manifestPath, 'utf8');
        const fullBackup = manifest.match(/android:fullBackupContent="([^"]+)"/);
        const extraction = manifest.match(/android:dataExtractionRules="([^"]+)"/);
        if (fullBackup) {
          const resolved = resolveBackupXmlResource(fullBackup[1], OWNED_LEGACY_RULES_RESOURCE);
          legacyResource = resolved.resourceName;
        }
        if (extraction) {
          const resolved = resolveBackupXmlResource(extraction[1], OWNED_EXTRACTION_RULES_RESOURCE);
          extractionResource = resolved.resourceName;
        }
      }

      await writeMergedRuleFile(
        path.join(xmlDirectory, `${legacyResource}.xml`),
        mergeLegacyBackupRules,
      );
      await writeMergedRuleFile(
        path.join(xmlDirectory, `${extractionResource}.xml`),
        mergeDataExtractionRules,
      );

      // Previous prebuilds may have written our owned files even when the
      // manifest still points elsewhere. Merge into those too so excludes are
      // not lost if a later plugin restores our resource names.
      if (legacyResource !== OWNED_LEGACY_RULES_RESOURCE) {
        const ownedLegacy = path.join(xmlDirectory, `${OWNED_LEGACY_RULES_RESOURCE}.xml`);
        if (fs.existsSync(ownedLegacy)) {
          await writeMergedRuleFile(ownedLegacy, mergeLegacyBackupRules);
        }
      }
      if (extractionResource !== OWNED_EXTRACTION_RULES_RESOURCE) {
        const ownedExtraction = path.join(xmlDirectory, `${OWNED_EXTRACTION_RULES_RESOURCE}.xml`);
        if (fs.existsSync(ownedExtraction)) {
          await writeMergedRuleFile(ownedExtraction, mergeDataExtractionRules);
        }
      }
      return cfg;
    },
  ]);
}

function withAndroidBackupProtection(config) {
  return withBackupRuleFiles(withBackupManifest(config));
}

const plugin = createRunOncePlugin(withAndroidBackupProtection, PLUGIN_NAME, PLUGIN_VERSION);

plugin.PROTECTED_SHARED_PREF_FILES = PROTECTED_SHARED_PREF_FILES;
plugin.OWNED_LEGACY_RULES_RESOURCE = OWNED_LEGACY_RULES_RESOURCE;
plugin.OWNED_EXTRACTION_RULES_RESOURCE = OWNED_EXTRACTION_RULES_RESOURCE;
plugin.buildLegacyBackupRules = buildLegacyBackupRules;
plugin.buildDataExtractionRules = buildDataExtractionRules;
plugin.mergeLegacyBackupRules = mergeLegacyBackupRules;
plugin.mergeDataExtractionRules = mergeDataExtractionRules;
plugin.resolveBackupXmlResource = resolveBackupXmlResource;
plugin.countActiveSharedPrefExcludes = countActiveSharedPrefExcludes;

module.exports = plugin;
