import { ChannelsACL } from './channels-acl'

describe('ChannelsACL.canCreate', () => {
  it('allows DM channels without requiring the sentinel projectId to exist', async () => {
    const prisma = { project: { findFirst: jest.fn() } }
    const acl = new ChannelsACL({ userId: 'bot_1', workspaceId: 'ws_1' } as any, prisma as any)

    await expect(acl.canCreate({
      scopeType: 'DM',
      name: 'bot_1,user_1',
      visibility: 'PRIVATE',
      createdBy: 'user_1',
      projectId: 'default',
      workspaceId: 'ws_1',
    } as any)).resolves.toBe(true)

    expect(prisma.project.findFirst).not.toHaveBeenCalled()
  })

  it('still rejects non-DM channels whose project is outside the workspace', async () => {
    const prisma = { project: { findFirst: jest.fn().mockResolvedValue(null) } }
    const acl = new ChannelsACL({ userId: 'user_1', workspaceId: 'ws_1' } as any, prisma as any)

    await expect(acl.canCreate({
      scopeType: 'DEFAULT',
      name: 'general',
      visibility: 'PUBLIC',
      createdBy: 'user_1',
      projectId: 'project_2',
      workspaceId: 'ws_1',
    } as any)).resolves.toBe(false)
  })
})
