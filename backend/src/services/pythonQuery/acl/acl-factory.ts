/**
 * ACL Factory
 * Maps model names to their corresponding ACL classes
 */

import { PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from './base-acl'
import {
  ActivitiesACL,
  BoardComplexityScoresACL,
  BoardsACL,
  BookmarksACL,
  CallParticipantsACL,
  CallsACL,
  CanvasParticipantsACL,
  CanvasesACL,
  ChannelParticipantsACL,
  ChannelsACL,
  ChannelStatsACL,
  ConversationParticipantsACL,
  ConversationsACL,
  ExternalStepResponsesACL,
  MessageAttachmentsACL,
  EmailsACL,
  MessagesACL,
  NotificationPreferencesACL,
  NotificationsACL,
  OrgMembersACL,
  OrganizationsACL,
  ProjectsACL,
  PullRequestsACL,
  ReactionCountsACL,
  ReactionsACL,
  ReposACL,
  StagesACL,
  SubTicketsACL,
  TicketActivitiesACL,
  TicketEntityMappingsACL,
  TicketReferenceMappingsACL,
  TicketSubTicketMappingsACL,
  TicketTagsACL,
  TicketsACL,
  UserAssignmentStatesACL,
  UserExpertiseMappingsACL,
  UserGroupMappingsACL,
  UserGroupsACL,
  UserPresenceACL,
  UserWorkloadMappingsACL,
  UsersACL,
  WorkflowExecutionsACL,
  WorkflowsACL,
  TicketAssignmentsACL,
  TicketStageEtaACL,
  UserProfilesACL,
  UserPreferencesACL,
  FormsACL,
  FormContextMappingsACL,
  FormFieldsACL,
  FormEntityValuesACL,
  WorkspacesACL,
  InvitationsACL,
} from './tables'
import { UserActivityEventsAcl } from './tables/user_activity_acl'

export class ACLFactory {
  static getACL(
    modelName: string,
    ctx: ACLContext,
    prisma: PrismaClient
  ): BaseQueryACL {
    switch (modelName) {
      case 'activity':
        return new ActivitiesACL(ctx, prisma)

      case 'boardComplexityScore':
        return new BoardComplexityScoresACL(ctx, prisma)

      case 'board':
        return new BoardsACL(ctx, prisma)

      case 'bookmark':
        return new BookmarksACL(ctx, prisma)

      case 'callParticipant':
        return new CallParticipantsACL(ctx, prisma)

      case 'call':
        return new CallsACL(ctx, prisma)

      case 'canvasParticipant':
        return new CanvasParticipantsACL(ctx, prisma)

      case 'canvas':
        return new CanvasesACL(ctx, prisma)

      case 'channelParticipant':
        return new ChannelParticipantsACL(ctx, prisma)

      case 'channel':
        return new ChannelsACL(ctx, prisma)
      
      case 'channel_stats':
        return new ChannelStatsACL(ctx, prisma)

      case 'conversationParticipant':
        return new ConversationParticipantsACL(ctx, prisma)

      case 'conversation':
        return new ConversationsACL(ctx, prisma)

      case 'externalStepResponse':
        return new ExternalStepResponsesACL(ctx, prisma)

      case 'messageAttachment':
        return new MessageAttachmentsACL(ctx, prisma)

      case 'email':
        return new EmailsACL(ctx, prisma)

      case 'message':
        return new MessagesACL(ctx, prisma)

      case 'notificationPreference':
        return new NotificationPreferencesACL(ctx, prisma)

      case 'notification':
        return new NotificationsACL(ctx, prisma)

      case 'orgMember':
        return new OrgMembersACL(ctx, prisma)

      case 'organization':
        return new OrganizationsACL(ctx, prisma)

      case 'project':
        return new ProjectsACL(ctx, prisma)

      case 'pullRequest':
      case 'pullRequests':
        return new PullRequestsACL(ctx, prisma)

      case 'reactionCount':
        return new ReactionCountsACL(ctx, prisma)

      case 'reaction':
        return new ReactionsACL(ctx, prisma)

      case 'repo':
        return new ReposACL(ctx, prisma)

      case 'stage':
        return new StagesACL(ctx, prisma)

      case 'subTicket':
        return new SubTicketsACL(ctx, prisma)

      case 'ticket':
        return new TicketsACL(ctx, prisma)

      case 'ticketActivity':
        return new TicketActivitiesACL(ctx, prisma)

      case 'ticketEntityMapping':
        return new TicketEntityMappingsACL(ctx, prisma)

      case 'ticketReferenceMapping':
        return new TicketReferenceMappingsACL(ctx, prisma)

      case 'ticketSubTicketMapping':
        return new TicketSubTicketMappingsACL(ctx, prisma)

      case 'ticketTag':
        return new TicketTagsACL(ctx, prisma)

      case 'user':
        return new UsersACL(ctx, prisma)

      case 'userAssignmentState':
        return new UserAssignmentStatesACL(ctx, prisma)

      case 'userExpertiseMapping':
        return new UserExpertiseMappingsACL(ctx, prisma)

      case 'userGroupMapping':
        return new UserGroupMappingsACL(ctx, prisma)

      case 'userGroup':
        return new UserGroupsACL(ctx, prisma)

      case 'userPresence':
        return new UserPresenceACL(ctx, prisma)

      case 'userWorkloadMapping':
        return new UserWorkloadMappingsACL(ctx, prisma)

      case 'workflow':
        return new WorkflowsACL(ctx, prisma)

      case 'workflowExecution':
        return new WorkflowExecutionsACL(ctx, prisma)
      case 'userActivityEvent':
        return new UserActivityEventsAcl(ctx, prisma)

      case 'ticketAssignment':
        return new TicketAssignmentsACL(ctx, prisma)

      case 'ticketStageEta':
        return new TicketStageEtaACL(ctx, prisma)

      case 'userProfile':
        return new UserProfilesACL(ctx, prisma)

      case 'userPreference':
        return new UserPreferencesACL(ctx, prisma)

      case 'form':
        return new FormsACL(ctx, prisma)

      case 'formContextMapping':
        return new FormContextMappingsACL(ctx, prisma)

      case 'formFields':
        return new FormFieldsACL(ctx, prisma)

      case 'formEntityValues':
        return new FormEntityValuesACL(ctx, prisma)

      case 'workspace':
        return new WorkspacesACL(ctx, prisma)

      case 'invitation':
        return new InvitationsACL(ctx, prisma)

      // Default: no ACL restriction (pass-through)
      default:
        return new BaseQueryACL(ctx, prisma) as BaseQueryACL
    }
  }
}
