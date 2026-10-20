import { UserType } from '@xyne/shared';

/** Bots, apps and agents all read as "not a person": they get the AGENT tag. */
export function isAgentUserType(userType: string | null | undefined): boolean {
  return userType === UserType.BOT || userType === UserType.APP || userType === UserType.AGENT;
}
