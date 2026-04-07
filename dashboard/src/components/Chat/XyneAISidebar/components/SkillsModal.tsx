import { ReactElement, useState, useEffect } from 'react';
import { apiInstance } from '../../../../services/clients/apiClient';
import { toast } from 'sonner';
import { Edit2, Trash2, Plus, Eye } from 'lucide-react';

interface Skill {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  isSystem?: boolean;
}

interface SkillsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_INSTRUCTIONS_LENGTH = 10000;

export const SkillsModal = ({ isOpen, onClose }: SkillsModalProps): ReactElement | null => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Form state for adding/editing
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editingSkillName, setEditingSkillName] = useState<string | null>(null);
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [instructions, setInstructions] = useState<string>('');

  // Load skills on mount
  useEffect(() => {
    if (isOpen) {
      void loadSkills();
    }
  }, [isOpen]);

  const loadSkills = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const response = await apiInstance.get<{ skills: Skill[] }>('/user-skills');
      setSkills(response.data.skills || []);
    } catch {
      toast.error('Failed to load skills');
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = (): void => {
    setName('');
    setDescription('');
    setInstructions('');
    setEditingSkillName(null);
    setShowForm(false);
  };

  const handleAddNew = (): void => {
    resetForm();
    setShowForm(true);
  };

  const handleEdit = (skill: Skill): void => {
    if (skill.isSystem) return;
    setName(skill.name);
    setDescription(skill.description);
    setInstructions(skill.instructions);
    setEditingSkillName(skill.name);
    setShowForm(true);
  };

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      const skillData = {
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
      };

      if (editingSkillName) {
        // Update existing skill
        await apiInstance.put(`/user-skills/${editingSkillName}`, skillData);
        toast.success('Skill updated!');
      } else {
        // Create new skill
        await apiInstance.post('/user-skills', skillData);
        toast.success('Skill created!');
      }

      await loadSkills();
      resetForm();
    } catch {
      toast.error('Failed to save skill');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (skillName: string): Promise<void> => {
    if (!window.confirm('Are you sure you want to delete this skill?')) {
      return;
    }

    setIsSaving(true);
    try {
      await apiInstance.delete(`/user-skills/${skillName}`);
      await loadSkills();
      toast.success('Skill deleted');
    } catch {
      toast.error('Failed to delete skill');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnable = async (skillName: string, enabled: boolean): Promise<void> => {
    try {
      await apiInstance.patch(`/user-skills/${skillName}/enable`, { enabled: !enabled });
      await loadSkills();
    } catch {
      toast.error('Failed to update skill');
    }
  };

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50'>
      <div className='bg-popover rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between p-6 border-b border-border'>
          <h2 className='text-xl font-semibold text-foreground'>Skills</h2>
          <button
            onClick={onClose}
            className='p-2 rounded-lg hover:bg-accent transition-colors'
            disabled={isSaving}
            data-track-category='XYNE_AI'
            data-track-name='CloseSkillsModal'
          >
            <img src='/svgs/icons/close.svg' alt='Close' width='16' height='16' />
          </button>
        </div>

        {/* Content */}
        <div className='p-6 overflow-y-auto flex-1'>
          {showForm ? (
            // Form View
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
                  value={name}
                  onChange={e => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
                  placeholder='Enter skill name'
                  className='w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-sm'
                  disabled={isSaving}
                  data-track-category='XYNE_AI'
                  data-track-name='EditSkillName'
                />
                <div className='flex justify-end mt-1'>
                  <span
                    className={`text-xs ${name.length >= MAX_NAME_LENGTH ? 'text-red-500' : 'text-muted-foreground'}`}
                  >
                    {name.length}/{MAX_NAME_LENGTH}
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
                  value={description}
                  onChange={e => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
                  placeholder='Brief description of what this skill does'
                  rows={3}
                  className='w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none text-sm'
                  disabled={isSaving}
                  data-track-category='XYNE_AI'
                  data-track-name='EditSkillDescription'
                />
                <div className='flex justify-end mt-1'>
                  <span
                    className={`text-xs ${description.length >= MAX_DESCRIPTION_LENGTH ? 'text-red-500' : 'text-muted-foreground'}`}
                  >
                    {description.length}/{MAX_DESCRIPTION_LENGTH}
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
                  value={instructions}
                  onChange={e => setInstructions(e.target.value.slice(0, MAX_INSTRUCTIONS_LENGTH))}
                  placeholder='Detailed instructions for how the AI should behave when using this skill'
                  rows={6}
                  className='w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none text-sm'
                  disabled={isSaving}
                  data-track-category='XYNE_AI'
                  data-track-name='EditSkillInstructions'
                />
                <div className='flex justify-end mt-1'>
                  <span
                    className={`text-xs ${instructions.length >= MAX_INSTRUCTIONS_LENGTH ? 'text-red-500' : 'text-muted-foreground'}`}
                  >
                    {instructions.length}/{MAX_INSTRUCTIONS_LENGTH}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            // List View
            <div className='space-y-4'>
              {/* Add New Button */}
              <div className='flex justify-end'>
                <button
                  onClick={() => handleAddNew()}
                  className='flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors'
                  disabled={isLoading}
                  data-track-category='XYNE_AI'
                  data-track-name='AddNewSkill'
                >
                  <Plus size={16} />
                  New Skill
                </button>
              </div>

              {/* Skills List */}
              {isLoading ? (
                <div className='text-center py-8 text-muted-foreground'>Loading...</div>
              ) : skills.length === 0 ? (
                <div className='text-center py-12 border border-dashed border-border rounded-lg'>
                  <p className='text-sm text-muted-foreground'>No skills configured</p>
                  <p className='text-xs text-muted-foreground mt-1'>
                    Add a skill to customize AI behavior for specific tasks
                  </p>
                </div>
              ) : (
                <div className='space-y-2 max-h-64 overflow-y-auto'>
                  {skills.map(skill => (
                    <div
                      key={skill.name}
                      className='flex items-center justify-between p-3 border border-border rounded-lg hover:bg-accent/50 transition-colors group'
                    >
                      <div className='flex items-center gap-3 flex-1 min-w-0'>
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${skill.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                        />
                        <span className='text-sm font-medium text-foreground truncate'>
                          {skill.name}
                        </span>
                        {skill.isSystem && (
                          <span className='flex-shrink-0 px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded'>
                            System
                          </span>
                        )}
                      </div>
                      {skill.isSystem ? (
                        <Eye size={15} className='flex-shrink-0 text-muted-foreground' />
                      ) : (
                        <div className='flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity'>
                          <button
                            onClick={() => {
                              void handleToggleEnable(skill.name, skill.enabled);
                            }}
                            className={`px-2 py-1 text-xs rounded-md transition-colors ${
                              skill.enabled
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                            title={skill.enabled ? 'Disable' : 'Enable'}
                            data-track-category='XYNE_AI'
                            data-track-name='ToggleSkillEnabled'
                          >
                            {skill.enabled ? 'Enabled' : 'Disabled'}
                          </button>
                          <button
                            onClick={() => handleEdit(skill)}
                            className='p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors'
                            title='Edit'
                            data-track-category='XYNE_AI'
                            data-track-name='EditSkill'
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => {
                              void handleDelete(skill.name);
                            }}
                            className='p-1.5 rounded-md hover:bg-red-100 text-muted-foreground hover:text-red-600 transition-colors'
                            title='Delete'
                            data-track-category='XYNE_AI'
                            data-track-name='DeleteSkill'
                          >
                            <Trash2 size={16} />
                          </button>
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
          {showForm ? (
            // Form Footer
            <>
              <button
                onClick={() => resetForm()}
                className='px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors'
                disabled={isSaving}
                data-track-category='XYNE_AI'
                data-track-name='CancelSkillForm'
              >
                Cancel
              </button>
              <div className='flex gap-2'>
                <button
                  onClick={() => void handleSave()}
                  className='px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                  disabled={isSaving || !name.trim()}
                  data-track-category='XYNE_AI'
                  data-track-name='SaveSkill'
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            // List Footer
            <>
              <div /> {/* Spacer */}
              <button
                onClick={onClose}
                className='px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors'
                data-track-category='XYNE_AI'
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
