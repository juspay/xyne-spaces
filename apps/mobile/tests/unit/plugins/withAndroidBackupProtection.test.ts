import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const PLUGIN_SOURCE = readFileSync(
  resolve(process.cwd(), 'plugins/withAndroidBackupProtection.cjs'),
  'utf8',
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require(resolve(process.cwd(), 'plugins/withAndroidBackupProtection.cjs')) as {
  PROTECTED_SHARED_PREF_FILES: readonly string[];
  OWNED_LEGACY_RULES_RESOURCE: string;
  OWNED_EXTRACTION_RULES_RESOURCE: string;
  buildLegacyBackupRules: () => string;
  buildDataExtractionRules: () => string;
  mergeLegacyBackupRules: (existingXml: string | null) => Promise<string>;
  mergeDataExtractionRules: (existingXml: string | null) => Promise<string>;
  resolveBackupXmlResource: (
    existingValue: string | undefined,
    ownedResourceName: string,
  ) => { resourceName: string; shouldAssign: boolean };
  countActiveSharedPrefExcludes: (xml: string, fileName: string) => Promise<number>;
};

const countSectionOpenTags = (xml: string, tagName: string): number =>
  (xml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>`, 'g')) ?? []).length;

describe('Android backup protection config plugin', () => {
  it('excludes credential, SecureStore, and call-handoff preference files', async () => {
    assert.deepEqual(plugin.PROTECTED_SHARED_PREF_FILES, [
      'SecureStore.xml',
      'XyneAuthContext.xml',
      'CallNotificationData.xml',
    ]);

    const legacyRules = plugin.buildLegacyBackupRules();
    const extractionRules = plugin.buildDataExtractionRules();
    for (const rules of [legacyRules, extractionRules]) {
      assert.match(rules, /domain="sharedpref" path="SecureStore\.xml"/);
      assert.match(rules, /domain="sharedpref" path="XyneAuthContext\.xml"/);
      assert.match(rules, /domain="sharedpref" path="CallNotificationData\.xml"/);
      assert.doesNotMatch(rules, /MMKV|AsyncStorage|mtls_enrollment_prefs/);
    }
    assert.equal(await plugin.countActiveSharedPrefExcludes(legacyRules, 'SecureStore.xml'), 1);
    assert.equal(await plugin.countActiveSharedPrefExcludes(extractionRules, 'SecureStore.xml'), 2);
    assert.equal((extractionRules.match(/<exclude /g) ?? []).length, 6);
  });

  it('preserves allowBackup and writes both platform rule references', () => {
    assert.doesNotMatch(PLUGIN_SOURCE, /android:allowBackup/);
    assert.match(PLUGIN_SOURCE, /android:fullBackupContent/);
    assert.match(PLUGIN_SOURCE, /android:dataExtractionRules/);
    assert.equal(plugin.OWNED_LEGACY_RULES_RESOURCE, 'lotus_backup_rules');
    assert.equal(plugin.OWNED_EXTRACTION_RULES_RESOURCE, 'lotus_data_extraction_rules');
    assert.match(PLUGIN_SOURCE, /shouldAssign/);
    assert.match(PLUGIN_SOURCE, /Refusing to replace backup attribute/);
    assert.match(PLUGIN_SOURCE, /xml2js/);
    assert.doesNotMatch(PLUGIN_SOURCE, /lastIndexOf\(closeTag\)/);
  });

  it('declares xml2js as a direct development dependency', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { devDependencies?: { xml2js?: string } };
    assert.equal(typeof packageJson.devDependencies?.xml2js, 'string');
  });

  it('assigns owned resources only when the manifest attribute is unset', () => {
    assert.deepEqual(plugin.resolveBackupXmlResource(undefined, 'lotus_backup_rules'), {
      resourceName: 'lotus_backup_rules',
      shouldAssign: true,
    });
    assert.deepEqual(
      plugin.resolveBackupXmlResource('@xml/other_plugin_backup', 'lotus_backup_rules'),
      { resourceName: 'other_plugin_backup', shouldAssign: false },
    );
    assert.throws(
      () => plugin.resolveBackupXmlResource('true', 'lotus_backup_rules'),
      /Refusing to replace backup attribute/,
    );
  });

  it('merges excludes into existing legacy backup rules instead of replacing them', async () => {
    const existing = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<full-backup-content>',
      '  <include domain="file" path="." />',
      '  <exclude domain="sharedpref" path="XyneAuthContext.xml" />',
      '</full-backup-content>',
      '',
    ].join('\n');

    const merged = await plugin.mergeLegacyBackupRules(existing);
    assert.match(merged, /<include domain="file" path="\."\s*\/>/);
    assert.equal(await plugin.countActiveSharedPrefExcludes(merged, 'XyneAuthContext.xml'), 1);
    assert.equal(await plugin.countActiveSharedPrefExcludes(merged, 'SecureStore.xml'), 1);
    assert.equal(await plugin.countActiveSharedPrefExcludes(merged, 'CallNotificationData.xml'), 1);
    assert.equal(await plugin.mergeLegacyBackupRules(null), plugin.buildLegacyBackupRules());
  });

  it('merges excludes into both cloud-backup and device-transfer sections', async () => {
    const existing = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<data-extraction-rules>',
      '  <cloud-backup>',
      '    <include domain="sharedpref" path="ok.xml" />',
      '  </cloud-backup>',
      '</data-extraction-rules>',
      '',
    ].join('\n');

    const merged = await plugin.mergeDataExtractionRules(existing);
    assert.match(merged, /<include domain="sharedpref" path="ok\.xml"\s*\/>/);
    assert.equal(countSectionOpenTags(merged, 'cloud-backup'), 1);
    assert.equal(countSectionOpenTags(merged, 'device-transfer'), 1);
    assert.equal(await plugin.countActiveSharedPrefExcludes(merged, 'SecureStore.xml'), 2);
    assert.equal(await plugin.countActiveSharedPrefExcludes(merged, 'XyneAuthContext.xml'), 2);
    assert.equal(await plugin.countActiveSharedPrefExcludes(merged, 'CallNotificationData.xml'), 2);
  });

  it('does not treat a commented exclusion as an active SecureStore exclude', async () => {
    const existing = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<full-backup-content>',
      '  <!-- <exclude domain="sharedpref" path="SecureStore.xml" /> -->',
      '  <include domain="file" path="." />',
      '</full-backup-content>',
      '',
    ].join('\n');

    assert.equal(await plugin.countActiveSharedPrefExcludes(existing, 'SecureStore.xml'), 0);
    const merged = await plugin.mergeLegacyBackupRules(existing);
    assert.doesNotMatch(merged, /<!--/);
    assert.equal(await plugin.countActiveSharedPrefExcludes(merged, 'SecureStore.xml'), 1);
    assert.match(merged, /<exclude domain="sharedpref" path="SecureStore\.xml"\s*\/>/);
  });

  it('expands self-closing extraction sections instead of duplicating them', async () => {
    const existing = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<data-extraction-rules>',
      '  <cloud-backup />',
      '  <device-transfer disableIfNoEncryptionCapabilities="true" />',
      '</data-extraction-rules>',
      '',
    ].join('\n');

    const merged = await plugin.mergeDataExtractionRules(existing);
    assert.equal(countSectionOpenTags(merged, 'cloud-backup'), 1);
    assert.equal(countSectionOpenTags(merged, 'device-transfer'), 1);
    assert.doesNotMatch(merged, /<cloud-backup\s*\/>/);
    assert.doesNotMatch(merged, /<device-transfer\s*\/>/);
    assert.match(merged, /disableIfNoEncryptionCapabilities="true"/);
    assert.equal(await plugin.countActiveSharedPrefExcludes(merged, 'SecureStore.xml'), 2);
  });

  it('recognizes reordered exclude attributes as already active', async () => {
    const existing = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<full-backup-content>',
      '  <exclude path="SecureStore.xml" domain="sharedpref" />',
      '</full-backup-content>',
      '',
    ].join('\n');

    const merged = await plugin.mergeLegacyBackupRules(existing);
    assert.equal(await plugin.countActiveSharedPrefExcludes(merged, 'SecureStore.xml'), 1);
    assert.equal(await plugin.countActiveSharedPrefExcludes(merged, 'XyneAuthContext.xml'), 1);
    assert.equal(await plugin.countActiveSharedPrefExcludes(merged, 'CallNotificationData.xml'), 1);
  });

  it('is idempotent across repeated merges', async () => {
    const existing = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<data-extraction-rules>',
      '  <cloud-backup />',
      '</data-extraction-rules>',
      '',
    ].join('\n');

    const first = await plugin.mergeDataExtractionRules(existing);
    const second = await plugin.mergeDataExtractionRules(first);
    assert.equal(first, second);
    assert.equal(countSectionOpenTags(second, 'cloud-backup'), 1);
    assert.equal(countSectionOpenTags(second, 'device-transfer'), 1);
    assert.equal(await plugin.countActiveSharedPrefExcludes(second, 'SecureStore.xml'), 2);
  });

  it('refuses to overwrite unrecognized or unsafe backup XML', async () => {
    await assert.rejects(
      plugin.mergeLegacyBackupRules('<resources />\n'),
      /Refusing to replace unrecognized legacy backup rules/,
    );
    await assert.rejects(
      plugin.mergeDataExtractionRules('<resources />\n'),
      /Refusing to replace unrecognized data-extraction rules/,
    );
    await assert.rejects(
      plugin.mergeLegacyBackupRules(
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><full-backup-content></full-backup-content>',
      ),
      /DTD or entity declarations/,
    );
  });
});
