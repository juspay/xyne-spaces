import { expect, test } from '@playwright/test';

test('test', async ({ page }) => {
  await page.getByRole('button', { name: 'Direct Messages' }).hover();
  await page.getByTestId('create-new-dm').click();
  await page.getByTestId('user-search-input').click();
  await page.getByTestId('user-search-input').fill('test user 11');
  await page.getByText('Test User 11').click();
  await page.getByRole('paragraph').click();
  await page.getByTestId('message-input').fill('hellooo pls bookmark this');
  await page.getByTestId('send-message-button').click();
  await expect(page.getByText('hellooo pls bookmark this')).toBeVisible();
  await page
    .locator('div')
    .filter({ hasText: /^hellooo pls bookmark this$/ })
    .nth(1)
    .hover();
  await page.getByTestId('hover-action-add-bookmark').click();
  await page.getByTestId('open-bookmarks-button').click();
  await page.getByTestId('bookmark-mark-as-done-btn').click();
  await expect(
    page
      .getByTestId('chat-message-cmmeqjjv6000sg3wrkyfrz8t8')
      .getByText('hellooo pls bookmark this')
  ).toBeVisible();
  await page
    .locator('div')
    .filter({ hasText: /^hellooo pls bookmark this$/ })
    .nth(3)
    .hover();
  await page.getByTestId('hover-action-remove-bookmark').click();
  await page.getByTestId('bookmarks-go-back-link').click();
  await page.getByTestId('open-dms-button').click();
  await page.getByRole('button', { name: 'Open conversation with Test User' }).click();
  await page
    .locator('div')
    .filter({ hasText: /^hellooo pls bookmark this$/ })
    .nth(1)
    .hover();
  await expect(page.getByRole('button', { name: 'Add Bookmark' })).toBeVisible();
});
