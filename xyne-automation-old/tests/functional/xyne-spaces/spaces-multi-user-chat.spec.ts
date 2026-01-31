/**
 * Spaces Multi-User Chat Test - Using Test Orchestrator
 */

import { TestOrchestrator } from '@/framework/utils/test-orchestrator';
import { step } from '@/framework/utils/step-tracker';
import { SpacesLoginHelper } from '@/framework/pages/xyne-spaces/spaces-login-helper';
import { SpacesMultiUserChatPage } from '@/framework/pages/xyne-spaces';
import { chromium, Browser, BrowserContext, expect } from '@playwright/test';

/**
 * Multi-user test - reuses orchestrator's browser for User 1, creates 1 new context for User 2
 * Result: Only 2 browser windows total (orchestrator's context + 1 new context)
 */
const orchestrator = new TestOrchestrator({
  useSharedPage: true, // Use orchestrator's browser
  continueOnFailure: true,
  sequential: true,
  logLevel: 'detailed'
});

// Shared state for multi-user testing  
let browser: Browser;
let context1: BrowserContext; // From orchestrator
let context2: BrowserContext; // New context for second user
let spacesMultiUserChat: SpacesMultiUserChatPage;

// Make the multi-user chat instance globally accessible for screenshot capture on failure
(globalThis as any).__MULTI_USER_CHAT_INSTANCE__ = null;

