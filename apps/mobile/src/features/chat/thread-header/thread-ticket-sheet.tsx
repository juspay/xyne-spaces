import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import {
  BaseTicketType,
  FormContextType,
  FormEntityType,
  TicketPriority,
  TicketStatusV2,
  LookupType,
} from '@xyne/shared';
import { router } from 'expo-router';
import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { InputV2 } from '@/src/components/ui/input-v2';
import { composerHtmlToPlainText } from '@/src/components/input-composer/utils/conversation-input.utils';
import { useAuth } from '@/src/contexts/AuthContext';
import { FilterSheetHeader } from '@/src/features/global-search/components/filters/filter-sheet-header';
import {
  useMountWhileOpen,
  type SheetMountProps,
} from '@/src/features/global-search/hooks/use-mount-while-open';
import { useSearchResults } from '@/src/features/global-search/hooks/use-search-results';
import { buildSearchRequest } from '@/src/features/global-search/utils/search-request';
import { useConversationHeaderData } from '@/src/hooks/useConversationHeaderData';
import { useQuery } from '@/src/hooks/useQuery';
import { useUsers } from '@/src/hooks/useUsers';
import { useUserGroups } from '@/src/hooks/useUserGroups';
import { SingleSelectPickerSheet } from '@/src/screens/ticket-details/single-select-picker-sheet';
import { UserPickerSheet } from '@/src/screens/ticket-details/user-picker-sheet';
import { DatePickerSheet } from '@/src/screens/ticket-details/date-picker-sheet';
import { createTicket } from '@/src/services/ticketService';
import { apiPost } from '@/src/services/apiClient';
import { queries } from '@/src/zero/queries';
import { resolveDisplayFormFields } from './resolve-ticket-form-fields';
import {
  threadHasTicket,
  activeTicketFields,
  ticketDynamicFieldErrors,
  type TicketFieldValues,
} from './thread-ticket-form';

