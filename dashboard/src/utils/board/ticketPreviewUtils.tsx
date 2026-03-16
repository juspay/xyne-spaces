import type { ReactNode } from 'react';
import { LayoutGrid, Folder, List } from 'lucide-react';
import { TicketStatusIcon } from '../../components/Tickets/TicketStatus/TicketStatusIcon';
import type {
  PreviewField,
  CreateField,
} from '../../components/Board/TicketPreviewViews/TicketPreviewViews.types';

/**
 * Renders the field value based on the field type for ticket preview
 */
export const renderPreviewFieldValue = (field: PreviewField): ReactNode => {
  switch (field.type) {
    case 'text':
      return (
        <span className='text-[14px] text-[#181b1d]'>Sample {field.label.toLowerCase()} text</span>
      );
    case 'board':
      return (
        <>
          <LayoutGrid size={14} className='text-gray-400' />
          <span className='text-[14px] text-[#181b1d]'>Sample Board Name</span>
        </>
      );
    case 'project':
      return (
        <>
          <Folder size={14} className='text-gray-400' />
          <span className='text-[14px] text-[#181b1d]'>Sample Project Name</span>
        </>
      );
    case 'priority':
      return (
        <>
          <svg width='16' height='16' viewBox='0 0 16 16' fill='none' className='text-red-500'>
            <path d='M8 2L14 14H2L8 2Z' stroke='currentColor' strokeWidth='1.5' fill='none' />
            <path d='M8 6V9' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
            <circle cx='8' cy='11.5' r='0.75' fill='currentColor' />
          </svg>
          <span className='text-[14px] text-[#181b1d] font-medium'>Critical</span>
        </>
      );
    case 'date':
      return <span className='text-[14px] text-[#181b1d] font-medium'>10 Dec 2025</span>;
    case 'select':
      return (
        <>
          <List size={14} className='text-gray-400' />
          <span className='text-[14px] text-[#181b1d]'>
            {field.options?.[0] || 'Select option'}
          </span>
        </>
      );
    case 'multiselect':
      return (
        <div className='flex flex-wrap gap-1.5'>
          {field.options?.slice(0, 2).map((option, idx) => (
            <span key={idx} className='px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded'>
              {option}
            </span>
          ))}
        </div>
      );
    case 'user':
      return (
        <>
          <div className='w-[16px] h-[16px] rounded border-[0.8px] border-white bg-orange-400 text-white text-[8px] font-medium flex items-center justify-center'>
            NJ
          </div>
          <span className='text-[14px] text-[#181b1d] font-medium'>Neha Joshi</span>
        </>
      );
    case 'boolean':
      return <span className='text-[14px] text-[#181b1d] font-medium'>Yes</span>;
    case 'status':
      return (
        <>
          <TicketStatusIcon size={14} progressPercentage={25} />
          <span className='text-[14px] text-[#181b1d]'>User defined status</span>
        </>
      );
    default:
      return <span className='text-[14px] text-[#505b62]'>Sample value</span>;
  }
};

/**
 * Default preview fields shown in ticket preview
 */
export const getDefaultPreviewFields = (): PreviewField[] => [
  { id: '1', label: 'Board', type: 'board' },
  { id: '2', label: 'Project', type: 'project' },
  { id: '3', label: 'Channel', type: 'text' },
  { id: '4', label: 'Status', type: 'status' },
  { id: '5', label: 'Priority', type: 'priority' },
  { id: '6', label: 'Due Date', type: 'date' },
  { id: '7', label: 'Assignee', type: 'user' },
];

/**
 * Default create ticket form fields
 */
export const getDefaultCreateFields = (): CreateField[] => [
  {
    id: '1',
    name: 'status',
    label: 'Status',
    type: 'status',
    required: false,
    order: 1,
    visibleInCreate: true,
  },
  {
    id: '2',
    name: 'priority',
    label: 'Priority',
    type: 'priority',
    required: false,
    order: 2,
    visibleInCreate: true,
  },
  {
    id: '3',
    name: 'dueDate',
    label: 'Due By',
    type: 'date',
    required: false,
    order: 3,
    visibleInCreate: true,
  },
  {
    id: '4',
    name: 'assignedTo',
    label: 'Assignee',
    type: 'user',
    required: false,
    order: 4,
    visibleInCreate: true,
  },
  {
    id: '5',
    name: 'workflowType',
    label: 'Workflow',
    type: 'workflow',
    required: false,
    order: 5,
    visibleInCreate: true,
  },
  {
    id: '6',
    name: 'tags',
    label: 'Tags',
    type: 'tags',
    required: false,
    order: 6,
    visibleInCreate: true,
  },
  {
    id: '7',
    name: 'ticketType',
    label: 'Ticket Type',
    type: 'ticketType',
    required: false,
    order: 7,
    visibleInCreate: true,
  },
  {
    id: '8',
    name: 'board',
    label: 'Board',
    type: 'board',
    required: false,
    order: 8,
    visibleInCreate: true,
  },
  {
    id: '9',
    name: 'project',
    label: 'Project',
    type: 'project',
    required: false,
    order: 9,
    visibleInCreate: true,
  },
  {
    id: '10',
    name: 'channel',
    label: 'Channel',
    type: 'text',
    required: false,
    order: 10,
    visibleInCreate: true,
  },
];
