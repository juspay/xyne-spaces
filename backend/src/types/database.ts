import { Prisma } from '@prisma/client';

// Common types for all entities
export interface QueryOptions {
  skip?: number;
  take?: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
  where?: Record<string, any>;
}

export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// Agent types
export type Agent = Prisma.AgentGetPayload<{}>;
export type CreateAgentInput = Prisma.AgentCreateInput;
export type UpdateAgentInput = Prisma.AgentUpdateInput;
export type AgentWithModel = Prisma.AgentGetPayload<{
  include: { model: true };
}>;
export type AgentWithTools = Prisma.AgentGetPayload<{
  include: {
    agentToolsMappings: {
      include: { tool: true };
    };
  };
}>;
export type FullAgent = Prisma.AgentGetPayload<{
  include: {
    model: true;
    agentToolsMappings: {
      include: { tool: true };
    };
  };
}>;

// Model types
export type Model = Prisma.ModelGetPayload<{}>;
export type CreateModelInput = Prisma.ModelCreateInput;
export type UpdateModelInput = Prisma.ModelUpdateInput;


// Tool types
export type Tool = Prisma.ToolGetPayload<{}>;
export type CreateToolInput = Prisma.ToolCreateInput;
export type UpdateToolInput = Prisma.ToolUpdateInput;

// Agent Tools Mapping types
export type AgentToolsMapping = Prisma.AgentToolsMappingGetPayload<{}>;
export type CreateAgentToolsMappingInput = Prisma.AgentToolsMappingCreateInput;
export type UpdateAgentToolsMappingInput = Prisma.AgentToolsMappingUpdateInput;

// Workflow types
export type Ticket = Prisma.TicketGetPayload<{}>;
export type CreateTicketInput = Prisma.TicketCreateInput;
export type UpdateTicketInput = Prisma.TicketUpdateInput;
// Note: TicketWithWorkflows removed - no FK relation between Ticket and Workflow

export type Workflow = Prisma.WorkflowGetPayload<{}>;
export type CreateWorkflowInput = Prisma.WorkflowUncheckedCreateInput;
export type UpdateWorkflowInput = Prisma.WorkflowUncheckedUpdateInput;
export type WorkflowWithSteps = Prisma.WorkflowGetPayload<{
  include: {
    workflowExecutions: {
      include: {
        workflowSteps: true;
      };
    };
  };
}>;
export type WorkflowWithExecutions = Prisma.WorkflowGetPayload<{
  include: {
    workflowExecutions: {
      include: {
        childWorkflowExecutions: true;
        workflowSteps: true;
      };
    };
  };
}>;

// Note: WorkflowWithTicket removed - no FK relation between Workflow and Ticket

export type WorkflowExecution = Prisma.WorkflowExecutionGetPayload<{}>;
export type CreateWorkflowExecutionInput = Prisma.WorkflowExecutionCreateInput & {
  context?: string | null;
  output?: string | null;
};
export type UpdateWorkflowExecutionInput = Prisma.WorkflowExecutionUpdateInput & {
  context?: string | null;
  output?: string | null;
};
export type FullWorkflowExecution = Prisma.WorkflowExecutionGetPayload<{
  include: {
    workflow: true;
    parentWorkflowExecution: true;
    childWorkflowExecutions: true;
    workflowSteps: true;
  };
}>;

export type WorkflowExecutionLock = Prisma.WorkflowExecutionLockGetPayload<{}>;
export type CreateWorkflowExecutionLockInput = Prisma.WorkflowExecutionLockCreateInput;
export type UpdateWorkflowExecutionLockInput = Prisma.WorkflowExecutionLockUpdateInput;

export type WorkflowStep = Prisma.WorkflowStepGetPayload<{}>;
export type CreateWorkflowStepInput = Prisma.WorkflowStepCreateInput;
export type UpdateWorkflowStepInput = Prisma.WorkflowStepUpdateInput;

export type AgentStep = Prisma.AgentStepGetPayload<{}>;
export type CreateAgentStepInput = Prisma.AgentStepCreateInput;
export type UpdateAgentStepInput = Prisma.AgentStepUpdateInput;

export type ExternalStepResponse = Prisma.ExternalStepResponseGetPayload<{}>;
export type CreateExternalStepResponseInput = Prisma.ExternalStepResponseCreateInput;
export type UpdateExternalStepResponseInput = Prisma.ExternalStepResponseUpdateInput;


// Workspace types
export type Workspace = Prisma.WorkspaceGetPayload<{}>;
export type CreateWorkspaceInput = Prisma.WorkspaceCreateInput;
export type UpdateWorkspaceInput = Prisma.WorkspaceUpdateInput;

// Organization types
export type Organization = Prisma.OrganizationGetPayload<{}>;
export type CreateOrganizationInput = Prisma.OrganizationCreateInput;
export type UpdateOrganizationInput = Prisma.OrganizationUpdateInput;

export type OrgMember = Prisma.OrgMemberGetPayload<{}>;
export type CreateOrgMemberInput = Prisma.OrgMemberCreateInput;
export type UpdateOrgMemberInput = Prisma.OrgMemberUpdateInput;

// Chat Feature types
export type Channel = Prisma.ChannelGetPayload<{}>;
export type CreateChannelInput = Prisma.ChannelCreateInput;
export type UpdateChannelInput = Prisma.ChannelUpdateInput;

export type ChannelParticipant = Prisma.ChannelParticipantGetPayload<{}>;
export type CreateChannelParticipantInput = Prisma.ChannelParticipantCreateInput;
export type UpdateChannelParticipantInput = Prisma.ChannelParticipantUpdateInput;

export type Conversation = Prisma.ConversationGetPayload<{}>;
export type CreateConversationInput = Prisma.ConversationCreateInput;
export type UpdateConversationInput = Prisma.ConversationUpdateInput;