type Choice = {
  title: string;
  options: { value: string; label: string }[];
  value: string | null;
  select: (value: string) => void;
};
type Config = Record<string, { enabled?: boolean; mandatory?: boolean }>;
function TicketReferenceField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return (): void => clearTimeout(timer);
  }, [query]);
  const results = useSearchResults(
    buildSearchRequest({
      tab: 'tickets',
      query: debounced,
      chips: [],
      onlyMyChannels: false,
      scope: null,
    }),
  );
  return (
    <View>
      <InputV2
        variant='bottomsheet'
        value={query}
        onChangeText={setQuery}
        placeholder='Search tickets'
      />
      {value ? (
        <Pressable onPress={() => onChange('')}>
          <Text className='text-bottomsheet-text-muted'>Selected ticket: {value} ×</Text>
        </Pressable>
      ) : null}
      {results.status === 'loading' ? <ActivityIndicator /> : null}
      {results.status === 'error' ? (
        <Pressable onPress={results.retry}>
          <Text className='text-bottomsheet-container-foreground'>Search failed. Retry</Text>
        </Pressable>
      ) : null}
      {results.data.map(result => (
        <Pressable
          key={result.id}
          onPress={() => {
            onChange(result.searchContext?.ticketId || result.id);
            setQuery('');
          }}
          className='py-2'
        >
          <Text className='text-bottomsheet-container-foreground'>
            {composerHtmlToPlainText(result.title)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
function TicketBody({
  channelId,
  threadId,
  ...sheet
}: SheetMountProps & { channelId: string; threadId: string }): ReactElement {
  const ref = useRef<AppBottomSheetRef>(null);
  const { user } = useAuth();
  const users = useUsers();
  const groups = useUserGroups();
  const { channel, canUseMemberActions } = useConversationHeaderData(channelId, { enabled: false });
  const [conversation, conversationDetails] = useQuery(
    queries.getConversationById({ conversationId: threadId }),
  );
  const [mappings, boardDetails] = useQuery(queries.boardsByChannel({ channelId }));
  const boards = mappings.flatMap(mapping => (mapping.board ? [mapping.board] : []));
  const [chosenBoard, setChosenBoard] = useState('');
  const board =
    boards.find(value => value.id === chosenBoard) ?? (!chosenBoard ? boards[0] : undefined);
  const boardId = board?.id ?? '';
  const [formMapping, formDetails] = useQuery(
    queries.getFormMappingByContextId({
      contextId: boardId,
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: !!boardId },
  );
  const [ticketTypes] = useQuery(queries.lookupValuesByType({ type: LookupType.TICKET_TYPE }));
  const [stages, stageDetails] = useQuery(queries.stagesByBoard({ boardId }), {
    enabled: !!boardId,
  });
  const fields = formMapping
    ? resolveDisplayFormFields(formMapping.formId, [...formMapping.formFields])
    : [];
  const config = (board?.metadata as { ticketFormConfig?: Config } | null)?.ticketFormConfig ?? {};
  const enabled = (key: string, fallback = true): boolean => config[key]?.enabled ?? fallback;
  const mandatory = (key: string): boolean => !!config[key]?.mandatory;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const seeded = useRef(false);
  const titleEdited = useRef(false);
  const typeEdited = useRef(false);
  const [ticketType, setTicketType] = useState<string>(BaseTicketType.Fix);
  const [priority, setPriority] = useState<TicketPriority | undefined>();
  const [stageName, setStageName] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const [labels, setLabels] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [values, setValues] = useState<TicketFieldValues>({});
  const [choice, setChoice] = useState<Choice | null>(null);
  const [showAssignee, setShowAssignee] = useState(false);
  const [dateField, setDateField] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return (): void => {
      mounted.current = false;
    };
  }, []);
  const initialContent = conversation?.initialMessage?.content;
  useEffect(() => {
    if (seeded.current || initialContent === undefined) return;
    seeded.current = true;
    const initial = composerHtmlToPlainText(initialContent ?? '');
    setDescription(initial);
    if (initial.trim().length < 5) return;
    setGenerating(true);
    let cancelled = false;
    void apiPost<{ title: string; ticketType: string }>('/ai/generate-title', {
      description: initial,
      maxLength: 100,
    })
      .then(result => {
        if (cancelled) return;
        if (!titleEdited.current) setTitle(result.title);
        if (!typeEdited.current) setTicketType(result.ticketType);
      })
      .catch(() => {
        /* Manual title entry remains available, as on desktop. */
      })
      .finally(() => {
        if (!cancelled) setGenerating(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [initialContent]);
  const effectiveTicketType =
    board?.boardType === 'FLOW'
      ? BaseTicketType.Epic
      : board?.boardType === 'RELEASE'
        ? BaseTicketType.Release
        : ticketType;
  const activeFields = activeTicketFields(fields, values);
  const setField = (key: string, value: string | string[]): void =>
    setValues(current => ({ ...current, [key]: value }));
  const canCreate =
    !!channel &&
    !channel.isArchived &&
    canUseMemberActions &&
    conversation?.channelId === channelId &&
    !!conversation.initialMessage &&
    !threadHasTicket(conversation);
  const ready =
    conversationDetails.type === 'complete' &&
    boardDetails.type === 'complete' &&
    formDetails.type === 'complete' &&
    stageDetails.type === 'complete';
  const fieldButton = (label: string, value: string, onPress: () => void): ReactElement => (
    <Pressable disabled={saving} accessibilityRole='button' onPress={onPress} className='py-3'>
      <Text className='text-sm text-bottomsheet-text-muted'>{label}</Text>
      <Text className='text-base text-bottomsheet-container-foreground'>{value || 'Select'}</Text>
    </Pressable>
  );
  const pick = (
    title: string,
    options: { value: string; label: string }[],
    value: string | null,
    select: (value: string) => void,
  ): void => setChoice({ title, options, value, select });
  const submit = async (): Promise<void> => {
    if (!canCreate || !ready || !board || !user || inFlight.current) return;
    const tags = [
      ...new Set(
        labels
          .split(',')
          .map(value => value.trim())
          .filter(Boolean),
      ),
    ];
    const errors = ticketDynamicFieldErrors(fields, values);
    if (!title.trim()) errors.push('Title is required');
    if (description.trim().length < 5) errors.push('Description must be at least 5 characters');
    if (enabled('userGroupsOnly', false) && mandatory('userGroupsOnly') && !group)
      errors.push('User group is required');
    if (
      !enabled('userGroupsOnly', false) &&
      enabled('assignedTo') &&
      mandatory('assignedTo') &&
      !assignee &&
      !group
    )
      errors.push('Assignee is required');
    if (enabled('dueDate') && mandatory('dueDate') && !eta) errors.push('Due date is required');
    if (enabled('labels') && mandatory('labels') && !tags.length)
      errors.push('Labels are required');
    if (enabled('merchantId', false) && mandatory('merchantId') && !merchantId.trim())
      errors.push('Merchant ID is required');
    if (errors.length) {
      Alert.alert('Check ticket details', errors.join('\n'));
      return;
    }
    inFlight.current = true;
    setSaving(true);
    const stage = stages.find(value => value.name === stageName);
    try {
      const ticket = await createTicket({
        title: title.trim(),
        description: description.trim(),
        boardId,
        projectId: board.projectId,
        channelId,
        sourceConversationId: threadId,
        sourceMessageId: conversation.initialMessage?.messageId ?? conversation.initialMessageId,
        createdBy: user.user_id,
        updatedBy: user.user_id,
        ticketType: effectiveTicketType,
        statusV2: stage?.defaultTicketStatusV2 ?? TicketStatusV2.TODO,
        ...(stageName ? { stageName } : {}),
        ...(priority ? { priority } : {}),
        ...(assignee && enabled('assignedTo') && !enabled('userGroupsOnly', false)
          ? { assignedTo: assignee }
          : {}),
        ...(group ? { userGroupId: group } : {}),
        ...(eta && enabled('dueDate') ? { eta: new Date(eta).toISOString() } : {}),
        ...(enabled('labels') ? { tags } : {}),
        ...(enabled('merchantId', false) ? { merchantId: merchantId.trim() } : {}),
        dynamicFields: Object.fromEntries(
          activeFields
            .filter(field => field.fieldType !== 'DOC' && values[field.fieldName] !== undefined)
            .map(field => [field.fieldName, values[field.fieldName]!]),
        ),
      });
      if (!mounted.current) return;
      ref.current?.dismiss();
      router.replace({
        pathname: '/ticket/[ticketId]',
        params: {
          ticketId: ticket.id,
          channelId,
          threadId: ticket.conversationId || threadId,
          selectedTab: 'details',
        },
      });
    } catch (error) {
      Alert.alert(
        'Could not create ticket',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <>
      <AppBottomSheet ref={ref} {...sheet} mode='fullscreen' keyboardBehavior='extend'>
        <FilterSheetHeader
          title='Create ticket'
          onCancel={() => ref.current?.dismiss()}
          {...(ready && canCreate && board && !saving
            ? {
                applyLabel: 'Create',
                onApply: (): void => {
                  void submit();
                },
              }
            : {})}
        />
        <BottomSheetScrollView
          keyboardShouldPersistTaps='handled'
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        >
          {saving || (!ready && !!board) ? <ActivityIndicator /> : null}
          {!canCreate && conversationDetails.type === 'complete' ? (
            <Text className='text-bottomsheet-text-muted'>
              This thread already has a ticket or cannot be edited.
            </Text>
          ) : null}
          {boardDetails.type === 'complete' && !boards.length ? (
            <Text className='text-bottomsheet-text-muted'>
              No boards are linked to this channel. Link a board on desktop to create tickets here.
            </Text>
          ) : null}
          <Text className='text-bottomsheet-text-muted'>Title *</Text>
          <InputV2
            variant='bottomsheet'
            value={title}
            onChangeText={value => {
              titleEdited.current = true;
              setTitle(value);
            }}
            placeholder={generating ? 'Generating title…' : 'Ticket title'}
            editable={!saving}
          />
          <Text className='pt-3 text-bottomsheet-text-muted'>Description *</Text>
          <InputV2
            variant='bottomsheet'
            value={description}
            onChangeText={setDescription}
            multiline
            placeholder='Describe the ticket'
            editable={!saving}
          />
          {fieldButton('Board *', board?.name ?? '', () =>
            pick(
              'Board',
              boards.map(value => ({ value: value.id, label: value.name })),
              boardId,
              value => {
                setChosenBoard(value);
                setValues({});
                setStageName('');
              },
            ),
          )}
          {fieldButton('Priority', priority ?? 'None', () =>
            pick(
              'Priority',
              [
                { value: '', label: 'None' },
                ...Object.values(TicketPriority).map(value => ({ value, label: value })),
              ],
              priority ?? '',
              value => setPriority(value ? (value as TicketPriority) : undefined),
            ),
          )}
          {enabled('todo')
            ? fieldButton('Status', stageName || 'Todo', () =>
                pick(
                  'Status',
                  stages.map(value => ({ value: value.name, label: value.name })),
                  stageName,
                  setStageName,
                ),
              )
            : null}
          {enabled('ticketType') && board?.boardType !== 'FLOW' && board?.boardType !== 'RELEASE'
            ? fieldButton('Ticket type', effectiveTicketType, () =>
                pick(
                  'Ticket type',
                  [...new Set([ticketType, ...ticketTypes.map(row => row.value)])].map(value => ({
                    value,
                    label: value,
                  })),
                  ticketType,
                  value => {
                    typeEdited.current = true;
                    setTicketType(value);
                  },
                ),
              )
            : null}
          {enabled('assignedTo') && !enabled('userGroupsOnly', false)
            ? fieldButton(
                'Assignee',
                users.find(value => value.id === assignee)?.name || 'Unassigned',
                () => setShowAssignee(true),
              )
            : null}
          {enabled('assignedTo') || enabled('userGroupsOnly', false)
            ? fieldButton(
                'User group',
                groups.find(value => value.id === group)?.name || 'None',
                () =>
                  pick(
                    'User group',
                    [
                      { value: '', label: 'None' },
                      ...groups
                        .filter(value => value.isActive !== false)
                        .map(value => ({ value: value.id, label: value.name })),
                    ],
                    group,
                    value => {
                      setGroup(value || null);
                      setAssignee(null);
                    },
                  ),
              )
            : null}
          {enabled('dueDate')
            ? fieldButton('Due date', eta ? new Date(eta).toLocaleDateString() : 'None', () =>
                setDateField('eta'),
              )
            : null}
          {enabled('labels') ? (
            <View className='py-2'>
              <Text className='text-bottomsheet-text-muted'>Labels (comma separated)</Text>
              <InputV2
                variant='bottomsheet'
                value={labels}
                onChangeText={setLabels}
                editable={!saving}
                placeholder='Labels'
              />
            </View>
          ) : null}
          {enabled('merchantId', false) ? (
            <View className='py-2'>
              <Text className='text-bottomsheet-text-muted'>Merchant ID</Text>
              <InputV2
                variant='bottomsheet'
                value={merchantId}
                onChangeText={setMerchantId}
                editable={!saving}
                placeholder='Merchant ID'
              />
            </View>
          ) : null}
          {activeFields
            .filter(field => field.fieldType !== 'DOC')
            .map(field => {
              const value = values[field.fieldName] ?? '';
              const text = typeof value === 'string' ? value : value.join(', ');
              const label = `${field.fieldName}${field.isOptional ? '' : ' *'}`;
              const options = (field.fieldEnum ?? []).map(option => ({
                value: option.value,
                label: option.value,
              }));
              return (
                <View key={field.id} className='py-2'>
                  {field.fieldType === 'SINGLE_SELECT' ||
                  field.fieldType === 'BOOLEAN' ||
                  field.fieldType === 'USER' ? (
                    fieldButton(label, text, () =>
                      pick(
                        label,
                        [
                          { value: '', label: 'None' },
                          ...(field.fieldType === 'BOOLEAN'
                            ? [
                                { value: 'true', label: 'Yes' },
                                { value: 'false', label: 'No' },
                              ]
                            : field.fieldType === 'USER'
                              ? users.map(person => ({
                                  value: person.id,
                                  label: person.name || person.email,
                                }))
                              : options),
                        ],
                        text,
                        next => setField(field.fieldName, next),
                      ),
                    )
                  ) : field.fieldType === 'DATE' ? (
                    fieldButton(label, text ? new Date(text).toLocaleDateString() : '', () =>
                      setDateField(field.fieldName),
                    )
                  ) : field.fieldType === 'MULTI_SELECT' ? (
                    <>
                      <Text className='text-bottomsheet-text-muted'>{label}</Text>
                      {options.map(option => {
                        const list = Array.isArray(value) ? value : [];
                        const checked = list.includes(option.value);
                        return (
                          <Pressable
                            key={option.value}
                            disabled={saving}
                            accessibilityRole='checkbox'
                            accessibilityState={{ checked }}
                            onPress={() =>
                              setField(
                                field.fieldName,
                                checked
                                  ? list.filter(item => item !== option.value)
                                  : [...list, option.value],
                              )
                            }
                            className='py-2'
                          >
                            <Text className='text-bottomsheet-container-foreground'>
                              {checked ? '✓ ' : ''}
                              {option.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </>
                  ) : (
                    <>
                      <Text className='text-bottomsheet-text-muted'>{label}</Text>
                      {field.fieldType === 'TICKET' ? (
                        <TicketReferenceField
                          value={text}
                          onChange={next => setField(field.fieldName, next)}
                        />
                      ) : (
                        <InputV2
                          variant='bottomsheet'
                          value={text}
                          editable={!saving}
                          onChangeText={next => setField(field.fieldName, next)}
                          placeholder={field.fieldName}
                          keyboardType={field.fieldType === 'NUMBER' ? 'decimal-pad' : 'default'}
                        />
                      )}
                    </>
                  )}
                </View>
              );
            })}
        </BottomSheetScrollView>
      </AppBottomSheet>
      {choice ? (
        <SingleSelectPickerSheet
          isOpen
          title={choice.title}
          options={choice.options}
          selectedValue={choice.value}
          onClose={() => setChoice(null)}
          onSelect={value => {
            choice.select(value);
            setChoice(null);
          }}
          searchable
        />
      ) : null}
      <UserPickerSheet
        isOpen={showAssignee}
        channelId={channelId}
        selectedUserId={assignee}
        onClose={() => setShowAssignee(false)}
        onSelect={value => {
          setAssignee(value);
          setGroup(null);
          setShowAssignee(false);
        }}
      />
      {dateField ? (
        <DatePickerSheet
          isOpen
          title={dateField === 'eta' ? 'Due date' : dateField}
          value={
            dateField === 'eta'
              ? eta
              : typeof values[dateField] === 'string' && values[dateField]
                ? Date.parse(values[dateField] as string)
                : null
          }
          allowClear
          onClose={() => setDateField(null)}
          onSelect={value => {
            if (dateField === 'eta') setEta(value);
            else setField(dateField, value ? new Date(value).toISOString() : '');
            setDateField(null);
          }}
        />
      ) : null}
    </>
  );
}
export function ThreadTicketSheet({
  isOpen,
  onClose,
  ...ids
}: {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  threadId: string;
}): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  return shouldRender ? <TicketBody key={ids.threadId} {...sheetProps} {...ids} /> : null;
}
