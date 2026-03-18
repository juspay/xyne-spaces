import { test, expect } from '@playwright/test';

test('www', async ({ browser }) => {

  // ============================================
  // User 1: Admin
  // ============================================
  const user1Context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const user1Page = await user1Context.newPage();


  // ============================================
  // User 2: User 2
  // ============================================
  const user2Context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const user2Page = await user2Context.newPage();

  // ============================================
  // Recorded Multi-User Interactions
  // ============================================


  // --- Admin (user1Page) ---
  await user1Page.goto('http://localhost:5173/auth?isAdmin=true');

  // --- User 2 (user2Page) ---
  await user2Page.goto('http://localhost:5173/auth');
  await user2Page.waitForURL('http://localhost:5173/');
  await user2Page.waitForURL('http://localhost:5173/onboarding');
  await user2Page.getByText('Get Started ->').click();
  await user2Page.getByText('->').click();
  await user2Page.getByText('->').click();
  await user2Page.getByText('->').click();
  await user2Page.getByText('Open My Workspace→').click();
  await user2Page.waitForURL('http://localhost:5173/chat/dir');

  // --- Admin (user1Page) ---
  await user1Page.getByText('Sign in with Google').click();
  await user1Page.waitForURL('http://localhost:5173/');
  await user1Page.waitForURL('http://localhost:5173/onboarding');
  await user1Page.getByText('Get Started ->').click();
  await user1Page.getByText('->').click();
  await user1Page.getByText('->').click();
  await user1Page.getByText('->').click();
  await user1Page.getByText('Open My Workspace→').click();
  await user1Page.waitForURL('http://localhost:5173/chat/dir');
  await expect(user1Page.getByText('Direct Messages')).toBeVisible();
  await user1Page.getByTestId('create-new-dm').click();
  await user1Page.waitForURL('http://localhost:5173/chat/search?mode=dm');
  await user1Page.getByTestId('user-search-input').fill('test user');
  await user1Page.getByTestId('user-search-input').fill('test user ');
  await user1Page.getByTestId('user-search-input').fill('test user 8');
  await user1Page.getByTestId('user-search-input').fill('test user 9');
  await user1Page.getByTestId('user-search-results').click();
  await user1Page.getByTestId('message-input').click();
  await user1Page.getByTestId('message-input').fill('hi');
  await user1Page.getByTestId('message-input').press('Enter');
  await user1Page.waitForURL('http://localhost:5173/chat/dir/cmmvs70uv02n711xmy2rzgsht');

  // --- User 2 (user2Page) ---
  await user2Page.getByTestId('create-new-dm').click();
  await user2Page.waitForURL('http://localhost:5173/chat/search?mode=dm');
  await user2Page.getByTestId('user-search-input').fill('test user 9');
  await user2Page.getByTestId('user-search-results').click();
  await user2Page.getByTestId('message-input').click();
  await user2Page.getByTestId('message-input').fill('hi');
  await user2Page.getByTestId('message-input').press('Enter');
  await user2Page.waitForURL('http://localhost:5173/chat/dir/cmmvs77i002no11xmzicl2rv4');

  // --- Admin (user1Page) ---
  await user1Page.getByTestId('dm-list').click();
  await user1Page.waitForURL('http://localhost:5173/chat/dir/cmmvs77i002no11xmzicl2rv4');
  await expect(user1Page.getByTestId('chat-message-cmmvs77ip02o211xmip6j12rr')).toBeVisible();
});
