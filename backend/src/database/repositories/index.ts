// Export all repositories
export { AgentRepository } from './agents';
export { ModelRepository } from './models';
export { ToolRepository, AgentToolsMappingRepository } from './tools';
export {
  WorkflowRepository,
  WorkflowExecutionRepository
} from './workflows';
export {
  stitchExecutionState,
  stitchExecutionStateMany,
  createExecutionState,
  updateExecutionState,
  deleteExecutionState,
  upsertExecutionState,
  getExecutionState,
  type WorkflowExecutionWithState,
} from './workflowExecutionStateUtils';
export { TicketRepository } from './ticketRepository';
export { WorkflowStepRepository } from './workflowSteps';
export { AgentStepRepository } from './agentSteps';
export { ExternalStepResponseRepository } from './externalStepResponses';
export { UserGroupRepository } from './userGroups';
export { UserRepository } from './users';
export { ResourceRepository } from './resources';
export { ResourceAccessRepository } from './resourceAccess';
export { ACLAuditLogRepository } from './aclAuditLogs';
export { 
  NotificationRepository, 
  NotificationPreferenceRepository, 
  BrowserNotificationSubscriptionRepository 
} from './notificationRepository';
export { MessageRepository } from './messageRepository';
export { MessageSearchRepository } from './messageSearchRepository';
export { BaseRepository } from './base';
export { CallRepository } from './callRepository';
export { ProjectRepository } from './projectRepository';
export { ChannelRepository } from './channelRepository';
export { ChannelParticipantRepository } from './channelParticipantRepository';
export { ConversationParticipantRepository } from './conversationParticipantRepository';
export { ConversationRepository } from './conversationRepository';
export { MessageAttachmentRepository } from './messageAttachmentRepository';
export { UserAssignmentStateRepository } from './userAssignmentStateRepository';
export { BoardComplexityScoreRepository } from './boardComplexityScoreRepository';
export { BoardRepository } from './boardRepository';
export { UserWorkloadMappingRepository } from './userWorkloadMappingRepository';
export { UserExpertiseMappingRepository } from './userExpertiseMappingRepository';
export { UserGroupMappingRepository } from './userGroupMappingRepository';
export { EmailRepository } from './emailRepository';
export { EmailDraftRepository } from './emailDraftRepository';
export { ActivityEventRepository } from './activityEventRepository';
export { AppsRepository } from './appsRepository';
export { InstalledAppsRepository } from './installedAppsRepository';
export { AppPermissionRepository } from './appPermissionRepository';
export { IncomingWebhooksRepository } from './incomingWebhooksRepository';
export { AppCommandRepository } from './appCommandRepository';
export { ScheduledCallRepository } from './scheduledCallRepository';
export { WorkspaceRepository } from './workspaces';
export { CallMessageRepository } from './callMessageRepository';
export { OrgMemberRepository } from './orgMember';
export { DataSourceRepository } from './dataSources';
export { DataSourceTableRepository } from './dataSourceTables';
export { DataSourceColumnRepository } from './dataSourceColumns';
export { DataSourceRelationshipRepository } from './dataSourceRelationships';
export { DashboardActivityRepository } from './dashboardActivity';

// Import statements for the container
import { AgentRepository } from './agents';
import { ModelRepository } from './models';
import { ToolRepository, AgentToolsMappingRepository } from './tools';
import {
  WorkflowRepository,
  WorkflowExecutionRepository
} from './workflows';
import { TicketRepository } from './ticketRepository';
import { WorkflowStepRepository } from './workflowSteps';
import { AgentStepRepository } from './agentSteps';
import { ExternalStepResponseRepository } from './externalStepResponses';
import { UserGroupRepository } from './userGroups';
import { UserRepository } from './users';
import { ResourceRepository } from './resources';
import { ResourceAccessRepository } from './resourceAccess';
import { ACLAuditLogRepository } from './aclAuditLogs';
import { 
  NotificationRepository, 
  NotificationPreferenceRepository, 
  BrowserNotificationSubscriptionRepository 
} from './notificationRepository';
import { CallRepository } from './callRepository';
import { MessageRepository } from './messageRepository';
import { ProjectRepository } from './projectRepository';
import { MessageSearchRepository } from './messageSearchRepository';
import { ChannelRepository } from './channelRepository';
import { ChannelParticipantRepository } from './channelParticipantRepository';
import { ConversationParticipantRepository } from './conversationParticipantRepository';
import { ConversationRepository } from './conversationRepository';
import { MessageAttachmentRepository } from './messageAttachmentRepository';
import { UserAssignmentStateRepository } from './userAssignmentStateRepository';
import { BoardComplexityScoreRepository } from './boardComplexityScoreRepository';
import { BoardRepository } from './boardRepository';
import { UserWorkloadMappingRepository } from './userWorkloadMappingRepository';
import { UserExpertiseMappingRepository } from './userExpertiseMappingRepository';
import { UserGroupMappingRepository } from './userGroupMappingRepository';
import { EmailRepository } from './emailRepository';
import { EmailDraftRepository } from './emailDraftRepository';
import { ActivityEventRepository } from './activityEventRepository';
import { AppsRepository } from './appsRepository';
import { InstalledAppsRepository } from './installedAppsRepository';
import { AppPermissionRepository } from './appPermissionRepository';
import { IncomingWebhooksRepository } from './incomingWebhooksRepository';
import { AppCommandRepository } from './appCommandRepository';
import { ScheduledCallRepository } from './scheduledCallRepository';
import { WorkspaceRepository } from './workspaces';
import { CallMessageRepository } from './callMessageRepository';
import { OrgMemberRepository } from './orgMember';
import { DataSourceRepository } from './dataSources';
import { DataSourceTableRepository } from './dataSourceTables';
import { DataSourceColumnRepository } from './dataSourceColumns';
import { DataSourceRelationshipRepository } from './dataSourceRelationships';
import { DashboardActivityRepository } from './dashboardActivity';

