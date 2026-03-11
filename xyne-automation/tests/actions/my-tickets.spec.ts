import { test } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:5173/chat/dir');
  await page.getByTestId('my-tickets-btn').click();
  await page.getByTestId('more-filters-btn').click();
  await page.getByTestId('filter-menu-priority').click();
  await page.getByTestId('priority-filter-low').click();
  await page.getByTestId('priority-filter-medium').click();
  await page.getByTestId('priority-filter-high').click();
  await page.getByTestId('priority-filter-critical').click();
  await page.getByTestId('filter-menu-userGroups').click();
  // Dynamic items - keeping original selectors
  await page.getByRole('button', { name: 'ADMIN' }).click();
  await page.getByRole('button', { name: 'DEVELOPER' }).click();
  await page.getByRole('button', { name: 'VIEWER', exact: true }).click();
  await page.getByTestId('clear-filters-btn').click();
  await page.getByTestId('table-view-btn').click();
  await page.getByTestId('calendar-view-btn').click();
  await page.getByTestId('kanban-view-btn').click();
  await page.getByTestId('group-by-dropdown').click();
  await page.getByTestId('group-by-assignee').click();
  await page.getByTestId('group-by-dropdown').click();
  await page.getByTestId('group-by-status').click();
  await page.getByTestId('group-by-dropdown').click();
  await page.getByTestId('group-by-priority').click();
});
