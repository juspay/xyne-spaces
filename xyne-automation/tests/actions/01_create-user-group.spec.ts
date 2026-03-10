import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:5173/chat/dir');
  await page.getByTestId('nav-user-groups').click();
  await page.getByTestId('create-user-group-btn').click();
  await page.getByTestId('user-group-name-input').click();
  await page.getByTestId('user-group-name-input').fill('hii-user-group');
  await page.getByTestId('members-tab-btn').click();
  await page.getByTestId('search-members-input').click();
  await page.getByTestId('search-members-input').fill('test user 1');
  await page.getByRole('button', { name: 'Add to Group' }).first().click();
  await page.getByTestId('search-members-input').fill('test user 2');
  await page.getByRole('button', { name: 'Add to Group' }).first().click();
  await page.getByTestId('search-members-input').click();
  await page.getByTestId('search-members-input').fill('test user 3');
  await page.getByRole('button', { name: 'Add to Group' }).first().click();
  await page.getByTestId('submit-user-group-btn').click();
  await expect(page.getByRole('heading', { name: 'hii-user-group' })).toBeVisible();
  await expect(page.getByText('3members').first()).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).first().click();
});