const { withXcodeProject, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

/** Must match custom ids in lotus/src/notifications/v3/sound.ts */
const SOUND_IDS = ['bell', 'string', 'sos_alert'];

/**
 * Main app target / source folder name. Expo derives it from the display name with whitespace
 * removed (`Xyne Spaces Community` → `XyneSpacesCommunity`), so it must not be hardcoded.
 * @param {import('@expo/config-plugins').ExportedConfigWithProps} cfg
 */
function resolveMainTargetName(cfg) {
  return cfg.modRequest?.projectName || String(cfg.name || '').replace(/\s+/g, '') || 'XyneSpaces';
}

function unquotePbxValue(value) {
  return String(value || '').replace(/^"|"$/g, '');
}

function findMainTarget(project, mainTargetName) {
  const nativeTargets = project.hash.project.objects.PBXNativeTarget || {};
  const targetEntry =
    Object.entries(nativeTargets).find(([, target]) => target?.name === mainTargetName) ||
    Object.entries(nativeTargets).find(
      ([uuid, target]) =>
        !uuid.endsWith('_comment') &&
        target?.productType === '"com.apple.product-type.application"',
    );

  if (!targetEntry) return null;
  return { uuid: targetEntry[0], target: targetEntry[1] };
}

function resourceFileName(objects, buildFileUuid) {
  const fileRefUuid = objects.PBXBuildFile?.[buildFileUuid]?.fileRef;
  return path.basename(unquotePbxValue(objects.PBXFileReference?.[fileRefUuid]?.path));
}

function isBuildFileUsedByAnotherResourcePhase(objects, buildFileUuid, resourcePhaseUuid) {
  return Object.entries(objects.PBXResourcesBuildPhase || {}).some(
    ([uuid, phase]) =>
      uuid !== resourcePhaseUuid &&
      !uuid.endsWith('_comment') &&
      phase?.files?.some(file => file.value === buildFileUuid),
  );
}

function ensureResourceFileOnMainTarget(project, mainTargetName, fileName) {
  const objects = project.hash.project.objects;
  const filePath = `${mainTargetName}/${fileName}`;
  const group = project.pbxGroupByName(mainTargetName);

  const mainTarget = findMainTarget(project, mainTargetName);
  const resourcePhaseRef = mainTarget?.target?.buildPhases?.find(
    phase => phase.comment === 'Resources',
  );
  const resourcePhaseUuid = resourcePhaseRef?.value;
  const resourcePhase = objects.PBXResourcesBuildPhase?.[resourcePhaseUuid];
  if (!resourcePhase) {
    console.warn(`[withNotificationSounds] Could not resolve ${mainTargetName} Resources phase`);
    return;
  }

  let fileRefUuid = null;
  for (const child of group?.children || []) {
    const object = objects.PBXFileReference?.[child.value];
    if (unquotePbxValue(object?.path) === filePath) {
      fileRefUuid = child.value;
      object.lastKnownFileType = 'audio.aiff-core';
      object.name = fileName;
      object.path = filePath;
      object.sourceTree = '"<group>"';
      break;
    }
  }

  if (!fileRefUuid) {
    for (const [uuid, object] of Object.entries(objects.PBXFileReference || {})) {
      const objectPath = unquotePbxValue(object?.path);
      if (objectPath === filePath) {
        fileRefUuid = uuid;
        object.lastKnownFileType = 'audio.aiff-core';
        object.name = fileName;
        object.path = filePath;
        object.sourceTree = '"<group>"';
        break;
      }
    }
  }

  if (!fileRefUuid) {
    fileRefUuid = project.generateUuid();
    objects.PBXFileReference ||= {};
    objects.PBXFileReference[fileRefUuid] = {
      isa: 'PBXFileReference',
      lastKnownFileType: 'audio.aiff-core',
      name: fileName,
      path: filePath,
      sourceTree: '"<group>"',
    };
    objects.PBXFileReference[`${fileRefUuid}_comment`] = fileName;
  }

  const mainGroupEntry = Object.entries(objects.PBXGroup || {}).find(
    ([, candidate]) => candidate === group,
  );
  for (const [groupUuid, candidate] of Object.entries(objects.PBXGroup || {})) {
    if (!candidate?.children || groupUuid.endsWith('_comment')) continue;
    candidate.children = candidate.children.filter(child => {
      const childPath = unquotePbxValue(objects.PBXFileReference?.[child.value]?.path);
      if (childPath !== filePath) return true;
      return groupUuid === mainGroupEntry?.[0] && child.value === fileRefUuid;
    });
  }

  resourcePhase.files ||= [];

  let buildFileUuid = null;
  for (const file of resourcePhase.files) {
    const object = objects.PBXBuildFile?.[file.value];
    if (object?.fileRef === fileRefUuid) {
      buildFileUuid = file.value;
      break;
    }
  }

  if (
    buildFileUuid &&
    isBuildFileUsedByAnotherResourcePhase(objects, buildFileUuid, resourcePhaseUuid)
  ) {
    buildFileUuid = null;
  }

  if (buildFileUuid) {
    const object = objects.PBXBuildFile[buildFileUuid];
    if (object) {
      object.fileRef_comment = fileName;
      objects.PBXBuildFile[`${buildFileUuid}_comment`] = `${fileName} in Resources`;
    }
  }

  if (!buildFileUuid) {
    buildFileUuid = project.generateUuid();
    objects.PBXBuildFile ||= {};
    objects.PBXBuildFile[buildFileUuid] = {
      isa: 'PBXBuildFile',
      fileRef: fileRefUuid,
      fileRef_comment: fileName,
    };
    objects.PBXBuildFile[`${buildFileUuid}_comment`] = `${fileName} in Resources`;
  }

  if (group) {
    group.children ||= [];
    const alreadyInGroup = group.children.some(child => child.value === fileRefUuid);
    if (!alreadyInGroup) {
      group.children.push({ value: fileRefUuid, comment: fileName });
    }
  }

  resourcePhase.files = resourcePhase.files.filter(
    file => resourceFileName(objects, file.value) !== fileName,
  );
  resourcePhase.files.push({ value: buildFileUuid, comment: `${fileName} in Resources` });
}

function withIosNotificationSounds(config) {
  return withXcodeProject(config, cfg => {
    const project = cfg.modResults;
    const mainTargetName = resolveMainTargetName(cfg);
    const mainTarget = findMainTarget(project, mainTargetName);

    if (!mainTarget) {
      console.warn(
        '[withNotificationSounds] Could not resolve main app target; skipping iOS sound resources',
      );
      return cfg;
    }

    for (const id of SOUND_IDS) {
      ensureResourceFileOnMainTarget(project, mainTargetName, `${id}.caf`);
    }

    return cfg;
  });
}

function withAndroidNotificationSounds(config) {
  return withDangerousMod(config, [
    'android',
    cfg => {
      const projectRoot = cfg.modRequest.projectRoot;
      const rawDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'raw',
      );
      fs.mkdirSync(rawDir, { recursive: true });

      for (const id of SOUND_IDS) {
        const src = path.join(projectRoot, 'assets', 'sounds', `${id}.mp3`);
        const dest = path.join(rawDir, `${id}.mp3`);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        } else {
          console.warn(`[withNotificationSounds] Missing assets/sounds/${id}.mp3`);
        }
      }

      return cfg;
    },
  ]);
}

function withCopyIosNotificationSounds(config) {
  return withDangerousMod(config, [
    'ios',
    cfg => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformProjectRoot = cfg.modRequest.platformProjectRoot;
      const targetDir = path.join(platformProjectRoot, resolveMainTargetName(cfg));

      fs.mkdirSync(targetDir, { recursive: true });

      for (const id of SOUND_IDS) {
        const filename = `${id}.caf`;
        const src = path.join(projectRoot, 'assets', 'sounds', filename);
        const dest = path.join(targetDir, filename);

        if (!fs.existsSync(src)) {
          console.warn(
            `[withNotificationSounds] Missing assets/sounds/${filename}. ` +
              `Generate with: afconvert -f caff -d LEI16@44100 -c 1 ` +
              `assets/sounds/${id}.mp3 assets/sounds/${filename}`,
          );
          continue;
        }

        fs.copyFileSync(src, dest);
      }

      return cfg;
    },
  ]);
}

module.exports = function withNotificationSounds(config) {
  config = withCopyIosNotificationSounds(config);
  config = withIosNotificationSounds(config);
  config = withAndroidNotificationSounds(config);
  return config;
};
