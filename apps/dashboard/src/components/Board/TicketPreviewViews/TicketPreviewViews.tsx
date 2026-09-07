import { ReactElement, useMemo, useState } from 'react';
import {
  X,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Folder,
  Users,
  Plus,
  Calendar,
  Paperclip,
  Ticket,
  List,
} from 'lucide-react';
import { FormContextType, FormEntityType, BaseTicketType } from '@xyne/shared';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { mapFromFormFieldType } from '../BoardEditScreen/BoardEditScreen.types';
import { Button } from '../../../components/ui/Button';
import type {
  PreviewField,
  CreateField,
  TicketPreviewContentProps,
  CreateTicketModalProps,
  TicketPreviewProps,
} from './TicketPreviewViews.types';
import {
  renderPreviewFieldValue,
  getDefaultPreviewFields,
  getDefaultCreateFields,
} from '../../../utils/board';
import { resolveDisplayFormFields } from '../../../utils/board/resolveDisplayFormFields';

// Ticket Preview Content Component (used in right panel)
const TicketPreviewContent = ({
  ticket,
  boardId,
  fields: externalFields,
}: TicketPreviewContentProps): ReactElement => {
  const [showAllFields, setShowAllFields] = useState(false);

  // Fetch real custom fields from form mapping (like BoardEditScreen)
  const [formMapping] = useCachedQuery(
    queries.getFormMappingByContextId({
      contextId: boardId || '',
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: !!boardId && !externalFields },
  );

  // Build fields list - use external fields if provided, otherwise default + custom from form mapping
  const allFields = useMemo((): PreviewField[] => {
    if (externalFields) {
      return externalFields;
    }

    const defaultFields = getDefaultPreviewFields();

    const resolvedFormFields = formMapping?.formFields
      ? resolveDisplayFormFields(formMapping.formId, [...formMapping.formFields])
      : [];

    if (resolvedFormFields.length > 0) {
      const customFields = resolvedFormFields.map(field => ({
        id: field.id,
        label: field.fieldName,
        type: mapFromFormFieldType(field.fieldType),
        options: field.fieldEnum ?? [],
        required: !field.isOptional,
      }));
      return [...defaultFields, ...customFields];
    }

    return defaultFields;
  }, [formMapping, externalFields]);

  // Always show first 8 fields, remaining fields shown after Show More button
  const firstFields = allFields.slice(0, 8);
  const remainingFields = allFields.slice(8);

  return (
    <div className='flex flex-col w-full p-6'>
      <div className='pb-[16px] pt-[20px]'>
        <div className='flex flex-col gap-[12px]'>
          <h2 className='text-[20px] font-semibold text-foreground leading-[26px] overflow-hidden text-ellipsis whitespace-nowrap'>
            {ticket?.title || 'This is a ticket preview'}
          </h2>
          <p className='text-[16px] text-muted-foreground leading-[22px]'>
            {ticket?.description ||
              'This is where your users would add a detailed description of their issues. One can add attachments & drop links in here as well. We encourage users to be as descriptive about the issues as they can.'}
          </p>
        </div>

        <div className='flex flex-col mt-[32px]'>
          {/* User Group Field */}
          <div className='flex gap-[66px] items-center pr-[40px] py-[8px] max-w-prose border-b border-border'>
            <div className='min-w-[140px] max-w-[140px]'>
              <p className='text-[14px] font-medium text-muted-foreground leading-[20px]'>
                User Group
              </p>
            </div>
            <div className='flex items-center gap-[6px]'>
              <div className='inline-flex items-center gap-1.5 text-[14px] rounded-lg transition-colors bg-background border border-border hover:bg-muted px-2 h-[30px] cursor-pointer'>
                <Users size={14} className='text-muted-foreground' />
                <span className='text-foreground'>{ticket?.userGroup || 'Support Team'}</span>
              </div>
            </div>
          </div>

          {/* Tags Field */}
          <div className='flex gap-[66px] items-center pr-[40px] py-[8px] max-w-prose border-b border-border'>
            <div className='min-w-[140px] max-w-[140px]'>
              <p className='text-[14px] font-medium text-muted-foreground leading-[20px]'>Labels</p>
            </div>
            <div className='flex items-center gap-[6px]'>
              <div className='flex items-center gap-2 flex-wrap'>
                {(ticket?.tagMappings && ticket.tagMappings.length > 0
                  ? ticket.tagMappings
                  : [
                      { tagName: 'Bug', color: 'bg-cyan-400' },
                      { tagName: 'Feature', color: 'bg-purple-400' },
                    ]
                ).map((tag, idx) => {
                  const tagName = 'tagName' in tag ? tag.tagName : '';
                  const tagColor =
                    'color' in tag ? (tag as { color: string }).color : 'bg-cyan-400';
                  return (
                    <span
                      key={idx}
                      className='inline-flex items-center gap-1.5 px-2 py-1 text-sm font-medium rounded-[6px] border border-border bg-muted/50'
                    >
                      <div className={`w-2 h-2 rounded-full ${tagColor}`}></div>
                      {tagName}
                      <Button
                        variant='ghost'
                        size='iconSm'
                        className='ml-1 p-0.5 h-5 w-5'
                        aria-label='Remove label'
                      >
                        <X size={12} />
                      </Button>
                    </span>
                  );
                })}
                <Button variant='ghost' size='sm' className='text-gray-600 hover:text-gray-900'>
                  <Plus size={14} />
                  <span>Add</span>
                </Button>
              </div>
            </div>
          </div>

          {/* First 8 Fields - Always shown */}
          {firstFields.map(field => (
            <div
              key={field.id}
              className='flex gap-[66px] items-center pr-[40px] py-[8px] max-w-prose border-b border-border'
            >
              <div className='min-w-[140px] max-w-[140px]'>
                <p className='text-[14px] font-medium text-muted-foreground leading-[20px]'>
                  {field.label}
                  {field.required && <span className='text-red-500'>*</span>}
                </p>
              </div>
              <div className='flex items-center gap-[6px]'>{renderPreviewFieldValue(field)}</div>
            </div>
          ))}

          {/* Show More/Show Less - Fixed position after first 8 fields */}
          {allFields.length > 10 && (
            <div className='flex items-center py-[8px]'>
              {!showAllFields ? (
                <button
                  onClick={() => setShowAllFields(true)}
                  className='flex items-center gap-[6px] py-[4px] text-[13px] font-[450] text-muted-foreground leading-[1.2] tracking-[-0.1px] hover:text-muted-foreground transition-colors cursor-pointer bg-transparent border-0'
                  data-track-category='BOARD_CREATE'
                  data-track-name='ShowMoreFields'
                >
                  Show More ({remainingFields.length} more fields)
                  <ChevronDown size={16} />
                </button>
              ) : (
                <button
                  onClick={() => setShowAllFields(false)}
                  className='flex items-center gap-[6px] py-[4px] text-[13px] font-[450] text-muted-foreground leading-[1.2] tracking-[-0.1px] hover:text-muted-foreground transition-colors cursor-pointer bg-transparent border-0'
                  data-track-category='BOARD_CREATE'
                  data-track-name='ShowLessFields'
                >
                  Show Less
                  <ChevronUp size={16} />
                </button>
              )}
            </div>
          )}

          {/* Remaining Fields - Only shown when Show More is clicked */}
          {showAllFields &&
            remainingFields.map(field => (
              <div
                key={field.id}
                className='flex gap-[66px] items-center pr-[40px] py-[8px] max-w-prose border-b border-border'
              >
                <div className='min-w-[140px] max-w-[140px]'>
                  <p className='text-[14px] font-medium text-muted-foreground leading-[20px]'>
                    {field.label}
                    {field.required && <span className='text-red-500'>*</span>}
                  </p>
                </div>
                <div className='flex items-center gap-[6px]'>{renderPreviewFieldValue(field)}</div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

// Create Ticket Modal Component - Based on BoardEditScreen
const CreateTicketModal = ({
  boardId,
  fields: externalFields,
}: CreateTicketModalProps): ReactElement => {
  // Fetch form mapping for dynamic fields
  const [formMapping] = useCachedQuery(
    queries.getFormMappingByContextId({
      contextId: boardId || '',
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: !!boardId && !externalFields },
  );

  // Build fields from form mapping (same as BoardEditScreen)
  const fields = useMemo((): CreateField[] => {
    if (externalFields) {
      return externalFields;
    }

    const defaultFields = getDefaultCreateFields();

    const resolvedFormFields = formMapping?.formFields
      ? resolveDisplayFormFields(formMapping.formId, [...formMapping.formFields])
      : [];

    if (resolvedFormFields.length > 0) {
      const customFields: CreateField[] = resolvedFormFields.map((field, idx: number) => ({
        id: field.id,
        name: field.fieldName,
        label: field.fieldName,
        type: mapFromFormFieldType(field.fieldType),
        required: !field.isOptional,
        order: defaultFields.length + idx + 1,
        visibleInCreate: true,
        options: field.fieldEnum ?? [],
      }));
      return [...defaultFields, ...customFields];
    }

    return defaultFields;
  }, [formMapping, externalFields]);

  return (
    <div className='bg-background border border-border rounded-[12px] w-[607px] max-h-[85vh] flex flex-col overflow-hidden mx-auto my-auto shadow-lg'>
      {/* Modal Header */}
      <div className='bg-background flex items-center justify-between pb-[4px] pt-[16px] px-[16px]'>
        <div className='flex items-center pl-[2px] pr-[4px]'>
          <p className='text-[13px] font-medium text-muted-foreground leading-[20px] px-[2px] py-[8px]'>
            New ticket
          </p>
        </div>
        <Button
          variant='ghost'
          size='iconSm'
          className='w-[24px] h-[24px] border border-border rounded-[4px]'
        >
          <X size={12} className='text-muted-foreground' />
        </Button>
      </div>

      {/* Modal Body */}
      <div className='bg-background flex flex-col gap-[12px] pb-[16px] pt-[12px] px-[20px] overflow-y-auto max-h-[calc(100vh-120px)]'>
        {/* Title and Description */}
        <div className='flex flex-col gap-[16px] pb-[12px]'>
          <p className='text-[17px] font-semibold text-foreground leading-[20px]'>
            Create a new ticket
          </p>
          <p className='text-[16px] font-normal text-muted-foreground leading-[22px]'>
            This is where your users would add a detailed description of their issues. One can add
            attachments & drop links in here as well. We encourage users to be as descriptive about
            the issues as they can.
          </p>
        </div>

        {/* Select Board Dropdown */}
        <div className='bg-background border border-border rounded-[6px] flex items-center py-[2px] w-fit'>
          <div className='flex gap-[8px] items-center px-[10px] py-[5px] rounded-[6px]'>
            <LayoutGrid size={14} className='text-muted-foreground' />
            <p className='text-[13px] font-medium text-foreground leading-[18px] tracking-[-0.2px]'>
              {'Select Board'}
            </p>
            <ChevronDown size={16} className='text-muted-foreground' />
          </div>
        </div>

        {/* Fields Table */}
        <div className='flex flex-col overflow-hidden max-h-[580px] overflow-y-auto scrollbar-stable pr-2'>
          {fields
            .filter(f => f.visibleInCreate)
            .sort((a, b) => a.order - b.order)
            .map((field, index, array) => (
              <div
                key={field.id}
                className={`bg-background border border-border flex items-center ${index < array.length - 1 ? 'mb-[-1px]' : ''}`}
              >
                {/* Left column - Label with gray background */}
                <div className='bg-muted/30 border-r border-border w-[160px] p-[10px] flex gap-[8px] items-center mr-[-1px]'>
                  <p className='text-[14px] font-medium text-muted-foreground leading-[18px] tracking-[-0.2px]'>
                    {field.label}
                    {field.required && <span className='text-red-500'>*</span>}
                  </p>
                </div>

                {/* Right column - Value */}
                <div className='flex-1 px-[14px] py-[10px] flex gap-[8px] items-center mr-[-1px]'>
                  {field.type === 'text' && (
                    <p className='text-[14px] font-medium text-muted-foreground leading-[18px] tracking-[-0.2px]'>
                      Sample {field.label.toLowerCase()} text
                    </p>
                  )}

                  {field.type === 'board' && (
                    <>
                      <LayoutGrid size={14} className='text-muted-foreground' />
                      <p className='text-[14px] font-medium text-muted-foreground leading-[18px] tracking-[-0.2px]'>
                        Sample Board Name{' '}
                      </p>
                    </>
                  )}

                  {field.type === 'project' && (
                    <>
                      <Folder size={14} className='text-muted-foreground' />
                      <p className='text-[14px] font-medium text-muted-foreground leading-[18px] tracking-[-0.2px]'>
                        Sample Project Name
                      </p>
                    </>
                  )}

                  {field.type === 'status' && (
                    <>
                      <div className='w-[12px] h-[12px] rounded-full border-2 border-[#6276be] flex items-center justify-center'>
                        <div className='w-[5px] h-[5px] rounded-full bg-[#6276be]' />
                      </div>
                      <p className='text-[14px] font-medium text-muted-foreground leading-[18px]'>
                        In Progress
                      </p>
                    </>
                  )}

                  {field.type === 'priority' && (
                    <div className='flex gap-[8px] items-center'>
                      <svg
                        width='14'
                        height='14'
                        viewBox='0 0 16 16'
                        fill='none'
                        className='text-red-500'
                      >
                        <path
                          d='M8 2L14 14H2L8 2Z'
                          stroke='currentColor'
                          strokeWidth='1.5'
                          fill='none'
                        />
                        <path
                          d='M8 6V9'
                          stroke='currentColor'
                          strokeWidth='1.5'
                          strokeLinecap='round'
                        />
                        <circle cx='8' cy='11.5' r='0.75' fill='currentColor' />
                      </svg>
                      <p className='text-[14px] font-medium text-muted-foreground leading-[18px]'>
                        Critical
                      </p>
                    </div>
                  )}

                  {field.type === 'date' && (
                    <div className='flex gap-[8px] items-center'>
                      <Calendar size={14} className='text-muted-foreground' />
                      <p className='text-[14px] font-medium text-muted-foreground leading-[18px]'>
                        10 Dec 2025
                      </p>
                    </div>
                  )}

                  {field.type === 'select' && field.options && (
                    <>
                      <List size={14} className='text-muted-foreground' />
                      <p className='text-[14px] font-medium text-muted-foreground leading-[18px]'>
                        {field.options[0]?.value || 'Select option'}
                      </p>
                    </>
                  )}

                  {field.type === 'multiselect' && field.options && (
                    <div className='flex gap-1.5 flex-wrap'>
                      {field.options.slice(0, 3).map(option => (
                        <span
                          key={option.id}
                          className='inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded'
                        >
                          {option.value}
                          <X size={10} className='ml-0.5 cursor-pointer hover:opacity-70' />
                        </span>
                      ))}
                    </div>
                  )}

                  {field.type === 'user' && (
                    <div className='flex gap-[8px] items-center'>
                      <div className='w-[16px] h-[16px] rounded border-[0.8px] border-white bg-orange-400 overflow-hidden text-white text-[8px] font-medium flex items-center justify-center'>
                        NJ
                      </div>
                      <p className='text-[14px] font-medium text-muted-foreground leading-[18px]'>
                        Neha Joshi
                      </p>
                    </div>
                  )}

                  {field.type === 'boolean' && (
                    <p className='text-[14px] font-medium text-muted-foreground leading-[18px]'>
                      Yes
                    </p>
                  )}

                  {field.type === 'tags' && (
                    <div className='flex gap-1.5 flex-wrap'>
                      <span className='inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded'>
                        <span className='w-1.5 h-1.5 rounded-full bg-purple-500' />
                        Bug
                      </span>
                      <span className='inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded'>
                        <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />
                        Feature
                      </span>
                    </div>
                  )}

                  {field.type === 'ticketType' && (
                    <>
                      <Ticket size={14} strokeWidth={2.33} className='text-muted-foreground' />
                      <p className='text-[14px] font-medium text-muted-foreground leading-[18px]'>
                        {BaseTicketType.Feature}
                      </p>
                    </>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Modal Footer */}
      <div className='bg-background flex items-center justify-between pb-[16px] pt-[12px] px-[20px] border-t border-border'>
        <button className='flex items-center gap-[8px] px-[12px] py-[8px] rounded-[8px] text-[14px] font-medium text-muted-foreground transition-colors'>
          <Paperclip strokeWidth={2.33} className='size-3.5 text-muted-foreground' />
          Attach
        </button>
        <button className='bg-[#445bb2] text-white px-[16px] py-[8px] rounded-[8px] text-[14px] font-medium transition-colors'>
          Create Ticket
        </button>
      </div>
    </div>
  );
};

// Export content components and types
export { TicketPreviewContent, CreateTicketModal };
export type { TicketPreviewProps, PreviewField, CreateField };