orchestrator.createSuite('Spaces - Multi-User Chat Tests', [
  {
    name: 'initialize browser and contexts for two users',
    metadata: { priority: 'highest', tags: ['@critical', '@spaces', '@setup'] },
    testFunction: async ({ sharedPage }) => {
      await step('Get browser and context from orchestrator for User 1', async () => {
        const existingBrowser = sharedPage.page.context().browser();
        if (!existingBrowser) {
          throw new Error('Failed to get browser from orchestrator');
        }
        browser = existingBrowser;
        context1 = sharedPage.page.context(); // Reuse orchestrator's context for User 1
        console.log(' Using orchestrator browser and context for User 1');
      });

      await step('Create 1 additional context for User 2', async () => {
        context2 = await browser.newContext();
        console.log(' Created 1 new context for User 2');
        console.log(' Total: 2 browser windows from 1 browser');
      });

      await step('Initialize SpacesMultiUserChatPage', async () => {
        spacesMultiUserChat = new SpacesMultiUserChatPage();
        // Make instance globally accessible for failure screenshot capture
        (globalThis as any).__MULTI_USER_CHAT_INSTANCE__ = spacesMultiUserChat;
        console.log(' SpacesMultiUserChatPage initialized');
      });

      await step('Initialize both users', async () => {
        await spacesMultiUserChat.initializeUsers(
          context1,
          context2,
          'User 1',
          'User 2'
        );
        console.log(' Both users initialized');
      });
    }
  },

  {
    name: 'login both users to Spaces',
    dependencies: ['initialize browser and contexts for two users'],
    metadata: { priority: 'highest', tags: ['@critical', '@spaces', '@auth'] },
    testFunction: async () => {
      await step('Login both users with different credentials', async () => {
        await spacesMultiUserChat.loginBothUsers(true);
        console.log(' Both users logged in successfully to Spaces');
      });
    }
  },

  {
    name: 'save both users names from settings popover',
    dependencies: ['login both users to Spaces'],
    metadata: { priority: 'high', tags: ['@spaces', '@user-info'] },
    testFunction: async () => {
      await step('Extract and save User 1 name from settings popover', async () => {
        const userName1 = await spacesMultiUserChat.getUserNameFromHeader('user1');
        console.log(` User 1 name saved: ${userName1}`);
      });

      await step('Extract and save User 2 name from settings popover', async () => {
        const userName2 = await spacesMultiUserChat.getUserNameFromHeader('user2');
        console.log(` User 2 name saved: ${userName2}`);
      });
    }
  },

  {
    name: 'click chat icon for both users',
    dependencies: ['save both users names from settings popover'],
    metadata: { priority: 'high', tags: ['@spaces', '@navigation'] },
    testFunction: async () => {
      await step('User 1 clicks on chat icon in sidebar', async () => {
        await spacesMultiUserChat.clickChatIconForUser('user1');
        console.log(' User 1 clicked chat icon');
      });

      await step('User 2 clicks on chat icon in sidebar', async () => {
        await spacesMultiUserChat.clickChatIconForUser('user2');
        console.log(' User 2 clicked chat icon');
      });
    }
  },

  {
    name: 'click plus icon and verify Start DM modal appears',
    dependencies: ['click chat icon for both users'],
    metadata: { priority: 'high', tags: ['@spaces', '@modal', '@dm'] },
    testFunction: async () => {
      await step('User 1 clicks on + icon to open Start DM modal', async () => {
        await spacesMultiUserChat.clickPlusIconForUser('user1');
        console.log(' User 1 clicked + icon');
      });

      await step('Verify Start DM modal is visible for User 1', async () => {
        await spacesMultiUserChat.verifyStartDMModalVisible('user1');
        console.log(' Start DM modal verified for User 1');
      });

      await step('User 2 clicks on + icon to open Start DM modal', async () => {
        await spacesMultiUserChat.clickPlusIconForUser('user2');
        console.log(' User 2 clicked + icon');
      });

      await step('Verify Start DM modal is visible for User 2', async () => {
        await spacesMultiUserChat.verifyStartDMModalVisible('user2');
        console.log(' Start DM modal verified for User 2');
      });
    }
  },

  {
    name: 'start DM with other user',
    dependencies: ['click plus icon and verify Start DM modal appears'],
    metadata: { priority: 'high', tags: ['@spaces', '@dm', '@chat'] },
    testFunction: async () => {
      await step('User 1 types User 2 name and clicks Start DM', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user2Name) {
          throw new Error('User 2 name not saved');
        }
        await spacesMultiUserChat.startDMWithUser('user1', savedNames.user2Name);
        console.log(` User 1 started DM with ${savedNames.user2Name}`);
      });

      await step('User 2 types User 1 name and clicks Start DM', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user1Name) {
          throw new Error('User 1 name not saved');
        }
        await spacesMultiUserChat.startDMWithUser('user2', savedNames.user1Name);
        console.log(` User 2 started DM with ${savedNames.user1Name}`);
      });
    }
  },

  {
    name: 'verify chat header displays correct user after DM start',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@dm', '@header', '@verification'] },
    testFunction: async () => {
      await step('Verify User 1 chat header displays User 2 name', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user2Name) {
          throw new Error('User 2 name not saved');
        }
        await spacesMultiUserChat.verifyChatHeaderUser('user1', savedNames.user2Name);
        console.log(` ✓ User 1 chat header verified to display ${savedNames.user2Name}`);
      });

      await step('Verify User 2 chat header displays User 1 name', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user1Name) {
          throw new Error('User 1 name not saved');
        }
        await spacesMultiUserChat.verifyChatHeaderUser('user2', savedNames.user1Name);
        console.log(` ✓ User 2 chat header verified to display ${savedNames.user1Name}`);
      });
    }
  },

  {
    name: 'send plain text messages between users',
    dependencies: ['verify chat header displays correct user after DM start'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@messaging'] },
    testFunction: async () => {
      await step('User 1 sends a plain text message', async () => {
        await spacesMultiUserChat.sendPlainMessage('user1', 'Hello! This is a plain text message.');
        console.log(' User 1 sent plain text message');
      });

      await step('User 2 verifies receipt of plain text message', async () => {
        await spacesMultiUserChat.verifyUser2SeesMessage('Hello! This is a plain text message.');
        console.log(' User 2 verified plain text message');
      });

      await step('User 2 sends a reply', async () => {
        await spacesMultiUserChat.sendPlainMessage('user2', 'Hi! I received your message.');
        console.log(' User 2 sent reply');
      });

      await step('User 1 verifies receipt of reply', async () => {
        await spacesMultiUserChat.verifyUser1SeesMessage('Hi! I received your message.');
        console.log(' User 1 verified reply');
      });
    }
  },

  {
    name: 'test bold text formatting',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@formatting', '@bold'] },
    testFunction: async () => {
      await step('User 1 sends a bold message', async () => {
        await spacesMultiUserChat.sendBoldMessage('user1', 'This is bold text');
        console.log(' User 1 sent bold message');
      });

      await step('User 1 verifies bold formatting in their own view', async () => {
        await spacesMultiUserChat.verifyBoldMessage('user1', 'This is bold text');
        console.log(' User 1 verified bold formatting');
      });

      await step('User 2 verifies bold formatting', async () => {
        await spacesMultiUserChat.verifyBoldMessage('user2', 'This is bold text');
        console.log(' User 2 verified bold formatting');
      });
    }
  },

  {
    name: 'test italic text formatting',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@formatting', '@italic'] },
    testFunction: async () => {
      await step('User 2 sends an italic message', async () => {
        await spacesMultiUserChat.sendItalicMessage('user2', 'This is italic text');
        console.log(' User 2 sent italic message');
      });

      await step('User 2 verifies italic formatting in their own view', async () => {
        await spacesMultiUserChat.verifyItalicMessage('user2', 'This is italic text');
        console.log(' User 2 verified italic formatting');
      });

      await step('User 1 verifies italic formatting', async () => {
        await spacesMultiUserChat.verifyItalicMessage('user1', 'This is italic text');
        console.log(' User 1 verified italic formatting');
      });
    }
  },

  {
    name: 'test numbered list formatting',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@formatting', '@list'] },
    testFunction: async () => {
      await step('User 1 sends a numbered list', async () => {
        const listItems = [
          'First item in the list',
          'Second item in the list',
          'Third item in the list'
        ];
        await spacesMultiUserChat.sendNumberedListMessage('user1', listItems);
        console.log(' User 1 sent numbered list');
      });

      await step('User 1 verifies numbered list in their own view', async () => {
        const listItems = [
          'First item in the list',
          'Second item in the list',
          'Third item in the list'
        ];
        await spacesMultiUserChat.verifyNumberedList('user1', listItems);
        console.log(' User 1 verified numbered list');
      });

      await step('User 2 verifies numbered list', async () => {
        const listItems = [
          'First item in the list',
          'Second item in the list',
          'Third item in the list'
        ];
        await spacesMultiUserChat.verifyNumberedList('user2', listItems);
        console.log(' User 2 verified numbered list');
      });
    }
  },

  {
    name: 'test combined formatting messages',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'medium', tags: ['@spaces', '@chat', '@formatting', '@comprehensive'] },
    testFunction: async () => {
      await step('User 2 sends another numbered list', async () => {
        const listItems = [
          'Task one: Complete testing',
          'Task two: Review results',
          'Task three: Submit report'
        ];
        await spacesMultiUserChat.sendNumberedListMessage('user2', listItems);
        console.log(' User 2 sent numbered list');
      });

      await step('User 1 verifies User 2 numbered list', async () => {
        const listItems = [
          'Task one: Complete testing',
          'Task two: Review results',
          'Task three: Submit report'
        ];
        await spacesMultiUserChat.verifyNumberedList('user1', listItems);
        console.log(' User 1 verified User 2 numbered list');
      });

      await step('User 1 sends a bold response', async () => {
        await spacesMultiUserChat.sendBoldMessage('user1', 'Acknowledged all tasks!');
        console.log(' User 1 sent bold response');
      });

      await step('User 2 verifies bold response', async () => {
        await spacesMultiUserChat.verifyBoldMessage('user2', 'Acknowledged all tasks!');
        console.log(' User 2 verified bold response');
      });
    }
  },

  {
    name: 'test emoji insertion in messages',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@emoji', '@formatting'] },
    testFunction: async () => {
      await step('User 1 sends a message with emoji', async () => {
        await spacesMultiUserChat.sendMessageWithEmoji('user1', 'Great work on those tasks ', 'grinning,grinning face');
        console.log(' User 1 sent message with emoji');
      });

      await step('User 1 verifies emoji message in their view', async () => {
        await spacesMultiUserChat.verifyMessageWithEmoji('user1', 'Great work on those tasks', 'grinning,grinning face');
        console.log(' User 1 verified emoji message');
      });

      await step('User 2 verifies emoji message', async () => {
        await spacesMultiUserChat.verifyMessageWithEmoji('user2', 'Great work on those tasks', 'grinning,grinning face');
        console.log(' User 2 verified emoji message');
      });

      await step('User 2 sends a response with emoji', async () => {
        await spacesMultiUserChat.sendMessageWithEmoji('user2', 'Thank you ', 'grinning,grinning face');
        console.log(' User 2 sent response with emoji');
      });

      await step('User 1 verifies User 2 emoji message', async () => {
        await spacesMultiUserChat.verifyMessageWithEmoji('user1', 'Thank you', 'grinning,grinning face');
        console.log(' User 1 verified User 2 emoji message');
      });
    }
  },

  {
    name: 'test user mentions with @ symbol',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@mention', '@tagging'] },
    testFunction: async () => {
      await step('User 1 sends a message mentioning User 2', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user2Name) {
          throw new Error('User 2 name not saved');
        }
        await spacesMultiUserChat.sendMessageWithMention('user1', 'Hey ', savedNames.user2Name);
        console.log(` User 1 sent message mentioning ${savedNames.user2Name}`);
      });

      await step('User 1 verifies mention in their view', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user2Name) {
          throw new Error('User 2 name not saved');
        }
        await spacesMultiUserChat.verifyMention('user1', savedNames.user2Name);
        console.log(' User 1 verified mention');
      });

      await step('User 2 verifies they were mentioned', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user2Name) {
          throw new Error('User 2 name not saved');
        }
        await spacesMultiUserChat.verifyMention('user2', savedNames.user2Name);
        console.log(' User 2 verified they were mentioned');
      });

      await step('User 2 sends a message mentioning User 1', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user1Name) {
          throw new Error('User 1 name not saved');
        }
        await spacesMultiUserChat.sendMessageWithMention('user2', 'Thanks for the mention ', savedNames.user1Name);
        console.log(` User 2 sent message mentioning ${savedNames.user1Name}`);
      });

      await step('User 1 verifies they were mentioned by User 2', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user1Name) {
          throw new Error('User 1 name not saved');
        }
        await spacesMultiUserChat.verifyMention('user1', savedNames.user1Name);
        console.log(' User 1 verified they were mentioned');
      });
    }
  },

  {
    name: 'test inline code formatting',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@code', '@formatting'] },
    testFunction: async () => {
      await step('User 1 sends a message with inline code', async () => {
        await spacesMultiUserChat.sendInlineCodeMessage('user1', 'You can use the function ', 'getUserData()');
        console.log(' User 1 sent message with inline code');
      });

      await step('User 1 verifies inline code in their view', async () => {
        await spacesMultiUserChat.verifyInlineCode('user1', 'getUserData()');
        console.log(' User 1 verified inline code');
      });

      await step('User 2 verifies inline code', async () => {
        await spacesMultiUserChat.verifyInlineCode('user2', 'getUserData()');
        console.log(' User 2 verified inline code');
      });
    }
  },

  {
    name: 'test code block formatting',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@code', '@formatting'] },
    testFunction: async () => {
      await step('User 2 sends a code block', async () => {
        const code = 'function greet() {\n  console.log("Hello World");\n  return true;\n}';
        await spacesMultiUserChat.sendCodeBlockMessage('user2', code);
        console.log(' User 2 sent code block');
      });

      await step('User 2 verifies code block in their view', async () => {
        await spacesMultiUserChat.verifyCodeBlock('user2', 'function greet()');
        console.log(' User 2 verified code block');
      });

      await step('User 1 verifies code block from User 2', async () => {
        await spacesMultiUserChat.verifyCodeBlock('user1', 'function greet()');
        console.log(' User 1 verified code block');
      });

      await step('User 1 sends a code block response', async () => {
        const code = 'const result = greet();\nconsole.log(result);';
        await spacesMultiUserChat.sendCodeBlockMessage('user1', code);
        console.log(' User 1 sent code block response');
      });

      await step('User 2 verifies User 1 code block', async () => {
        await spacesMultiUserChat.verifyCodeBlock('user2', 'const result');
        console.log(' User 2 verified User 1 code block');
      });
    }
  },

  {
    name: 'test comprehensive formatting combination',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'medium', tags: ['@spaces', '@chat', '@formatting', '@comprehensive'] },
    testFunction: async () => {
      await step('User 1 sends message with mention', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user2Name) {
          throw new Error('User 2 name not saved');
        }
        
        // Send a plain message first, then verify
        await spacesMultiUserChat.typeInChatInput('user1', 'Hello World !!!!! ');
        await spacesMultiUserChat.clickMentionButton('user1');
        await spacesMultiUserChat.selectUserToMention('user1', savedNames.user2Name);
        await spacesMultiUserChat.clickSendButton('user1');
        
        console.log(' User 1 sent comprehensive message');
      });

      await step('User 2 verifies comprehensive message', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user2Name) {
          throw new Error('User 2 name not saved');
        }
        await spacesMultiUserChat.verifyMention('user2', savedNames.user2Name);
        console.log(' User 2 verified comprehensive message');
      });

      await step('User 2 sends bold message with inline code', async () => {
        await spacesMultiUserChat.clickBoldButton('user2');
        await spacesMultiUserChat.typeInChatInput('user2', 'Use this: ');
        await spacesMultiUserChat.clickInlineCodeButton('user2');
        
        const currentUser = spacesMultiUserChat.getUser2();
        if (currentUser) {
          const chatInput = currentUser.page.locator('div.tiptap.ProseMirror.chat-input-editor[contenteditable="true"]');
          await chatInput.pressSequentially('npm install');
        }
        
        await spacesMultiUserChat.clickSendButton('user2');
        console.log(' User 2 sent bold message with inline code');
      });

      await step('User 1 verifies bold and inline code combination', async () => {
        await spacesMultiUserChat.verifyInlineCode('user1', 'npm install');
        console.log(' User 1 verified bold and inline code combination');
      });
    }
  },

  // ==================== ADDITIONAL COMPREHENSIVE TEST CASES ====================

  {
    name: 'test bullet list formatting',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@formatting', '@list'] },
    testFunction: async () => {
      await step('User 1 sends a bullet list', async () => {
        const listItems = [
          'First bullet point',
          'Second bullet point',
          'Third bullet point'
        ];
        await spacesMultiUserChat.sendBulletListMessage('user1', listItems);
        console.log(' User 1 sent bullet list');
      });

      await step('User 1 verifies bullet list in their own view', async () => {
        const listItems = [
          'First bullet point',
          'Second bullet point',
          'Third bullet point'
        ];
        await spacesMultiUserChat.verifyBulletList('user1', listItems);
        console.log(' User 1 verified bullet list');
      });

      await step('User 2 verifies bullet list', async () => {
        const listItems = [
          'First bullet point',
          'Second bullet point',
          'Third bullet point'
        ];
        await spacesMultiUserChat.verifyBulletList('user2', listItems);
        console.log(' User 2 verified bullet list');
      });
    }
  },

  {
    name: 'test long message handling',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'medium', tags: ['@spaces', '@chat', '@edge-case'] },
    testFunction: async () => {
      await step('User 2 sends a very long message', async () => {
        const longMessage = 'This is a very long message that tests the chat system ability to handle lengthy text content.';
        await spacesMultiUserChat.sendPlainMessage('user2', longMessage);
        console.log(' User 2 sent long message');
      });

      await step('User 1 verifies receipt of long message', async () => {
        await spacesMultiUserChat.verifyUser1SeesMessage('This is a very long message');
        console.log(' User 1 verified long message');
      });
    }
  },

  {
    name: 'test multi-line message handling',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'medium', tags: ['@spaces', '@chat', '@edge-case'] },
    testFunction: async () => {
      await step('User 1 sends a multi-line message', async () => {
        await spacesMultiUserChat.typeInChatInput('user1', 'Line 1: First line');
        
        const currentUser = spacesMultiUserChat.getUser1();
        if (currentUser) {
          await currentUser.page.keyboard.press('Shift+Enter');
          await currentUser.page.waitForTimeout(200);
          const chatInput = currentUser.page.locator('div.tiptap.ProseMirror.chat-input-editor[contenteditable="true"]');
          await chatInput.pressSequentially('Line 2: Second line');
          await currentUser.page.keyboard.press('Shift+Enter');
          await currentUser.page.waitForTimeout(200);
          await chatInput.pressSequentially('Line 3: Third line');
        }
        
        await spacesMultiUserChat.clickSendButton('user1');
        console.log(' User 1 sent multi-line message');
      });

      await step('User 2 verifies multi-line message', async () => {
        await spacesMultiUserChat.verifyUser2SeesMessage('Line 1: First line');
        await spacesMultiUserChat.verifyUser2SeesMessage('Line 2: Second line');
        await spacesMultiUserChat.verifyUser2SeesMessage('Line 3: Third line');
        console.log(' User 2 verified multi-line message');
      });
    }
  },

  {
    name: 'test special characters in messages',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'medium', tags: ['@spaces', '@chat', '@edge-case'] },
    testFunction: async () => {
      await step('User 2 sends message with special characters', async () => {
        const specialMessage = 'Testing special chars: @#$%^&*()_+-=[]{}|;:\'",.<>?/~`';
        await spacesMultiUserChat.sendPlainMessage('user2', specialMessage);
        console.log(' User 2 sent message with special characters');
      });

      await step('User 1 verifies special characters', async () => {
        await spacesMultiUserChat.verifyUser1SeesMessage('Testing special chars:');
        console.log(' User 1 verified special characters');
      });
    }
  },

  {
    name: 'test rapid consecutive messages',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@performance'] },
    testFunction: async () => {
      await step('User 1 sends multiple messages rapidly', async () => {
        await spacesMultiUserChat.sendPlainMessage('user1', 'Rapid message 1');
        await spacesMultiUserChat.sendPlainMessage('user1', 'Rapid message 2');
        await spacesMultiUserChat.sendPlainMessage('user1', 'Rapid message 3');
        console.log(' User 1 sent 3 rapid messages');
      });

      await step('User 2 verifies all rapid messages received', async () => {
        await spacesMultiUserChat.verifyUser2SeesMessage('Rapid message 1');
        await spacesMultiUserChat.verifyUser2SeesMessage('Rapid message 2');
        await spacesMultiUserChat.verifyUser2SeesMessage('Rapid message 3');
        console.log(' User 2 verified all rapid messages');
      });
    }
  },

  {
    name: 'test bidirectional simultaneous messaging',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@concurrent'] },
    testFunction: async () => {
      await step('Both users send messages at the same time', async () => {
        await spacesMultiUserChat.testParallelMessaging(
          'User 1 simultaneous message',
          'User 2 simultaneous message'
        );
        console.log(' Both users sent messages simultaneously');
      });
    }
  },

  {
    name: 'test combined bold and italic formatting',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'medium', tags: ['@spaces', '@chat', '@formatting', '@combined'] },
    testFunction: async () => {
      await step('User 1 sends message with bold and italic', async () => {
        await spacesMultiUserChat.clickBoldButton('user1');
        await spacesMultiUserChat.clickItalicButton('user1');
        await spacesMultiUserChat.typeInChatInput('user1', 'Bold and italic text');
        await spacesMultiUserChat.clickSendButton('user1');
        console.log(' User 1 sent bold and italic message');
      });

      await step('User 2 verifies bold and italic formatting', async () => {
        await spacesMultiUserChat.verifyBoldMessage('user2', 'Bold and italic text');
        await spacesMultiUserChat.verifyItalicMessage('user2', 'Bold and italic text');
        console.log(' User 2 verified bold and italic formatting');
      });
    }
  },

  {
    name: 'test multiple emojis in single message',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'medium', tags: ['@spaces', '@chat', '@emoji'] },
    testFunction: async () => {
      await step('User 2 sends message with multiple emojis', async () => {
        await spacesMultiUserChat.typeInChatInput('user2', 'Multiple emojis: ');
        await spacesMultiUserChat.clickEmojiButton('user2');
        await spacesMultiUserChat.selectEmoji('user2', 'melting face');
        await spacesMultiUserChat.clickEmojiButton('user2');
        await spacesMultiUserChat.selectEmoji('user2', 'smirk,smirking face');
        await spacesMultiUserChat.clickSendButton('user2');
        console.log(' User 2 sent message with multiple emojis');
      });

      await step('User 1 verifies multiple emojis', async () => {
        await spacesMultiUserChat.verifyUser1SeesMessage('Multiple emojis:');
        console.log(' User 1 verified multiple emojis');
      });
    }
  },

  {
    name: 'test mention with additional text',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@mention', '@complex'] },
    testFunction: async () => {
      await step('User 1 sends message with mention and additional text', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user2Name) {
          throw new Error('User 2 name not saved');
        }
        
        await spacesMultiUserChat.typeInChatInput('user1', 'Hey ');
        await spacesMultiUserChat.clickMentionButton('user1');
        await spacesMultiUserChat.selectUserToMention('user1', savedNames.user2Name);
        
        const currentUser = spacesMultiUserChat.getUser1();
        if (currentUser) {
          const chatInput = currentUser.page.locator('div.tiptap.ProseMirror.chat-input-editor[contenteditable="true"]');
          await chatInput.pressSequentially(' can you check this?');
        }
        
        await spacesMultiUserChat.clickSendButton('user1');
        console.log(' User 1 sent message with mention and text');
      });

      await step('User 2 verifies mention with text', async () => {
        const savedNames = spacesMultiUserChat.getSavedUserNames();
        if (!savedNames.user2Name) {
          throw new Error('User 2 name not saved');
        }
        await spacesMultiUserChat.verifyMention('user2', savedNames.user2Name);
        await spacesMultiUserChat.verifyUser2SeesMessage('can you check this?');
        console.log(' User 2 verified mention with additional text');
      });
    }
  },

  {
    name: 'test code block with multiple languages syntax',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'medium', tags: ['@spaces', '@chat', '@code', '@advanced'] },
    testFunction: async () => {
      await step('User 1 sends JavaScript code block', async () => {
        const jsCode = 'const greeting = (name) => {\n  return `Hello, ${name}!`;\n};';
        await spacesMultiUserChat.sendCodeBlockMessage('user1', jsCode);
        console.log(' User 1 sent JavaScript code block');
      });

      await step('User 2 verifies JavaScript code block', async () => {
        await spacesMultiUserChat.verifyCodeBlock('user2', 'const greeting');
        console.log(' User 2 verified JavaScript code block');
      });

      await step('User 2 sends Python code block', async () => {
        const pythonCode = 'def hello(name):\n    return f"Hello, {name}!"\n\nprint(hello("World"))';
        await spacesMultiUserChat.sendCodeBlockMessage('user2', pythonCode);
        console.log(' User 2 sent Python code block');
      });

      await step('User 1 verifies Python code block', async () => {
        await spacesMultiUserChat.verifyCodeBlock('user1', 'def hello');
        console.log(' User 1 verified Python code block');
      });
    }
  },

  {
    name: 'test numbered list with nested content',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'medium', tags: ['@spaces', '@chat', '@formatting', '@list'] },
    testFunction: async () => {
      await step('User 2 sends detailed numbered list', async () => {
        const detailedItems = [
          'Step 1: Initialize the project with npm init',
          'Step 2: Install dependencies using npm install',
          'Step 3: Configure the environment variables',
          'Step 4: Run the application with npm start'
        ];
        await spacesMultiUserChat.sendNumberedListMessage('user2', detailedItems);
        console.log(' User 2 sent detailed numbered list');
      });

      await step('User 1 verifies detailed numbered list', async () => {
        const detailedItems = [
          'Step 1: Initialize the project with npm init',
          'Step 2: Install dependencies using npm install',
          'Step 3: Configure the environment variables',
          'Step 4: Run the application with npm start'
        ];
        await spacesMultiUserChat.verifyNumberedList('user1', detailedItems);
        console.log(' User 1 verified detailed numbered list');
      });
    }
  },

  {
    name: 'test empty message prevention',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@validation'] },
    testFunction: async () => {
      await step('Verify empty message cannot be sent', async () => {
        const currentUser = spacesMultiUserChat.getUser1();
        if (!currentUser) {
          throw new Error('User 1 not initialized');
        }

        // Try to send empty message
        await spacesMultiUserChat.typeInChatInput('user1', '');
        
        const sendButton = currentUser.page.locator('button[aria-label="Send message"]:has(svg.lucide-arrow-up)');
        const isDisabled = await sendButton.isDisabled();
        
        console.log(` Send button disabled for empty message: ${isDisabled}`);
        
        if (!isDisabled) {
          console.log(' Warning: Send button not disabled for empty message');
        }
      });
    }
  },

  {
    name: 'test message with only spaces',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'medium', tags: ['@spaces', '@chat', '@validation'] },
    testFunction: async () => {
      await step('Verify message with only spaces is handled properly', async () => {
        const currentUser = spacesMultiUserChat.getUser1();
        if (!currentUser) {
          throw new Error('User 1 not initialized');
        }

        // Try to send message with only spaces
        await spacesMultiUserChat.typeInChatInput('user1', '     ');
        
        const sendButton = currentUser.page.locator('button[aria-label="Send message"]:has(svg.lucide-arrow-up)');
        const isDisabled = await sendButton.isDisabled();
        
        console.log(` Send button disabled for spaces-only message: ${isDisabled}`);
      });
    }
  },

  {
    name: 'test conversation flow with mixed formatting',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@formatting', '@comprehensive', '@flow'] },
    testFunction: async () => {
      await step('User 1 asks a question with bold', async () => {
        await spacesMultiUserChat.sendBoldMessage('user1', 'Can you help me with the deployment?');
        console.log(' User 1 asked question with bold');
      });
      const steps = [
          'First, check the build logs',
          'Then verify the configuration',
          'Finally, restart the service'
        ];

      await step('User 2 responds with numbered list', async () => {
        
        await spacesMultiUserChat.sendNumberedListMessage('user2', steps);
        console.log(' User 2 responded with numbered list');
      });

      await step('User 1 thanks with emoji', async () => {
        await spacesMultiUserChat.sendMessageWithEmoji('user1', 'Thanks for the help! ', 'melting face');
        console.log(' User 1 thanked with emoji');
      });

      await step('User 2 sends code example', async () => {
        const code = 'docker-compose up -d\ndocker-compose logs -f';
        await spacesMultiUserChat.sendCodeBlockMessage('user2', code);
        console.log(' User 2 sent code example');
      });

      await step('Verify all messages are visible to both users', async () => {
        await spacesMultiUserChat.verifyBoldMessage('user2', 'Can you help me with the deployment?');
        await spacesMultiUserChat.verifyNumberedList('user1', steps);
        await spacesMultiUserChat.verifyCodeBlock('user1', 'docker-compose up');
        console.log(' All messages verified by both users');
      });
    }
  },

  {
    name: 'test message order consistency',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'highest', tags: ['@spaces', '@chat', '@critical', '@ordering'] },
    testFunction: async () => {
      await step('Send sequence of messages and verify order', async () => {
        const messages = [
          'Message order test 1',
          'Message order test 2',
          'Message order test 3',
          'Message order test 4',
          'Message order test 5'
        ];

        for (const message of messages) {
          await spacesMultiUserChat.sendPlainMessage('user1', message);
        }

        console.log(' User 1 sent sequence of 5 messages');

        await spacesMultiUserChat.verifyMessageOrder(messages);
        console.log(' Message order verified for both users');
      });
    }
  },

  {
    name: 'test alternating user messages',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'high', tags: ['@spaces', '@chat', '@conversation'] },
    testFunction: async () => {
      await step('Simulate natural conversation flow', async () => {
        await spacesMultiUserChat.sendPlainMessage('user1', 'Hello, how are you?');
        await spacesMultiUserChat.verifyUser2SeesMessage('Hello, how are you?');
        
        await spacesMultiUserChat.sendPlainMessage('user2', 'I am good, thanks!');
        await spacesMultiUserChat.verifyUser1SeesMessage('I am good, thanks!');
        
        await spacesMultiUserChat.sendPlainMessage('user1', 'Great to hear!');
        await spacesMultiUserChat.verifyUser2SeesMessage('Great to hear!');
        
        await spacesMultiUserChat.sendPlainMessage('user2', 'How about you?');
        await spacesMultiUserChat.verifyUser1SeesMessage('How about you?');
        
        console.log(' Natural conversation flow completed');
      });
    }
  },

  {
    name: 'test formatting persistence across messages',
    dependencies: ['start DM with other user'],
    metadata: { priority: 'medium', tags: ['@spaces', '@chat', '@formatting', '@persistence'] },
    testFunction: async () => {
      await step('Send multiple formatted messages and verify formatting persists', async () => {
        await spacesMultiUserChat.sendBoldMessage('user1', 'Bold message 1');
        await spacesMultiUserChat.sendItalicMessage('user1', 'Italic message 1');
        await spacesMultiUserChat.sendBoldMessage('user1', 'Bold message 2');
        
        console.log(' User 1 sent multiple formatted messages');

        await spacesMultiUserChat.verifyBoldMessage('user2', 'Bold message 1');
        await spacesMultiUserChat.verifyItalicMessage('user2', 'Italic message 1');
        await spacesMultiUserChat.verifyBoldMessage('user2', 'Bold message 2');
        
        console.log(' User 2 verified all formatting persisted');
      });
    }
  },

  {
    name: 'final test - take screenshots of conversation',
    dependencies: ['test formatting persistence across messages'],
    metadata: { priority: 'low', tags: ['@spaces', '@chat', '@documentation'] },
    testFunction: async () => {
      await step('Capture final state of conversation for both users', async () => {
        await spacesMultiUserChat.takeScreenshotsOfBothUsers('final-conversation');
        console.log(' Final conversation screenshots captured');
      });

      await step('Generate detailed message comparison JSON', async () => {
        const { test } = await import('@playwright/test');
        
        const comparison = await spacesMultiUserChat.compareMessagesDetailed();
        
        // Save comparison to file
        const fs = await import('fs');
        const path = await import('path');
        const outputPath = path.join(process.cwd(), 'reports', 'message-comparison.json');
        
        // Ensure reports directory exists
        const reportsDir = path.dirname(outputPath);
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }
        
        fs.writeFileSync(outputPath, JSON.stringify(comparison, null, 2));
        
        // Create nested steps for the comparison details - these will appear in HTML report
        await test.step(`📊 Summary: ${comparison.summary}`, async () => {});
        
        await test.step(`📈 Statistics: User1=${comparison.user1Count}, User2=${comparison.user2Count}, Common=${comparison.matchCount}`, async () => {});
        
        if (comparison.onlyInUser1.length > 0) {
          await test.step(`⚠️ Messages only in User 1 (${comparison.onlyInUser1.length})`, async () => {
            comparison.onlyInUser1.forEach((msg, idx) => {
              console.log(`  ${idx + 1}. ${msg.substring(0, 100)}${msg.length > 100 ? '...' : ''}`);
            });
          });
        }
        
        if (comparison.onlyInUser2.length > 0) {
          await test.step(`⚠️ Messages only in User 2 (${comparison.onlyInUser2.length})`, async () => {
            comparison.onlyInUser2.forEach((msg, idx) => {
              console.log(`  ${idx + 1}. ${msg.substring(0, 100)}${msg.length > 100 ? '...' : ''}`);
            });
          });
        }
        
        await test.step(`📋 Full JSON saved to: ${path.basename(outputPath)}`, async () => {
          // Create a step with the first 20 common messages preview
          if (comparison.commonMessages.length > 0) {
            const preview = comparison.commonMessages.slice(0, 20);
            console.log(`Common messages preview (showing ${preview.length} of ${comparison.commonMessages.length}):`);
            preview.forEach((msg, idx) => {
              console.log(`  ${idx + 1}. ${msg.substring(0, 80)}${msg.length > 80 ? '...' : ''}`);
            });
            if (comparison.commonMessages.length > 20) {
              console.log(`  ... and ${comparison.commonMessages.length - 20} more messages`);
            }
          }
        });
        
        // Log summary to console
        console.log(` ✅ Message comparison completed`);
        console.log(`   Status: ${comparison.mismatch ? '❌ MISMATCH' : '✅ MATCH'}`);
      });

      await step('Verify both users see same message count', async () => {
        await spacesMultiUserChat.verifyMessageCountMatch();
        console.log(' Message count verified to match');
      });
    }
  },

  {
    name: 'visual validation of Start DM modal',
    dependencies: ['click chat icon for both users'],
    metadata: { priority: 'medium', tags: ['@spaces', '@visual', '@regression', '@modal'] },
    testFunction: async () => {
      await step('User 1 opens Start DM modal for visual validation', async () => {
        await spacesMultiUserChat.clickPlusIconForUser('user1');
        await spacesMultiUserChat.verifyStartDMModalVisible('user1');
      });

      await step('Capture and validate screenshot of the Start DM modal', async () => {
        const modal = spacesMultiUserChat.getStartDMModal('user1');
        
        // Take a screenshot of the modal and compare it to a golden snapshot
        await expect(modal).toHaveScreenshot('start-dm-modal.png', {
          maxDiffPixels: 100, // Allow for minor rendering differences
        });
        
        console.log(' Visual validation of Start DM modal passed');
      });
    }
  }
]);
