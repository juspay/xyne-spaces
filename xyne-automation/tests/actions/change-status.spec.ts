import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:5173/chat/dit');
  await page.getByText('T').nth(1).click();
  await page.getByTestId('set-status-btn').click();
  // SKIPPED: Dynamic list item - using text-based selector
  await page.getByRole('button', { name: '📅 In a meeting - 1 hour' }).click();
  await page.getByTestId('update-status-save-btn').click();

});