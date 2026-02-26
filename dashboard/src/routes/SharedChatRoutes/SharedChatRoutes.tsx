import { RouteObject } from 'react-router-dom';

import CanvasScreen from '../../components/Canvas/CanvasScreen';
import ChatView from '../../components/Chat/ChatView/ChatView';
import ThreadMessages from '../../components/Chat/ThreadPannel';
import ProfileSidebar from '../../components/ProfileSidebar/ProfileSidebar';
import UserGroupSidePanel from '../../components/UserGroup/UserGroupSidePanel/UserGroupSidePanel';

/**
 * Shared routing structure for:
 * - /chat/dm
 * - /chat/bookmarks
 * - /chat/activity
 *
 * NOTE:
 * - Excludes `dir`
 */
export const sharedChatRoutes: RouteObject[] = [
  // Canvas routes MUST come before :channelId
  {
    path: 'canvas',
    element: <CanvasScreen />,
  },
  {
    path: 'canvas/:canvasId',
    element: <CanvasScreen />,
  },

  {
    path: ':channelId',
    children: [
      {
        index: true,
        element: <ChatView />,
      },
      {
        path: 'canvas/:canvasId',
        element: <CanvasScreen />,
      },
      {
        path: 'profile/:userId',
        element: <ChatView />,
        children: [
          {
            index: true,
            element: <ProfileSidebar />,
          },
        ],
      },
      {
        path: 'group/:groupId',
        element: <ChatView />,
        children: [
          {
            index: true,
            element: <UserGroupSidePanel />,
          },
        ],
      },
      {
        path: ':conversationId',
        element: <ChatView />,
        children: [
          {
            index: true,
            element: <ThreadMessages />,
          },
          {
            path: ':ticketId',
            element: <ThreadMessages />,
          },
          {
            path: 'profile/:userId',
            element: <ProfileSidebar />,
          },
        ],
      },
    ],
  },
];
