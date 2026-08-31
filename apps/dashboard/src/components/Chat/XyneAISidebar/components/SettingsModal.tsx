import { ReactElement, useState, useEffect, useRef } from 'react';
import { apiInstance } from '../../../../services/clients/apiClient';
import { toast } from 'sonner';
import { Edit2, Trash2, Plus, Eye, X } from 'lucide-react';
import { usePlatform } from '../../../../hooks/usePlatform';
import { Button } from '../../../ui/Button/Button';
import { posthogService } from '../../../../services/Analytics/posthogService';

interface Skill {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  isSystem?: boolean;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_INSTRUCTIONS_LENGTH = 10000;
const MAX_CUSTOM_INSTRUCTION_LENGTH = 1000;

export const SettingsModal = ({ isOpen, onClose }: SettingsModalProps): ReactElement | null => {
  const [activeTab, setActiveTab] = useState<'custom' | 'skills'>('custom');
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const instructionSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const { isMobile } = usePlatform();

  // Custom Instructions State
  const [instruction, setInstruction] = useState<string>('');
  const [originalInstruction, setOriginalInstruction] = useState<string>('');
  const [isLoadingInstruction, setIsLoadingInstruction] = useState<boolean>(false);
  const [isSavingInstruction, setIsSavingInstruction] = useState<boolean>(false);
  const [showLengthWarning, setShowLengthWarning] = useState<boolean>(false);

  // Skills State
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState<boolean>(false);
  const [isSavingSkill, setIsSavingSkill] = useState<boolean>(false);
  const [showSkillForm, setShowSkillForm] = useState<boolean>(false);
  const [editingSkillName, setEditingSkillName] = useState<string | null>(null);
  const [skillName, setSkillName] = useState<string>('');
  const [skillDescription, setSkillDescription] = useState<string>('');
  const [skillInstructions, setSkillInstructions] = useState<string>('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [previewingSkill, setPreviewingSkill] = useState<Skill | null>(null);

  // Load data on mount
  useEffect(() => {
    if (isOpen) {
      void loadCustomInstruction();
      void loadSkills();
    }
  }, [isOpen]);

  useEffect(() => {
    if (
      isOpen &&
      activeTab === 'custom' &&
      !isMobile &&
      !isLoadingInstruction &&
      !isSavingInstruction
    ) {
      const rafId = requestAnimationFrame(() => {
        instructionRef.current?.focus();
      });
      return () => cancelAnimationFrame(rafId);
    }

    return undefined;
  }, [isOpen, activeTab, isMobile, isLoadingInstruction, isSavingInstruction]);

  const saveInstructionSelection = (): void => {
    const el = instructionRef.current;
    if (!el) return;
    instructionSelectionRef.current = {
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    };
  };

  useEffect(() => {
    if (activeTab !== 'custom') {
      saveInstructionSelection();
    }
  }, [activeTab]);

  useEffect(() => {
    if (
      activeTab !== 'custom' ||
      isMobile ||
      !isOpen ||
      isLoadingInstruction ||
      isSavingInstruction
    ) {
      return;
    }

    const rafId = requestAnimationFrame(() => {
      const el = instructionRef.current;
      if (!el) return;

      const savedSelection = instructionSelectionRef.current;
      if (savedSelection) {
        const max = el.value.length;
        const start = Math.min(savedSelection.start, max);
        const end = Math.min(savedSelection.end, max);
        el.setSelectionRange(start, end);
        return;
      }

      const cursorAtEnd = el.value.length;
      el.setSelectionRange(cursorAtEnd, cursorAtEnd);
    });

    return () => cancelAnimationFrame(rafId);
  }, [activeTab, isMobile, isOpen, isLoadingInstruction, isSavingInstruction]);

  // Custom Instructions API
  const loadCustomInstruction = async (): Promise<void> => {
    setIsLoadingInstruction(true);
    try {
      const response = await apiInstance.get<{ instruction: string | null }>('/custom-instruction');
      const loadedInstruction = response.data.instruction || '';
      setInstruction(loadedInstruction);
      setOriginalInstruction(loadedInstruction);
      setShowLengthWarning(loadedInstruction.length > MAX_CUSTOM_INSTRUCTION_LENGTH);
    } catch {
      toast.error('Failed to load custom instructions');
    } finally {
      setIsLoadingInstruction(false);
    }
  };

  const handleSaveInstruction = async (): Promise<void> => {
    setIsSavingInstruction(true);
    try {
      await apiInstance.put('/custom-instruction', {
        instruction: instruction.trim() || null,
      });
      setOriginalInstruction(instruction);
      toast.success('Custom instructions saved!');
      posthogService.captureActionOutcome('save_custom_instructions', 'success');
      onClose();
    } catch {
      toast.error('Failed to save custom instructions');
      posthogService.captureActionOutcome('save_custom_instructions', 'failure');
    } finally {
      setIsSavingInstruction(false);
    }
  };

  const handleClearInstruction = async (): Promise<void> => {
    if (!window.confirm('Are you sure you want to clear your custom instructions?')) {
      return;
    }

    setIsSavingInstruction(true);
    try {
      await apiInstance.delete('/custom-instruction');
      setInstruction('');
      setOriginalInstruction('');
      toast.success('Custom instructions cleared');
      posthogService.captureActionOutcome('clear_custom_instructions', 'success');
    } catch {
      toast.error('Failed to clear custom instructions');
      posthogService.captureActionOutcome('clear_custom_instructions', 'failure');
    } finally {
      setIsSavingInstruction(false);
    }
  };

  // Skills API
  const loadSkills = async (): Promise<void> => {
    setIsLoadingSkills(true);
    try {
      const response = await apiInstance.get<{ skills: Skill[] }>('/user-skills');
      setSkills(response.data.skills || []);
    } catch {
      // Silent fail - skills might not be implemented yet
    } finally {
      setIsLoadingSkills(false);
    }
  };

  const resetSkillForm = (): void => {
    setSkillName('');
    setSkillDescription('');
    setSkillInstructions('');
    setEditingSkillName(null);
    setNameError(null);
    setShowSkillForm(false);
    setPreviewingSkill(null);
  };

  const handleAddNewSkill = (): void => {
    resetSkillForm();
    setShowSkillForm(true);
  };

  // Check for duplicate name while typing (only when creating new skill)
  const handleNameChange = (value: string): void => {
    setSkillName(value);

    // Only check duplicates when creating new skill (not editing)
    if (editingSkillName) return;

    const trimmedValue = value.trim();
    if (!trimmedValue) {
      setNameError(null);
      return;
    }

    // Check if name already exists (case-insensitive)
    const isDuplicate = skills.some(
      skill => skill.name.toLowerCase() === trimmedValue.toLowerCase(),
    );

    if (isDuplicate) {
      setNameError(`A skill with the name "${trimmedValue}" already exists`);
    } else {
      setNameError(null);
    }
  };

  const handleEditSkill = (skill: Skill): void => {
    if (skill.isSystem) return;
    setSkillName(skill.name);
    setSkillDescription(skill.description);
    setSkillInstructions(skill.instructions);
    setEditingSkillName(skill.name);
    setShowSkillForm(true);
  };

  const handleSaveSkill = async (): Promise<void> => {
    // Client-side validation
    const trimmedName = skillName.trim();
    const trimmedDescription = skillDescription.trim();
    const trimmedInstructions = skillInstructions.trim();

    if (!trimmedName) {
      toast.error('Name is required');
      return;
    }
    if (!trimmedDescription) {
      toast.error('Description is required');
      return;
    }
    if (!trimmedInstructions) {
      toast.error('Instructions are required');
      return;
    }

    setIsSavingSkill(true);
    try {
      const skillData = {
        name: trimmedName,
        description: trimmedDescription,
        instructions: trimmedInstructions,
      };

      if (editingSkillName) {
        // Encode skill name for URL
        await apiInstance.put(`/user-skills/${encodeURIComponent(editingSkillName)}`, skillData);
        toast.success('Skill updated!');
      } else {
        await apiInstance.post('/user-skills', skillData);
        toast.success('Skill created!');
      }

      await loadSkills();
      resetSkillForm();
      posthogService.captureActionOutcome(
        editingSkillName ? 'update_skill' : 'create_skill',
        'success',
      );
    } catch (error: unknown) {
      // Show specific error message from backend
      const errorMessage = error instanceof Error ? error.message : 'Failed to save skill';
      toast.error(errorMessage);
      posthogService.captureActionOutcome(
        editingSkillName ? 'update_skill' : 'create_skill',
        'failure',
      );
    } finally {
      setIsSavingSkill(false);
    }
  };

  const handleDeleteSkill = async (skillName: string): Promise<void> => {
    if (!window.confirm('Are you sure you want to delete this skill?')) {
      return;
    }

    setIsSavingSkill(true);
    try {
      await apiInstance.delete(`/user-skills/${encodeURIComponent(skillName)}`);
      await loadSkills();
      toast.success('Skill deleted');
      posthogService.captureActionOutcome('delete_skill', 'success');
    } catch {
      toast.error('Failed to delete skill');
      posthogService.captureActionOutcome('delete_skill', 'failure');
    } finally {
      setIsSavingSkill(false);
    }
  };

  const handleToggleEnableSkill = async (skillName: string, enabled: boolean): Promise<void> => {
    try {
      await apiInstance.patch(`/user-skills/${encodeURIComponent(skillName)}/enable`, {
        enabled: !enabled,
      });
      await loadSkills();
    } catch {
      toast.error('Failed to update skill');
    }
  };

  if (!isOpen) return null;

  const isSaving = isSavingInstruction || isSavingSkill;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-popover rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col'>
        {/* Header with Tabs */}
        <div className='flex items-center justify-between p-6 border-b border-border'>
          <div className='flex items-center gap-4'>
            <h2 className='text-xl font-semibold text-foreground'>Settings</h2>
            {/* Tab Slider */}
            <div className='flex items-center bg-muted rounded-lg p-1'>
              <button
                onClick={() => {
                  setActiveTab('custom');
                  setShowSkillForm(false);
                  setPreviewingSkill(null);
                }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                  activeTab === 'custom'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                data-track-category='XyneAI'
                data-track-name='SwitchToCustomInstructionsTab'
              >
                Custom Instructions
              </button>
              <button
                onClick={() => {
                  setActiveTab('skills');
                  setShowSkillForm(false);
                  setPreviewingSkill(null);
                }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                  activeTab === 'skills'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                data-track-category='XyneAI'
                data-track-name='SwitchToSkillsTab'
              >
                Skills
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className='p-2 rounded-lg hover:bg-accent transition-colors'
            disabled={isSaving}
            data-track-category='XyneAI'
            data-track-name='CloseSettingsModal'
          >
            <X size={16} className='text-current' />
          </button>
        </div>

        {/* Content */}
        <div className='p-6 overflow-y-auto flex-1'>
          {activeTab === 'custom' ? (
            // Custom Instructions Content
            <div className='space-y-4'>
              {/* Length Warning */}
              {showLengthWarning && (
                <div className='p-3 bg-muted border border-border rounded-lg'>
                  <p className='text-sm text-status-pending'>
                    <span className='font-semibold'>Warning:</span> Your custom instructions exceed
                    the {MAX_CUSTOM_INSTRUCTION_LENGTH} character limit. Please edit your content to
                    fit within the limit before saving.
                  </p>
                </div>
              )}

              <div>
                <label
                  htmlFor='instruction'
                  className='block text-sm font-medium text-foreground mb-2'
                >
                  Instructions
                </label>
                <textarea
                  ref={instructionRef}
                  id='instruction'
                  value={instruction}
                  onChange={e => {
                    setInstruction(e.target.value.slice(0, MAX_CUSTOM_INSTRUCTION_LENGTH));
                    saveInstructionSelection();
                  }}
                  onSelect={saveInstructionSelection}
                  onKeyUp={saveInstructionSelection}
                  onClick={saveInstructionSelection}
                  placeholder={
                    isLoadingInstruction
                      ? 'Loading...'
                      : 'Additional behavior, style, and tone preferences'
                  }
                  className='w-full h-48 bg-background px-3 py-2 border border-border rounded-lg resize-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:bg-muted disabled:text-muted-foreground'
                  disabled={isSavingInstruction || isLoadingInstruction}
                  data-track-category='XyneAI'
                  data-track-name='EditCustomInstructions'
                />
                <div className='flex justify-end mt-1'>
                  <span
                    className={`text-xs ${instruction.length >= MAX_CUSTOM_INSTRUCTION_LENGTH ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {instruction.length}/{MAX_CUSTOM_INSTRUCTION_LENGTH}
                  </span>
                </div>
              </div>
            </div>
          ) : previewingSkill ? (
            // System Skill Preview (read-only)
            <div className='space-y-4'>
              <p className='text-xs text-muted-foreground'>
                Note: This skill is managed by the system and cannot be edited.
              </p>
              <div>
                <label
                  htmlFor='preview-skill-name'
                  className='block text-sm font-medium text-foreground mb-2'
                >
                  Name
                </label>
                <input
                  id='preview-skill-name'
                  type='text'
                  value={previewingSkill.name}
                  readOnly
                  className='w-full px-3 py-2 border border-border rounded-lg text-sm bg-muted text-muted-foreground cursor-default'
                  data-track-category='XyneAI'
                  data-track-name='PreviewSkillName'
                />
              </div>
              <div>
                <label
                  htmlFor='preview-skill-description'
                  className='block text-sm font-medium text-foreground mb-2'
                >
                  Description
                </label>
                <textarea
                  id='preview-skill-description'
                  value={previewingSkill.description}
                  readOnly
                  rows={3}
                  className='w-full px-3 py-2 border border-border rounded-lg resize-none text-sm bg-muted text-muted-foreground cursor-default'
                  data-track-category='XyneAI'
                  data-track-name='PreviewSkillDescription'
                />
              </div>
              <div>
                <label
                  htmlFor='preview-skill-instructions'
                  className='block text-sm font-medium text-foreground mb-2'
                >
                  Instructions
                </label>
                <textarea
                  id='preview-skill-instructions'
                  value={previewingSkill.instructions}
                  readOnly
                  rows={10}
                  className='w-full px-3 py-2 border border-border rounded-lg resize-none text-sm bg-muted text-muted-foreground cursor-default'
                  data-track-category='XyneAI'
                  data-track-name='PreviewSkillInstructions'
                />
              </div>
            </div>
          ) : showSkillForm ? (
            // Skill Form Content
            <div className='space-y-4'>
              {/* Name Field */}
              <div>
                <label
                  htmlFor='skill-name'
                  className='block text-sm font-medium text-foreground mb-2'
                >
                  Name
                </label>
                <input
                  id='skill-name'
                  type='text'
                  value={skillName}
                  autoFocus={!isMobile}
                  onChange={e => handleNameChange(e.target.value.slice(0, MAX_NAME_LENGTH))}
                  placeholder='Enter skill name'
                  className={`w-full bg-background px-3 py-2 border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 disabled:bg-muted disabled:text-muted-foreground ${
                    nameError
                      ? 'border-destructive focus:ring-destructive/20'
                      : 'border-border focus:ring-ring'
                  }`}
                  disabled={isSavingSkill || !!editingSkillName}
                  title={editingSkillName ? 'Skill name cannot be changed after creation' : ''}
                  data-track-category='XyneAI'
                  data-track-name='EditSkillName'
                />
                {nameError && <p className='text-xs text-destructive mt-1'>{nameError}</p>}
                {editingSkillName && !nameError && (
                  <p className='text-xs text-muted-foreground mt-1'>
                    Skill name cannot be changed after creation
                  </p>
                )}
                <div className='flex justify-end mt-1'>
                  <span
                    className={`text-xs ${skillName.length >= MAX_NAME_LENGTH ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {skillName.length}/{MAX_NAME_LENGTH}
                  </span>
                </div>
              </div>

              {/* Description Field */}
              <div>
                <label
                  htmlFor='skill-description'
                  className='block text-sm font-medium text-foreground mb-2'
                >
                  Description
                </label>
                <textarea
                  id='skill-description'
                  value={skillDescription}
                  onChange={e =>
                    setSkillDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))
                  }
                  placeholder='Brief description of what this skill does'
                  rows={3}
                  className='w-full bg-background px-3 py-2 border border-border rounded-lg resize-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted disabled:text-muted-foreground'
                  disabled={isSavingSkill}
                  data-track-category='XyneAI'
                  data-track-name='EditSkillDescription'
                />
                <div className='flex justify-end mt-1'>
                  <span
                    className={`text-xs ${skillDescription.length >= MAX_DESCRIPTION_LENGTH ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {skillDescription.length}/{MAX_DESCRIPTION_LENGTH}
                  </span>
                </div>
              </div>

              {/* Instructions Field */}
              <div>
                <label
                  htmlFor='skill-instructions'
                  className='block text-sm font-medium text-foreground mb-2'
                >
                  Instructions
                </label>
                <textarea
                  id='skill-instructions'
                  value={skillInstructions}
                  onChange={e =>
                    setSkillInstructions(e.target.value.slice(0, MAX_INSTRUCTIONS_LENGTH))
                  }
                  placeholder='Detailed instructions for how the AI should behave when using this skill'
                  rows={6}
                  className='w-full bg-background px-3 py-2 border border-border rounded-lg resize-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted disabled:text-muted-foreground'
                  disabled={isSavingSkill}
                  data-track-category='XyneAI'
                  data-track-name='EditSkillInstructions'
                />
                <div className='flex justify-end mt-1'>
                  <span
                    className={`text-xs ${skillInstructions.length >= MAX_INSTRUCTIONS_LENGTH ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {skillInstructions.length}/{MAX_INSTRUCTIONS_LENGTH}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            // Skills List Content
            <div className='space-y-4'>
              {/* Add New Button */}
              <div className='flex justify-end'>
                <button
                  onClick={() => handleAddNewSkill()}
                  className='flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-action-primary-foreground bg-action-primary hover:bg-action-primary/90 rounded-lg transition-colors'
                  disabled={isLoadingSkills}
                  data-track-category='XyneAI'
                  data-track-name='AddNewSkill'
                >
                  <Plus size={16} />
                  New Skill
                </button>
              </div>

              {/* Skills List */}
              {skills.length === 0 ? (
                <div className='text-center py-12 border border-dashed border-border rounded-lg'>
                  <p className='text-sm text-muted-foreground'>No skills configured</p>
                  <p className='text-xs text-muted-foreground mt-1'>
                    Add a skill to customize AI behavior for specific tasks
                  </p>
                </div>
              ) : (
                <div className='space-y-2'>
                  {skills.map(skill => (
                    <div
                      key={skill.name}
                      className='flex items-center justify-between p-3 border border-border rounded-lg hover:bg-accent/50 transition-colors group'
                    >
                      <div className='flex items-center gap-3 flex-1 min-w-0'>
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${skill.enabled ? 'bg-status-success' : 'bg-muted-foreground/30'}`}
                        />
                        <span className='text-sm font-medium text-foreground truncate'>
                          {skill.name}
                        </span>
                      </div>
                      {skill.isSystem ? (
                        <div className='flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity'>
                          <button
                            onClick={() => setPreviewingSkill(skill)}
                            className='p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors'
                            title='View'
                            data-track-category='XyneAI'
                            data-track-name='PreviewSystemSkill'
                          >
                            <Eye size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className='flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity'>
                          <label
                            className='relative inline-flex items-center cursor-pointer'
                            data-track-category='XyneAI'
                            data-track-name='ToggleSkillEnabled'
                          >
                            <input
                              type='checkbox'
                              checked={skill.enabled}
                              onChange={() => {
                                void handleToggleEnableSkill(skill.name, skill.enabled);
                              }}
                              className='sr-only peer'
                              data-track-category='XyneAI'
                              data-track-name='ToggleSkillCheckbox'
                            />
                            <div className="w-9 h-5 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-background after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-action-primary"></div>
                            <span className='ml-2 text-xs text-muted-foreground'>
                              {skill.enabled ? 'On' : 'Off'}
                            </span>
                          </label>
                          <button
                            onClick={() => handleEditSkill(skill)}
                            className='p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors'
                            title='Edit'
                            data-track-category='XyneAI'
                            data-track-name='EditSkill'
                          >
                            <Edit2 size={16} />
                          </button>
                          <Button
                            variant='ghost'
                            onClick={() => {
                              void handleDeleteSkill(skill.name);
                            }}
                            trackId='delete_skill'
                            className='p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors'
                            title='Delete'
                            data-track-category='XyneAI'
                            data-track-name='DeleteSkill'
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between p-6 border-t border-border'>
          {activeTab === 'custom' ? (
            // Custom Instructions Footer
            <>
              <Button
                variant='ghost'
                onClick={() => void handleClearInstruction()}
                trackId='clear_custom_instructions'
                className='px-4 py-2 text-sm font-medium text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors'
                disabled={isSavingInstruction || isLoadingInstruction || !instruction}
                data-track-category='XyneAI'
                data-track-name='ClearCustomInstructions'
              >
                Clear
              </Button>
              <div className='flex gap-2'>
                <button
                  onClick={onClose}
                  className='px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors'
                  disabled={isSaving}
                  data-track-category='XyneAI'
                  data-track-name='CancelCustomInstructions'
                >
                  Cancel
                </button>
                <Button
                  variant='ghost'
                  onClick={() => void handleSaveInstruction()}
                  trackId='save_custom_instructions'
                  className='px-4 py-2 text-sm font-medium text-action-primary-foreground bg-action-primary hover:bg-action-primary/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                  disabled={
                    isSavingInstruction ||
                    isLoadingInstruction ||
                    instruction.trim() === originalInstruction.trim()
                  }
                  data-track-category='XyneAI'
                  data-track-name='SaveCustomInstructions'
                >
                  {isSavingInstruction ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </>
          ) : previewingSkill ? (
            // System Skill Preview Footer
            <>
              <div />
              <button
                onClick={() => setPreviewingSkill(null)}
                className='px-4 py-2 text-sm font-medium text-action-primary-foreground bg-action-primary hover:bg-action-primary/90 rounded-lg transition-colors'
                data-track-category='XyneAI'
                data-track-name='CloseSystemSkillPreview'
              >
                Close
              </button>
            </>
          ) : showSkillForm ? (
            // Skill Form Footer
            <>
              <button
                onClick={() => resetSkillForm()}
                className='px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors'
                disabled={isSavingSkill}
                data-track-category='XyneAI'
                data-track-name='CancelSkillForm'
              >
                Cancel
              </button>
              <Button
                variant='ghost'
                onClick={() => void handleSaveSkill()}
                trackId={editingSkillName ? 'update_skill' : 'create_skill'}
                className='px-4 py-2 text-sm font-medium text-action-primary-foreground bg-action-primary hover:bg-action-primary/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                disabled={isSavingSkill || !skillName.trim() || !!nameError}
                data-track-category='XyneAI'
                data-track-name={editingSkillName ? 'UpdateSkill' : 'CreateSkill'}
              >
                {isSavingSkill ? 'Saving...' : editingSkillName ? 'Update' : 'Save'}
              </Button>
            </>
          ) : (
            // Skills List Footer
            <>
              <div /> {/* Spacer */}
              <button
                onClick={onClose}
                className='px-4 py-2 text-sm font-medium text-action-primary-foreground bg-action-primary hover:bg-action-primary/90 rounded-lg transition-colors'
                data-track-category='XyneAI'
                data-track-name='CloseSettingsModal'
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
