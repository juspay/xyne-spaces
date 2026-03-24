import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useForm } from '@tanstack/react-form';
import {
  X,
  User,
  Calendar,
  Tag,
  AlertCircle,
  Eye,
  Edit2,
  Clock,
  CheckCircle2,
  Circle,
  MessageSquare,
  Search,
} from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import type { TicketPriority } from '@xyne/shared';
import { TextInput, TextArea, Button, ButtonType, SingleSelect } from '@juspay/blend-design-system';
import ThreadList from '../../Chat/ThreadList/ThreadList';
import { ChatInput } from '../../Chat/ChatInput/ChatInput';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { TicketActivity } from '../TicketActivity';
import { useChannelsByProjectId } from '../../../hooks/useChannels';
import { useUsers } from '../../../hooks/useUsers';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { mutators } from '../../../zero/mutators';

type TabType = 'overview' | 'threads';

interface TicketFormData {
  title: string;
  description: string;
  priority: TicketPriority;
  assignedTo: string;
}

interface PriorityConfig {
  color: string;
  bg: string;
  border: string;
  icon: React.ElementType;
  dotColor: string;
}

interface StatusConfig {
  color: string;
  bg: string;
  border: string;
  icon: React.ElementType;
}

const getPriorityConfig = (priority: string): PriorityConfig => {
  switch (priority) {
    case 'CRITICAL':
      return {
        color: 'text-red-700',
        bg: 'bg-red-50',
        border: 'border-red-200',
        icon: AlertCircle,
        dotColor: 'bg-red-500',
      };
    case 'HIGH':
      return {
        color: 'text-orange-700',
        bg: 'bg-orange-50',
        border: 'border-orange-200',
        icon: AlertCircle,
        dotColor: 'bg-orange-500',
      };
    case 'MEDIUM':
      return {
        color: 'text-yellow-700',
        bg: 'bg-yellow-50',
        border: 'border-yellow-200',
        icon: Circle,
        dotColor: 'bg-yellow-500',
      };
    case 'LOW':
      return {
        color: 'text-blue-700',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        icon: Circle,
        dotColor: 'bg-blue-500',
      };
    default:
      return {
        color: 'text-foreground',
        bg: 'bg-muted',
        border: 'border-border',
        icon: Circle,
        dotColor: 'bg-muted0',
      };
  }
};

const getStatusConfig = (status: string): StatusConfig => {
  switch (status) {
    case 'TODO':
      return {
        color: 'text-blue-700',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        icon: Circle,
      };
    case 'STARTED':
      return {
        color: 'text-orange-700',
        bg: 'bg-orange-50',
        border: 'border-orange-200',
        icon: Clock,
      };
    case 'PAUSED':
      return {
        color: 'text-purple-700',
        bg: 'bg-purple-50',
        border: 'border-purple-200',
        icon: Clock,
      };
    case 'COMPLETED':
      return {
        color: 'text-green-700',
        bg: 'bg-green-50',
        border: 'border-green-200',
        icon: CheckCircle2,
      };
    case 'CANCELLED':
      return {
        color: 'text-red-700',
        bg: 'bg-red-50',
        border: 'border-red-200',
        icon: X,
      };
    default:
      return {
        color: 'text-foreground',
        bg: 'bg-muted',
        border: 'border-border',
        icon: Circle,
      };
  }
};

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

interface InfoFieldProps {
  label: string;
  icon: React.ElementType;
  value: string;
  config?:
    | PriorityConfig
    | StatusConfig
    | { bg: string; border: string; color: string }
    | undefined;
}

const InfoField: React.FC<InfoFieldProps> = ({ label, icon: iconComponent, value, config }) => (
  <div className='space-y-2'>
    <span className='block text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1'>
      {React.createElement(iconComponent, { className: 'w-3 h-3' })}
      {label}
    </span>
    <div
      className={`px-3 py-2 border rounded-lg text-sm ${
        config
          ? `${config.bg} ${config.border} flex items-center gap-2`
          : 'bg-muted border-border font-medium text-foreground'
      }`}
    >
      {'icon' in (config || {}) && (config as PriorityConfig | StatusConfig)?.icon && (
        <span className={`w-4 h-4 ${config?.color}`}>
          {React.createElement((config as PriorityConfig | StatusConfig).icon, {
            className: `w-4 h-4 ${config?.color}`,
          })}
        </span>
      )}
      <span className={config ? `font-semibold ${config.color}` : ''}>{value}</span>
    </div>
  </div>
);

