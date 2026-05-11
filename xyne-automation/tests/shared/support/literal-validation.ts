const allowedBrowserNamePattern = /^[a-z0-9]+-browser-\d+$/;
const allowedTestUserEmailPattern = /^test-(user|admin)-email-\d+@xyne-test\.local$/;
const allowedUserAliasPattern = /^(admin|user)-\d+$/;
const allowedProjectAliasPattern = /^project-[a-zA-Z0-9-]+$/;
const allowedChannelAliasPattern = /^channel-[a-zA-Z0-9-]+$/;
const allowedDmAliasPattern = /^dm-[a-zA-Z0-9-]+$/;
const allowedMessageAliasPattern = /^message-[a-zA-Z0-9-]+$/;
const allowedTicketAliasPattern = /^ticket-[a-zA-Z0-9-]+$/;

export function assertValidStatusCode(statusCode: string): void {
  const code = Number.parseInt(statusCode, 10);
  if (Number.isNaN(code) || code < 100 || code > 599) {
    throw new Error(
      `Invalid HTTP status code "${statusCode}". Must be a number between 100 and 599.`
    );
  }
}

export function assertValidBrowserName(browserName: string): void {
  if (!allowedBrowserNamePattern.test(browserName)) {
    throw new Error(
      `Invalid browser name "${browserName}". Use the format <name>-browser-<number>.`
    );
  }
}

export function assertValidUserAlias(userAlias: string): void {
  if (!allowedUserAliasPattern.test(userAlias)) {
    throw new Error(
      `Invalid user alias "${userAlias}". Use the format admin-<number> or user-<number>.`
    );
  }
}

export function assertValidProjectAlias(projectAlias: string): void {
  if (!allowedProjectAliasPattern.test(projectAlias)) {
    throw new Error(`Invalid project alias "${projectAlias}". Use the format project-<string>.`);
  }
}

export function assertValidChannelAlias(channelAlias: string): void {
  if (!allowedChannelAliasPattern.test(channelAlias)) {
    throw new Error(`Invalid channel alias "${channelAlias}". Use the format channel-<string>.`);
  }
}

export function assertValidDmAlias(dmAlias: string): void {
  if (!allowedDmAliasPattern.test(dmAlias)) {
    throw new Error(`Invalid DM alias "${dmAlias}". Use the format dm-<string>.`);
  }
}

export function assertValidMessageAlias(messageAlias: string): void {
  if (!allowedMessageAliasPattern.test(messageAlias)) {
    throw new Error(`Invalid message alias "${messageAlias}". Use the format message-<string>.`);
  }
}

export function assertValidTicketAlias(ticketAlias: string): void {
  if (!allowedTicketAliasPattern.test(ticketAlias)) {
    throw new Error(`Invalid ticket alias "${ticketAlias}". Use the format ticket-<string>.`);
  }
}

export function assertValidUrlPath(urlPath: string): void {
  if (!urlPath.startsWith('/')) {
    throw new Error(`Invalid URL path "${urlPath}". Paths must start with /.`);
  }

  const pathToValidate = urlPath.endsWith('/*') ? urlPath.slice(0, -2) : urlPath;
  const url = new URL(`http://validation.local${pathToValidate}`);
  if (url.origin !== 'http://validation.local') {
    throw new Error(`Invalid URL path "${urlPath}".`);
  }

  if (urlPath.startsWith('/auth')) {
    const email = url.searchParams.get('email');

    for (const key of url.searchParams.keys()) {
      if (key !== 'email' && key !== 'setAsNewUser') {
        throw new Error(
          `Invalid auth path "${urlPath}". Only email and setAsNewUser query params are allowed.`
        );
      }
    }

    const setAsNewUser = url.searchParams.get('setAsNewUser');
    if (setAsNewUser !== null && setAsNewUser !== 'true' && setAsNewUser !== 'false') {
      throw new Error(
        `Invalid auth path "${urlPath}". setAsNewUser must be omitted, 'true', or 'false'.`
      );
    }

    if (email && !allowedTestUserEmailPattern.test(email)) {
      throw new Error(
        `Invalid test user email "${email}" in auth path. Use test-(user|admin)-email-<N>@xyne-test.local.`
      );
    }
  }
}