export type Message = Prisma.MessageGetPayload<{}>;
export type CreateMessageInput = Prisma.MessageCreateInput;
export type UpdateMessageInput = Prisma.MessageUpdateInput;

export type MessageAttachment = Prisma.MessageAttachmentGetPayload<{}>;
export type CreateMessageAttachmentInput = Prisma.MessageAttachmentCreateInput;
export type UpdateMessageAttachmentInput = Prisma.MessageAttachmentUpdateInput;

export type Reaction = Prisma.ReactionGetPayload<{}>;
export type CreateReactionInput = Prisma.ReactionCreateInput;
export type UpdateReactionInput = Prisma.ReactionUpdateInput;

export type ReactionCount = Prisma.ReactionCountGetPayload<{}>;
export type CreateReactionCountInput = Prisma.ReactionCountCreateInput;
export type UpdateReactionCountInput = Prisma.ReactionCountUpdateInput;

// External Integration types
export type ExternalSource = Prisma.ExternalSourceGetPayload<{}>;
export type CreateExternalSourceInput = Prisma.ExternalSourceCreateInput;
export type UpdateExternalSourceInput = Prisma.ExternalSourceUpdateInput;

export type ExternalMessage = Prisma.ExternalMessageGetPayload<{}>;
export type CreateExternalMessageInput = Prisma.ExternalMessageCreateInput;
export type UpdateExternalMessageInput = Prisma.ExternalMessageUpdateInput;

// API Key types
export type ApiKey = Prisma.ApiKeyGetPayload<{}>;
export type CreateApiKeyInput = Prisma.ApiKeyCreateInput;
export type UpdateApiKeyInput = Prisma.ApiKeyUpdateInput;

// User Session types
export type UserSession = Prisma.UserSessionGetPayload<{}>;
export type CreateUserSessionInput = Prisma.UserSessionCreateInput;
export type UpdateUserSessionInput = Prisma.UserSessionUpdateInput;

// User Presence types
export type UserPresence = Prisma.UserPresenceGetPayload<{}>;
export type CreateUserPresenceInput = Prisma.UserPresenceCreateInput;
export type UpdateUserPresenceInput = Prisma.UserPresenceUpdateInput;

// User Management types
export type UserGroup = Prisma.UserGroupGetPayload<{}>;
export type CreateUserGroupInput = Prisma.UserGroupCreateInput;
export type UpdateUserGroupInput = Prisma.UserGroupUpdateInput;

// Custom type for UserGroup with manually fetched mappings (no Prisma relation)
export type UserGroupWithMappings = UserGroup & {
  userGroupMappings: Array<{
    id: string;
    userId: string;
    userGroupId: string;
    createdAt: Date;
    updatedAt: Date;
    user: User | null;
  }>;
};

export type User = Prisma.UserGetPayload<{}>;
export type CreateUserInput = Prisma.UserCreateInput;
export type UpdateUserInput = Prisma.UserUpdateInput;

// Custom type for User with manually fetched mappings (no Prisma relation)
export type UserWithMappings = User & {
  userGroupMappings: Array<{
    id: string;
    userId: string;
    userGroupId: string;
    createdAt: Date;
    updatedAt: Date;
    userGroup: UserGroup | null;
  }>;
};

export type UserWithAccess = Prisma.UserGetPayload<{
  include: { resourceAccess: { include: { resource: true } } };
}>;

export type Resource = Prisma.ResourceGetPayload<{}>;
export type CreateResourceInput = Prisma.ResourceCreateInput;
export type UpdateResourceInput = Prisma.ResourceUpdateInput;
export type ResourceWithAccess = Prisma.ResourceGetPayload<{
  include: { resourceAccess: true };
}>;

export type ResourceAccess = Prisma.ResourceAccessGetPayload<{}>;
export type CreateResourceAccessInput = Prisma.ResourceAccessCreateInput;
export type UpdateResourceAccessInput = Prisma.ResourceAccessUpdateInput;
export type ResourceAccessWithDetails = Prisma.ResourceAccessGetPayload<{
  include: {
    userGroup: true;
    user: true;
    resource: true;
  };
}>;

// ACL Audit Log types
export type ACLAuditLog = Prisma.ACLAuditLogGetPayload<{}>;
export type CreateACLAuditLogInput = Prisma.ACLAuditLogCreateInput;
export type UpdateACLAuditLogInput = Prisma.ACLAuditLogUpdateInput;
export type ACLAuditLogWithActor = Prisma.ACLAuditLogGetPayload<{
  include: {
    actorUser: {
      select: {
        id: true;
        name: true;
        email: true;
      };
    };
  };
}>;

// Project types
export type Project = Prisma.ProjectGetPayload<{}>;
export type CreateProjectInput = Prisma.ProjectCreateInput;
export type UpdateProjectInput = Prisma.ProjectUpdateInput;

// SubTicket types
export type SubTicket = Prisma.SubTicketGetPayload<{}>;
export type CreateSubTicketInput = Prisma.SubTicketCreateInput;
export type UpdateSubTicketInput = Prisma.SubTicketUpdateInput;

// Custom type for SubTicket with original ticket info (no FK relation via TicketSubTicketMapping)
export type SubTicketWithRelations = SubTicket & {
  ticketId?: string; // Original ticket ID (via TicketSubTicketMapping)
};

// TicketSubTicketMapping types
export type TicketSubTicketMapping = Prisma.TicketSubTicketMappingGetPayload<{}>;
export type CreateTicketSubTicketMappingInput = Prisma.TicketSubTicketMappingCreateInput;
export type UpdateTicketSubTicketMappingInput = Prisma.TicketSubTicketMappingUpdateInput;
