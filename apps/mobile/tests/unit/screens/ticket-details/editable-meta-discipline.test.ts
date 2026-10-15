import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Source discipline for ticket-details meta pickers / editing flow.
 * Catches regressions from messy rebases (duplicated imports, wrong sheet mode,
 * missing board cap, dropped date guards) without needing a device.
 */
const ROOT = process.cwd();

const readSource = (relativePath: string): string =>
  readFileSync(resolve(ROOT, relativePath), 'utf8');

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('ticket-details editable meta pickers', () => {
  it('meta picker shell is fullscreen (not dynamic)', () => {
    const source = withoutComments(
      readSource('src/screens/ticket-details/ticket-meta-picker-sheet.tsx'),
    );
    assert.match(source, /mode=['"]fullscreen['"]/);
    assert.doesNotMatch(source, /mode=['"]dynamic['"]/);
  });

  it('UserPickerSheet and SingleSelectPickerSheet reuse TicketMetaPickerSheet', () => {
    const userPicker = withoutComments(
      readSource('src/screens/ticket-details/user-picker-sheet.tsx'),
    );
    const singleSelect = withoutComments(
      readSource('src/screens/ticket-details/single-select-picker-sheet.tsx'),
    );
    assert.match(userPicker, /TicketMetaPickerSheet/);
    assert.match(singleSelect, /TicketMetaPickerSheet/);
    assert.doesNotMatch(userPicker, /mode=['"]fullscreen['"]/);
  });

  it('UserPickerSheet supports Unassigned via null onSelect and isUnassigned', () => {
    const source = withoutComments(readSource('src/screens/ticket-details/user-picker-sheet.tsx'));
    assert.match(source, /isUnassigned\?:/);
    assert.match(source, /onSelect:\s*\(userId:\s*string\s*\|\s*null\)\s*=>\s*void/);
    assert.match(source, /UnassignedRow/);
  });

  it('SingleSelectPickerSheet is generic and supports maxVisibleOptions', () => {
    const source = withoutComments(
      readSource('src/screens/ticket-details/single-select-picker-sheet.tsx'),
    );
    assert.match(source, /export function SingleSelectPickerSheet<T extends string>/);
    assert.match(source, /maxVisibleOptions\?:/);
    assert.doesNotMatch(
      source,
      /export type SingleSelectOption[\s\S]*export type SingleSelectOption/,
    );
  });

  it('TicketDetailsScreen composes pickers and editors modules', () => {
    const screen = withoutComments(readSource('src/screens/TicketDetailsScreen.tsx'));
    const editors = withoutComments(
      readSource('src/screens/ticket-details/use-ticket-details-editors.ts'),
    );
    const pickers = withoutComments(
      readSource('src/screens/ticket-details/ticket-details-pickers.tsx'),
    );
    assert.match(screen, /useTicketDetailsEditors/);
    assert.match(screen, /runTicketMutation\(/);
    assert.match(screen, /Failed to update title/);
    assert.match(screen, /Failed to update description/);
    assert.match(screen, /<TicketDetailsPickers\b/);
    assert.match(screen, /isUnassigned=\{assigneeRef === null\}/);
    assert.match(pickers, /<UserPickerSheet\b/);
    assert.match(pickers, /isUnassigned=\{isUnassigned\}/);
    assert.match(editors, /awaitMutation/);
    assert.match(editors, /mutators\.ticket\.updateAssignment/);
    assert.match(editors, /handleOpenPriorityPicker/);
    assert.match(pickers, /title=['"]Board['"]/);
    assert.match(pickers, /maxVisibleOptions=\{10\}/);
    assert.match(editors, /mutators\.ticket\.update\(\{[\s\S]*boardId/);
  });

  it('DatePickerSheet is shared and defaults Clear off for eta writes', () => {
    const source = withoutComments(readSource('src/screens/ticket-details/date-picker-sheet.tsx'));
    assert.match(source, /TicketMetaPickerSheet/);
    assert.match(source, /allowClear\s*=\s*false/);
    assert.match(source, /onSelect:\s*\(valueMs:\s*number\s*\|\s*null\)\s*=>\s*void/);
    assert.match(source, /mode\?:\s*DatePickerMode/);
    assert.match(source, /startOfDraft/);
    assert.match(source, /clampPickerSelection/);
  });

  it('TicketDetailsScreen wires Due Date and Status Deadline editors', () => {
    const screen = withoutComments(readSource('src/screens/TicketDetailsScreen.tsx'));
    const editors = withoutComments(
      readSource('src/screens/ticket-details/use-ticket-details-editors.ts'),
    );
    const pickers = withoutComments(
      readSource('src/screens/ticket-details/ticket-details-pickers.tsx'),
    );
    const metaRows = withoutComments(
      readSource('src/screens/ticket-details/overview-meta-rows.tsx'),
    );
    assert.match(screen, /buildOverviewMetaRows/);
    assert.match(pickers, /title=['"]Due Date['"]/);
    assert.match(pickers, /title=['"]Status Deadline['"]/);
    assert.match(pickers, /mode=['"]datetime['"]/);
    assert.match(pickers, /allowClear=\{false\}/);
    assert.match(editors, /decideDateUpdate/);
    assert.match(editors, /mutators\.ticket\.update\(\{[\s\S]*eta:/);
    assert.match(editors, /mutators\.ticketStageEta\.update\(/);
    assert.match(editors, /ETA cannot be set to a past date/);
    assert.match(editors, /Status Deadline cannot be set to a past date/);
    // Resolved off `mutators.ticket` and null-checked: the pinned shared ships
    // no acknowledgeEtaRisk mutator yet, so the call must stay guarded.
    assert.match(editors, /mutators\.ticket as typeof mutators\.ticket &/);
    assert.match(editors, /acknowledgeEtaRisk\(\{[\s\S]*expectedFingerprint:/);
    assert.match(metaRows, /<EtaManagementBadges\b/);
    assert.match(metaRows, /<EtaAcknowledgeBanner\b/);
  });

  it('TicketDetailsScreen wires Status / Type / Labels editors', () => {
    const editors = withoutComments(
      readSource('src/screens/ticket-details/use-ticket-details-editors.ts'),
    );
    const pickers = withoutComments(
      readSource('src/screens/ticket-details/ticket-details-pickers.tsx'),
    );
    assert.match(pickers, /title=['"]Status['"]/);
    assert.match(pickers, /title=['"]Type['"]/);
    assert.match(pickers, /title=['"]Labels['"]/);
    assert.match(pickers, /allowCreate/);
    assert.match(editors, /stageName/);
    assert.match(editors, /defaultTicketStatusV2/);
    assert.match(editors, /ticketType/);
    assert.match(editors, /Failed to update status/);
    assert.match(editors, /Failed to update type/);
    assert.match(editors, /runTicketMutation\(/);
    assert.match(editors, /diffLabelConfirmChanges/);
    assert.match(editors, /mutators\.ticketTagV2\.create\(/);
    assert.match(editors, /mutators\.ticketTagV2\.delete\(/);
    assert.match(editors, /buildTicketTagV2DeleteArgs\(/);
    assert.doesNotMatch(editors, /mutators\.ticketTagV2\.delete\(\{\s*tagId:\s*mappingId/);
  });

  it('TicketDetailsScreen wires editable User Group without assignee fallthrough', () => {
    const screen = withoutComments(readSource('src/screens/TicketDetailsScreen.tsx'));
    const overview = withoutComments(
      readSource('src/screens/ticket-details/editable-ticket-overview.tsx'),
    );
    const editors = withoutComments(
      readSource('src/screens/ticket-details/use-ticket-details-editors.ts'),
    );
    const pickers = withoutComments(
      readSource('src/screens/ticket-details/ticket-details-pickers.tsx'),
    );
    const metaRows = withoutComments(
      readSource('src/screens/ticket-details/overview-meta-rows.tsx'),
    );

    assert.match(screen, /resolveTicketUserGroupId/);
    assert.match(screen, /resolveAssigneePickerGroupId/);
    assert.match(screen, /formatUserGroupDisplayName/);
    assert.match(screen, /buildUserGroupOptions/);
    assert.match(screen, /assigneePickerGroupId=\{assigneePickerGroupId\}/);
    assert.match(screen, /ticketUserGroupId=\{ticketUserGroupId\}/);
    assert.doesNotMatch(screen, /userGroupId\s*=\s*[\s\S]*assigneeGroupId/);

    assert.match(overview, /resolveTicketUserGroupId/);
    assert.match(overview, /resolveAssigneePickerGroupId/);
    assert.match(overview, /formatUserGroupDisplayName/);
    assert.match(overview, /buildUserGroupOptions/);
    assert.match(overview, /runTicketMutation\(/);
    assert.match(overview, /Failed to update title/);
    assert.match(overview, /Failed to update description/);
    assert.match(overview, /userGroupOptions=\{userGroupOptions\}/);
    assert.match(overview, /assigneePickerGroupId=\{assigneePickerGroupId\}/);
    assert.match(overview, /ticketUserGroupId=\{ticketUserGroupId\}/);
    assert.doesNotMatch(overview, /userGroupId\s*=\s*[\s\S]*assigneeGroupId/);

    assert.match(editors, /handleOpenUserGroupPicker/);
    assert.match(editors, /handleSelectUserGroup/);
    assert.match(editors, /mutators\.ticket\.update\(\{[\s\S]*userGroupId:/);
    assert.match(pickers, /title=['"]User Group['"]/);
    assert.match(pickers, /assigneePickerGroupId/);
    assert.match(metaRows, /key:\s*['"]user-group['"]/);
    assert.match(metaRows, /onOpenUserGroup/);
  });

  it('OverviewTab supports optional meta row footers (planning-risk banner)', () => {
    const types = withoutComments(readSource('src/screens/ticket-details/types.ts'));
    const overview = withoutComments(readSource('src/screens/ticket-details/tabs/OverviewTab.tsx'));
    assert.match(types, /footer\?:\s*ReactNode/);
    assert.match(overview, /row\.footer/);
  });
});
