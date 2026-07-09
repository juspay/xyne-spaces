import React from 'react';
import { TagGenerationConfig } from '../TagGenerationConfig';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

interface TagsTabProps {
  form: DeskSettingsForm;
}

export const TagsTab: React.FC<TagsTabProps> = ({ form }) => {
  const {
    canManage,
    tagCategories,
    isTagConfigLoading,
    isTagConfigSaving,
    tagConfigError,
    saveTagCategories,
  } = form;

  return (
    <TagGenerationConfig
      canManage={canManage}
      categories={tagCategories}
      isLoading={isTagConfigLoading}
      isSaving={isTagConfigSaving}
      error={tagConfigError}
      saveCategories={saveTagCategories}
    />
  );
};
