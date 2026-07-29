import { WorkflowEngine, BaseWorkflowContext } from '../workflow-types'
import { WorkflowDefinition } from '../registry/workflowRegistry'
import { WorkflowType } from '../types/workflow-enums'
import { z } from 'zod'
import {logger} from '@/utils/logger';

export interface UserOnboardingContext extends BaseWorkflowContext {
  ticketId: string
  email: string
  userType: string
}

export interface UserOnboardingOutput {
  onboardingCompleted: boolean
  duration: number
  hasPremiumFeatures: boolean
  jiraTicketId: string
}

export interface UserOnboardingPreExecuteResult {
  timestamp: string
  isPremiumEligible: boolean
  validatedEmail: string
}

export const userOnboardingInputSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  userType: z.string(),
});

export const userOnboardingContextMapper = (payload: z.infer<typeof userOnboardingInputSchema> & { ticketId: string }): UserOnboardingContext => ({
  ticketId: payload.ticketId,     // backend injected
  email: payload.email,
  userType: payload.userType,
});



// Step IDs for user onboarding workflow
export enum UserOnboardingSteps {
  SEND_WELCOME_EMAIL = 'send_welcome_email',
  NOTIFY_SLACK = 'notify_slack',
  CREATE_JIRA_TICKET = 'create_jira_ticket',
  SETUP_PREMIUM_FEATURES = 'setup_premium_features',
  CONFIGURE_PREFERENCES = 'configure_preferences',
  SEND_COMPLETION_NOTIFICATION = 'send_completion_notification'
}

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const sendWelcomeEmailCallback = async (email: string) => {
  await new Promise(resolve => setTimeout(resolve, 1000))

  return {
    email,
    welcomeEmailSent: true,
    welcomeEmailSentAt: new Date().toISOString(),
    messageId: `welcome-${Date.now()}`,
    emailProvider: 'SendGrid'
  }
}

const notifySlackCallback = async (email: string, welcomeMessageId: string) => {
  logger.info(`Notifying Slack about new user: ${email}`)

  await new Promise(resolve => setTimeout(resolve, 800))

  return {
    email,
    slackNotified: true,
    slackNotifiedAt: new Date().toISOString(),
    slackChannel: '#new-users',
    slackMessageId: `slack-${Date.now()}`,
    welcomeEmailRef: welcomeMessageId
  }
}

const createJiraTicketCallback = async (email: string, slackMessageId: string) => {
  logger.info(`Creating Jira onboarding ticket for: ${email}`)

  await new Promise(resolve => setTimeout(resolve, 1200))

  return {
    email,
    jiraTicketCreated: true,
    jiraTicketCreatedAt: new Date().toISOString(),
    jiraTicketId: `ONBOARD-${Date.now()}`,
    jiraProject: 'USEROPS',
    slackRef: slackMessageId
  }
}


const setupPremiumFeaturesCallback = async (email: string) => {
  logger.info(`Setting up premium features for ${email}`)

  await new Promise(resolve => setTimeout(resolve, 2000))

  return {
    email,
    premiumFeaturesEnabled: true,
    premiumSetupAt: new Date().toISOString()
  }
}

const configurePreferencesCallback = async (email: string, userType: string, premiumEnabled?: boolean) => {
  logger.info(`Configuring preferences for ${email} (${userType})`)

  const userPreferences = {
    notifications: true,
    newsletter: userType === 'premium',
    dailyDigest: premiumEnabled || false,
    advancedAnalytics: premiumEnabled || false,
    prioritySupport: userType === 'premium' || userType === 'enterprise'
  }

  await new Promise(resolve => setTimeout(resolve, 500))

  return {
    email,
    userType,
    preferences: userPreferences,
    preferencesConfigured: true,
    preferencesConfiguredAt: new Date().toISOString(),
    configurationProvider: 'UserPrefsService'
  }
}

const sendCompletionNotificationCallback = async (email: string, welcomeEmailSentAt: string, premiumSetupAt?: string) => {
  logger.info(`Sending onboarding completion notification to ${email}`)

  const completedAt = new Date().toISOString()
  const duration = Date.now() - new Date(welcomeEmailSentAt || Date.now()).getTime()

  await new Promise(resolve => setTimeout(resolve, 1000))

  return {
    email,
    onboardingCompleted: true,
    onboardingCompletedAt: completedAt,
    onboardingDuration: duration,
    onboardingDurationMinutes: Math.round(duration / (1000 * 60)),
    hasPremiumFeatures: !!premiumSetupAt,
    completionNotificationSent: true,
    completionMessageId: `completion-${Date.now()}`
  }
}