// Repository container for dependency injection
export class RepositoryContainer {
  private static instance: RepositoryContainer;

  public agents: AgentRepository;
  public models: ModelRepository;
  public tools: ToolRepository;
  public agentToolsMappings: AgentToolsMappingRepository;
  public tickets: TicketRepository;
  public workflows: WorkflowRepository;
  public workflowExecutions: WorkflowExecutionRepository;
  public workflowSteps: WorkflowStepRepository;
  public agentSteps: AgentStepRepository;
  public externalStepResponses: ExternalStepResponseRepository;
  public userGroups: UserGroupRepository;
  public users: UserRepository;
  public resources: ResourceRepository;
  public resourceAccess: ResourceAccessRepository;
  public aclAuditLogs: ACLAuditLogRepository;
  public notifications: NotificationRepository;
  public notificationPreferences: NotificationPreferenceRepository;
  public browserNotificationSubscriptions: BrowserNotificationSubscriptionRepository;
  public calls: CallRepository;
  public messages: MessageRepository;
  public projects: ProjectRepository;
  public messageSearch: MessageSearchRepository;
  public channels: ChannelRepository;
  public channelParticipants: ChannelParticipantRepository;
  public conversations: ConversationRepository;
  public conversationParticipants: ConversationParticipantRepository;
  public messageAttachments: MessageAttachmentRepository = new MessageAttachmentRepository();
  public userAssignmentState: UserAssignmentStateRepository;
  public boardComplexityScore: BoardComplexityScoreRepository;
  public boards: BoardRepository;
  public userWorkloadMapping: UserWorkloadMappingRepository;
  public userExpertiseMapping: UserExpertiseMappingRepository;
  public userGroupMapping: UserGroupMappingRepository;
  public emails: EmailRepository;
  public emailDrafts: EmailDraftRepository;
  public activityEvents: ActivityEventRepository;
  public apps: AppsRepository;
  public installedApps: InstalledAppsRepository;
  public appPermissions: AppPermissionRepository;
  public incomingWebhooks: IncomingWebhooksRepository;
  public appCommands: AppCommandRepository;
  public scheduledCalls: ScheduledCallRepository;
  public workspaces: WorkspaceRepository;
  public callMessages: CallMessageRepository;
  public orgMembers: OrgMemberRepository;
  public dataSources: DataSourceRepository;
  public dataSourceTables: DataSourceTableRepository;
  public dataSourceColumns: DataSourceColumnRepository;
  public dataSourceRelationships: DataSourceRelationshipRepository;
  public dashboardActivity: DashboardActivityRepository;

  private constructor() {
    this.agents = new AgentRepository();
    this.models = new ModelRepository();
    this.tools = new ToolRepository();
    this.agentToolsMappings = new AgentToolsMappingRepository();
    this.tickets = new TicketRepository();
    this.workflows = new WorkflowRepository();
    this.workflowExecutions = new WorkflowExecutionRepository();
    this.workflowSteps = new WorkflowStepRepository();
    this.agentSteps = new AgentStepRepository();
    this.externalStepResponses = new ExternalStepResponseRepository();
    this.userGroups = new UserGroupRepository();
    this.users = new UserRepository();
    this.resources = new ResourceRepository();
    this.resourceAccess = new ResourceAccessRepository();
    this.aclAuditLogs = new ACLAuditLogRepository();
    this.notifications = new NotificationRepository();
    this.notificationPreferences = new NotificationPreferenceRepository();
    this.browserNotificationSubscriptions = new BrowserNotificationSubscriptionRepository();
    this.calls = new CallRepository();
    this.messages = new MessageRepository();
    this.projects = new ProjectRepository();
    this.messageSearch = new MessageSearchRepository();
    this.channels = new ChannelRepository();
    this.channelParticipants = new ChannelParticipantRepository();
    this.conversations = new ConversationRepository();
    this.conversationParticipants = new ConversationParticipantRepository();
    this.messageAttachments = new MessageAttachmentRepository();
    this.userAssignmentState = new UserAssignmentStateRepository();
    this.boardComplexityScore = new BoardComplexityScoreRepository();
    this.boards = new BoardRepository();
    this.userWorkloadMapping = new UserWorkloadMappingRepository();
    this.userExpertiseMapping = new UserExpertiseMappingRepository();
    this.userGroupMapping = new UserGroupMappingRepository();
    this.emails = new EmailRepository();
    this.emailDrafts = new EmailDraftRepository();
    this.activityEvents = new ActivityEventRepository();
    this.apps = new AppsRepository();
    this.installedApps = new InstalledAppsRepository();
    this.appPermissions = new AppPermissionRepository();
    this.incomingWebhooks = new IncomingWebhooksRepository();
    this.appCommands = new AppCommandRepository();

    this.scheduledCalls = new ScheduledCallRepository();
    this.workspaces = new WorkspaceRepository();
    this.callMessages = new CallMessageRepository();
    this.orgMembers = new OrgMemberRepository();
    this.dataSources = new DataSourceRepository();
    this.dataSourceTables = new DataSourceTableRepository();
    this.dataSourceColumns = new DataSourceColumnRepository();
    this.dataSourceRelationships = new DataSourceRelationshipRepository();
    this.dashboardActivity = new DashboardActivityRepository();
  }

  static getInstance(): RepositoryContainer {
    if (!RepositoryContainer.instance) {
      RepositoryContainer.instance = new RepositoryContainer();
    }
    return RepositoryContainer.instance;
  }
}

export const repositories = RepositoryContainer.getInstance();