interface TicketSidebarProps {
  ticketId?: string;
  channelId?: string;
  onClose?: () => void;
}

export const TicketSidebar: React.FC<TicketSidebarProps> = ({
  ticketId: propTicketId,
  channelId: propChannelId,
  onClose,
}) => {
  const params = useParams<{ channelId: string; ticketId: string }>();
  const channelId = propChannelId || params.channelId;
  const ticketId = propTicketId || params.ticketId;
  const zero = useZero();
  const [activeTab, setActiveTab] = useState<TabType>('threads');
  const [isEditing, setIsEditing] = useState(false);
  const [dropdown, setDropdown] = useState({
    priority: false,
    status: false,
    assignee: false,
  });
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch ticket
  const [ticket] = useCachedQuery(queries.ticketById({ ticketId: ticketId || '' }), {
    enabled: !!ticketId,
  });

  // Form setup
  const form = useForm({
    defaultValues: {
      title: '',
      description: '',
      priority: 'MEDIUM' as TicketPriority,
      assignedTo: '',
    } as TicketFormData,
    onSubmit: ({ value }) => {
      if (!ticketId) return;
      zero.mutate(
        mutators.ticket.update({
          id: ticketId,
          title: value.title,
          description: value.description,
          priority: value.priority,
          assignedTo: value.assignedTo || null,
          updatedAt: Date.now(),
        }),
      );
      setIsEditing(false);
    },
  });

  // Sync form with ticket data
  useEffect(() => {
    if (ticket) {
      form.setFieldValue('title', ticket.title);
      form.setFieldValue('description', ticket.description);
      form.setFieldValue('priority', ticket.priority);
      form.setFieldValue('assignedTo', ticket.assignedTo || '');
    }
  }, [ticket, form]);

  const users = useUsers();

  // Query all user groups for activity display
  const userGroups = useUserGroups();

  // Filter users based on search
  const filteredUsers = useMemo(() => {
    if (!users) return [];
    if (!assigneeSearch.trim()) return users;
    const search = assigneeSearch.toLowerCase();
    return users.filter(
      u => u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search),
    );
  }, [users, assigneeSearch]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (
        assigneeDropdownRef.current &&
        !assigneeDropdownRef.current.contains(event.target as Node)
      ) {
        setDropdown(prev => ({ ...prev, assignee: false }));
      }
    };

    if (dropdown.assignee) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdown.assignee]);

  // Fetch related data
  const [entityMappings] = useCachedQuery(
    queries.getTicketEntityMappingsByTicketId({ ticketId: ticketId || '' }),
    { enabled: !!ticketId },
  );

  // Fetch ticket activities
  const [activities] = useCachedQuery(queries.ticketActivities({ ticketId: ticketId || '' }), {
    enabled: !!ticketId,
  });

  // Fetch the ticket's project to get its channels from xstate
  const projectChannels = useChannelsByProjectId(ticket?.projectId);

  // Determine the actual channelId to use:
  // 1. Use channelId from props/params if available
  // 2. Otherwise, use the first channel from the ticket's project
  const actualChannelId =
    channelId || (projectChannels && projectChannels.length > 0 ? projectChannels[0]?.id : '');

  const [messages] = useCachedQuery(
    queries.conversationMessagesV2({
      conversationId: ticket?.conversationId || '',
    }),
    { enabled: !!ticket?.conversationId },
  );

  const [conversation] = useCachedQuery(
    queries.getConversationById({
      conversationId: ticket?.conversationId || '',
    }),
    { enabled: !!ticket?.conversationId },
  );

  const createdByUser = useMemo(
    () => users?.find(u => u.id === ticket?.createdBy),
    [users, ticket],
  );

  const assignedUser = useMemo(
    () => users?.find(u => u.id === ticket?.assignedTo),
    [users, ticket],
  );

  const priorityConfig = useMemo(
    () => getPriorityConfig(ticket?.priority || 'MEDIUM'),
    [ticket?.priority],
  );

  const statusConfig = useMemo(
    () => getStatusConfig(ticket?.stageName || 'OPEN'),
    [ticket?.stageName],
  );

  const toggleDropdown = (key: keyof typeof dropdown): void =>
    setDropdown(prev => ({ ...prev, [key]: !prev[key] }));

  const tabs = [
    { id: 'threads', label: 'Threads', icon: MessageSquare },
    { id: 'overview', label: 'Overview', icon: Eye },
  ] as const;

  if (!ticket) {
    return (
      <div className='flex items-center justify-center h-full bg-muted'>
        <div className='text-center'>
          <div className='w-12 h-12 mx-auto mb-3 border-4 border-input border-t-blue-600 rounded-full animate-spin' />
          <p className='text-sm text-muted-foreground'>Loading ticket...</p>
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full bg-background'>
      {/* Header */}
      <div className='px-4 md:px-6 py-4 border-b border-border bg-gradient-to-r from-muted to-background'>
        <div className='flex items-start justify-between mb-3 gap-3'>
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-2 mb-2'>
              <span className='text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1 bg-muted rounded'>
                {ticket.xyneId}
              </span>
              <div
                className={`w-2 h-2 rounded-full ${priorityConfig.dotColor}`}
                title={`Priority: ${ticket.priority}`}
              />
            </div>
            {isEditing ? (
              <form.Field
                name='title'
                validators={{
                  onChange: ({ value }) => {
                    if (!value?.trim()) return 'Title is required';
                    if (value.length < 3) return 'Title must be at least 3 characters';
                    return undefined;
                  },
                }}
              >
                {field => {
                  const hasError = field.state.meta.errors.length > 0;
                  return hasError ? (
                    <TextInput
                      value={field.state.value}
                      onChange={e => field.handleChange(e.target.value)}
                      error={true}
                      errorMessage={field.state.meta.errors[0]!}
                    />
                  ) : (
                    <TextInput
                      value={field.state.value}
                      onChange={e => field.handleChange(e.target.value)}
                      error={false}
                    />
                  );
                }}
              </form.Field>
            ) : (
              <h2 className='text-xl font-bold text-foreground'>{ticket.title}</h2>
            )}
          </div>
          <div className='flex items-center gap-2 flex-shrink-0'>
            <button
              onClick={() => setIsEditing(!isEditing)}
              className='p-2 hover:bg-blue-50 rounded-lg transition-all text-muted-foreground hover:text-blue-600'
              title={isEditing ? 'Cancel editing' : 'Edit ticket'}
              data-track-category='Tickets'
              data-track-name='ToggleTicketEdit'
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={() => {
                if (onClose) {
                  onClose();
                }
              }}
              className='p-2 rounded-lg text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-all duration-200'
              data-track-category='Tickets'
              data-track-name='CloseTicketSidebar'
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Status & Priority Badges */}
        <div className='flex items-center gap-2 flex-wrap'>
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold ${statusConfig.bg} ${statusConfig.color} ${statusConfig.border} border`}
          >
            <statusConfig.icon className='w-3 h-3' />
            {ticket.stageName?.replace(/_/g, ' ')}
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold ${priorityConfig.bg} ${priorityConfig.color} ${priorityConfig.border} border`}
          >
            <priorityConfig.icon className='w-3 h-3' />
            {ticket.priority}
          </span>
          {/* Ticket type not available in current schema */}
        </div>
      </div>

      {/* Tabs */}
      <div className='flex items-center border-b border-border bg-background px-4 md:px-6'>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-input'
            }`}
            data-track-category='Tickets'
            data-track-name='SelectTicketTab'
            data-track-metadata={JSON.stringify({ tabId: tab.id })}
          >
            <tab.icon className='w-4 h-4' />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className={`flex-1 ${activeTab === 'threads' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {activeTab === 'overview' && (
          <div className='p-4 md:p-6 space-y-6'>
            {/* Description */}
            <div className='p-4 bg-muted rounded-lg border border-border'>
              <span className='block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3'>
                Description
              </span>
              {isEditing ? (
                <form.Field
                  name='description'
                  validators={{
                    onChange: ({ value }) => {
                      if (!value?.trim()) return 'Description is required';
                      return undefined;
                    },
                  }}
                >
                  {field => {
                    const hasError = field.state.meta.errors.length > 0;
                    return hasError ? (
                      <TextArea
                        value={field.state.value}
                        onChange={e => field.handleChange(e.target.value)}
                        placeholder='Detailed description...'
                        error={true}
                        errorMessage={field.state.meta.errors[0]!}
                      />
                    ) : (
                      <TextArea
                        value={field.state.value}
                        onChange={e => field.handleChange(e.target.value)}
                        placeholder='Detailed description...'
                        error={false}
                      />
                    );
                  }}
                </form.Field>
              ) : (
                <p className='text-sm text-foreground leading-relaxed whitespace-pre-wrap'>
                  {ticket.description || 'No description provided.'}
                </p>
              )}
            </div>

            {/* Ticket Information */}
            <div>
              <h3 className='text-sm font-semibold text-foreground mb-4 flex items-center gap-2'>
                <Tag className='w-4 h-4' />
                Ticket Information
              </h3>
              <div className='grid grid-cols-2 gap-4'>
                {!isEditing ? (
                  <>
                    {/* MID */}
                    {entityMappings && entityMappings.length > 0 && entityMappings[0] && (
                      <InfoField
                        label='MID'
                        icon={Tag}
                        value={entityMappings[0].entityName || 'N/A'}
                      />
                    )}

                    <InfoField
                      label='Created By'
                      icon={User}
                      value={createdByUser?.name || 'Unknown'}
                    />

                    <InfoField
                      label='Created At'
                      icon={Calendar}
                      value={formatTimestamp(ticket.createdAt)}
                    />

                    <InfoField
                      label='Priority'
                      icon={AlertCircle}
                      value={ticket.priority}
                      config={priorityConfig}
                    />

                    <InfoField
                      label='Assignee'
                      icon={User}
                      value={assignedUser?.name || 'Unassigned'}
                      config={
                        assignedUser
                          ? { bg: 'bg-blue-50', border: 'border-blue-200', color: 'text-blue-700' }
                          : undefined
                      }
                    />

                    {/* Ticket type not available in current schema */}
                  </>
                ) : (
                  <>
                    <div className='space-y-2'>
                      <form.Field name='priority'>
                        {field => (
                          <SingleSelect
                            label='Priority'
                            placeholder='Select priority'
                            items={[
                              {
                                items: [
                                  { label: 'Critical', value: 'CRITICAL' },
                                  { label: 'High', value: 'HIGH' },
                                  { label: 'Medium', value: 'MEDIUM' },
                                  { label: 'Low', value: 'LOW' },
                                ],
                              },
                            ]}
                            selected={field.state.value}
                            onSelect={selected => field.handleChange(selected as TicketPriority)}
                          />
                        )}
                      </form.Field>
                    </div>

                    <div className='space-y-2'>
                      <span className='block text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1'>
                        <User className='w-3 h-3' />
                        Assignee
                      </span>
                      <form.Field name='assignedTo'>
                        {field => (
                          <div className='relative' ref={assigneeDropdownRef}>
                            <button
                              type='button'
                              className='w-full px-3 py-2 border border-input rounded-lg bg-background hover:bg-muted transition-colors text-left flex items-center gap-2 justify-between'
                              onClick={() => toggleDropdown('assignee')}
                              data-track-category='Tickets'
                              data-track-name='ToggleAssigneeDropdown'
                            >
                              <div className='flex items-center gap-2 flex-1'>
                                {field.state.value ? (
                                  <>
                                    <UserAvatar
                                      userId={field.state.value}
                                      showActiveStatus={false}
                                    />
                                    <span className='text-sm text-foreground'>
                                      {users?.find(u => u.id === field.state.value)?.name ||
                                        'Unknown User'}
                                    </span>
                                  </>
                                ) : (
                                  <span className='text-sm text-muted-foreground'>Unassigned</span>
                                )}
                              </div>
                              <Search className='w-4 h-4 text-muted-foreground' />
                            </button>

                            {dropdown.assignee && (
                              <div className='absolute top-full left-0 mt-1 w-full bg-background border border-border rounded-lg shadow-lg z-50 max-h-64 overflow-hidden flex flex-col'>
                                <div className='p-2 border-b border-border'>
                                  <div className='relative'>
                                    <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
                                    <input
                                      type='text'
                                      placeholder='Search users...'
                                      value={assigneeSearch}
                                      onChange={e => setAssigneeSearch(e.target.value)}
                                      className='w-full pl-9 pr-3 py-1.5 border border-input rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none'
                                      data-track-category='Tickets'
                                      data-track-name='SearchAssignee'
                                    />
                                  </div>
                                </div>

                                <div className='overflow-y-auto'>
                                  <button
                                    type='button'
                                    onClick={() => {
                                      field.handleChange('');
                                      toggleDropdown('assignee');
                                      setAssigneeSearch('');
                                    }}
                                    className='w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2'
                                    data-track-category='Tickets'
                                    data-track-name='UnassignTicket'
                                  >
                                    <div className='w-6 h-6 rounded-full bg-border flex items-center justify-center'>
                                      <X className='w-3 h-3 text-muted-foreground' />
                                    </div>
                                    <span className='text-foreground'>Unassigned</span>
                                    {!field.state.value && (
                                      <div className='w-4 h-4 ml-auto border-2 border-blue-600 rounded-full' />
                                    )}
                                  </button>

                                  {filteredUsers.map(user => (
                                    <button
                                      key={user.id}
                                      type='button'
                                      onClick={() => {
                                        field.handleChange(user.id);
                                        toggleDropdown('assignee');
                                        setAssigneeSearch('');
                                      }}
                                      className='w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2'
                                      data-track-category='Tickets'
                                      data-track-name='SelectAssignee'
                                      data-track-metadata={JSON.stringify({ userId: user.id })}
                                    >
                                      <UserAvatar userId={user.id} showActiveStatus={false} />
                                      <div className='flex-1 min-w-0'>
                                        <div className='text-foreground truncate'>{user.name}</div>
                                        <div className='text-xs text-muted-foreground truncate'>
                                          {user.email}
                                        </div>
                                      </div>
                                      {field.state.value === user.id && (
                                        <div className='w-4 h-4 ml-auto border-2 border-blue-600 rounded-full flex-shrink-0' />
                                      )}
                                    </button>
                                  ))}

                                  {filteredUsers.length === 0 && assigneeSearch && (
                                    <div className='px-3 py-2 text-sm text-muted-foreground text-center'>
                                      No users found
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </form.Field>
                    </div>
                  </>
                )}
              </div>
            </div>

            {isEditing && (
              <div className='sticky bottom-0 p-4 bg-background border-t border-border shadow-lg flex items-center gap-3'>
                <Button
                  text='Cancel'
                  buttonType={ButtonType.SECONDARY}
                  onClick={() => {
                    form.reset();
                    setIsEditing(false);
                  }}
                />
                <Button
                  text={form.state.isSubmitting ? 'Saving...' : 'Save Changes'}
                  buttonType={ButtonType.PRIMARY}
                  onClick={() => {
                    void form.handleSubmit();
                  }}
                  disabled={form.state.isSubmitting}
                />
              </div>
            )}

            {/* Activity Section */}
            <TicketActivity activities={activities} users={users} userGroups={userGroups} />
          </div>
        )}

        {activeTab === 'threads' && (
          <div className='flex flex-col h-full'>
            <ThreadList
              channelId={actualChannelId || ''}
              conversationId={ticket.conversationId || ''}
              threadMessages={messages}
              initialScrollOffset={0}
              conversation={conversation}
            />
            <div className='p-4 border-t border-border bg-background'>
              <ChatInput
                channelId={actualChannelId || ''}
                conversation={conversation}
                placeholder='Reply to this ticket...'
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