export const userOnboardingWorkflow: WorkflowDefinition<
  UserOnboardingContext,
  UserOnboardingOutput,
  typeof UserOnboardingSteps,
  UserOnboardingPreExecuteResult
> = {
  type: WorkflowType.USER_ONBOARDING,
  name: 'User Onboarding',
  description: 'Complete user onboarding process including welcome email, verification, and account setup',
  inputSchema: userOnboardingInputSchema,
  contextMapper: userOnboardingContextMapper,


  async preExecute(context: Readonly<UserOnboardingContext>): Promise<UserOnboardingPreExecuteResult> {
    logger.info('🔧 Running preExecute for user onboarding:', context.email)

    // Validate inputs
    if (!context.email || !context.userType) {
      throw new Error('Missing required fields: email and userType')
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(context.email)) {
      throw new Error(`Invalid email format: ${context.email}`)
    }

    // Determine premium eligibility
    const isPremiumEligible = context.userType === 'premium' || context.userType === 'enterprise'

    logger.info(`✅ preExecute validation passed for ${context.email}`)

    return {
      timestamp: new Date().toISOString(),
      isPremiumEligible,
      validatedEmail: context.email.toLowerCase().trim()
    }
  },

  async execute(engine: WorkflowEngine<UserOnboardingContext, typeof UserOnboardingSteps>, preExecuteResult: UserOnboardingPreExecuteResult): Promise<UserOnboardingOutput> {
    // Get context from engine
    const context = engine.getContext()
    const { userType } = context

    // Use validated email from preExecute
    const email = preExecuteResult.validatedEmail

    logger.info(`📊 Starting workflow execution at: ${preExecuteResult.timestamp}`)
    logger.info(`💎 Premium eligible: ${preExecuteResult.isPremiumEligible}`)

    const welcomeResult = await engine.createCheckpoint(UserOnboardingSteps.SEND_WELCOME_EMAIL, sendWelcomeEmailCallback, email)

    await sleep(2000)

    const slackResult = await engine.createCheckpoint(UserOnboardingSteps.NOTIFY_SLACK, notifySlackCallback, email, welcomeResult.messageId)

    await sleep(2000) // Simulate delay before next step

    const jiraResult = await engine.createCheckpoint(UserOnboardingSteps.CREATE_JIRA_TICKET, createJiraTicketCallback, email, slackResult.slackMessageId)

    await sleep(2000) // Simulate delay before next step

    // Use preExecute result instead of conditional step for premium check
    let premiumResult = null
    if (preExecuteResult.isPremiumEligible) {
      await sleep(2000)
      premiumResult = await engine.createCheckpoint(UserOnboardingSteps.SETUP_PREMIUM_FEATURES, setupPremiumFeaturesCallback, email)
      logger.info("✅ Premium features setup:", premiumResult.premiumSetupAt)
    }

    await sleep(2000)

    await engine.createCheckpoint(
      UserOnboardingSteps.CONFIGURE_PREFERENCES,
      configurePreferencesCallback,
      email,
      userType,
      !!premiumResult?.premiumFeaturesEnabled
    )

    await sleep(2000) // Simulate delay before next step

    const completionResult = await engine.createCheckpoint(
      UserOnboardingSteps.SEND_COMPLETION_NOTIFICATION,
      sendCompletionNotificationCallback,
      email,
      welcomeResult.welcomeEmailSentAt,
      premiumResult?.premiumSetupAt
    )

    logger.info("🎉 User onboarding completed!")
    logger.info("📊 Onboarding Summary:")
    logger.info(`   📧 Email: ${email}`)
    logger.info(`   ⏱️  Duration: ${completionResult.onboardingDurationMinutes} minutes`)
    logger.info(`   💎 Premium: ${completionResult.hasPremiumFeatures}`)
    logger.info(`   📋 Jira Ticket: ${jiraResult.jiraTicketId}`)
    logger.info(`   💬 Slack Channel: ${slackResult.slackChannel}`)
    logger.info(`   📨 Completion ID: ${completionResult.completionMessageId}`)

    return {
      onboardingCompleted: completionResult.onboardingCompleted,
      duration: completionResult.onboardingDuration,
      hasPremiumFeatures: completionResult.hasPremiumFeatures,
      jiraTicketId: jiraResult.jiraTicketId
    }
  }
}