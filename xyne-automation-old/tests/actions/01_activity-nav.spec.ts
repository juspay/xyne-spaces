import { expect, test } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:5173/chat/dir');
  await page.getByTestId('mobile-nav-activity').click();
  await expect(page.getByTestId('activity-heading')).toBeVisible();
  await expect(page.getByTestId('select-activity-heading')).toBeVisible();
  await page.getByRole('tab', { name: 'Actionable' }).click();
  await page.getByRole('tab', { name: 'FYI' }).click();
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByTestId('activity-more-options-btn').click();
  await page.getByTestId('activity-actionable-toggle').click();
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByRole('tab', { name: 'Your Mentions' }).click();
  await page.getByRole('tab', { name: 'Replies' }).click();
  await page.getByRole('tab', { name: 'Reactions' }).click();
  await page.getByRole('tab', { name: 'Tickets' }).click();
  await page.getByRole('tab', { name: 'Group Mentions' }).click();
  await page.getByTestId('activity-more-options-btn').click();
  await page.getByTestId('activity-view-detailed-btn').click();
  await page.getByTestId('activity-more-options-btn').click();
  await page.getByTestId('activity-actionable-toggle').click();
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByRole('tab', { name: 'Actionable' }).click();
  await page.getByRole('tab', { name: 'FYI' }).click();
});
