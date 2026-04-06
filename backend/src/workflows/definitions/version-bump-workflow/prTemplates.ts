/**
 * Get repository-specific PR description template.
 */
export const getPRDescription = (
  name: string,
  dependencies: { dependency: string; version: string }[],
  versionBumpUserEmail: string,
  jiraTicket: string
): string => {
  switch (name) {
    case "euler-api-txns":
    case "euler-api-cards":
    case "euler-api-pre-txn":
    case "euler-api-token":
    case "euler-api-customer": {
      const depList = dependencies.map(d => `- \`${d.dependency}\` to \`${d.version}\``).join('\n    ');
      return `**1. Problem Description** :

    Auto-generated PR bumping multiple dependencies:
    ${depList}

**2. If this is a bug fix or an enhancement, how did you identify the issue?** :

    Enhancement: Automated dependency update workflow

**3. Explain the solution implemented in the PR** :

    The following dependencies are being updated:
    ${depList}
    Updated versions in nix configuration via automated workflow

**4. Documentation**_(Link of confluence docs that you have created/updated because of the change)_ :

    N/A

**5. Provide DB Alter Details**_(if any with Proper Reasons)_ :

    N/A

**6. Provide Data fix Details**_(if any with Proper Reasons)_ :

    N/A

**7. Provide Service Config Changes**_(if any with Proper Reasons)_ :

    N/A

**8. Provide Environment variable Changes** _(Please state clearly if this needs to be added to all services or a specific service)_ :

    N/A

**9. Does this include a Library change, If yes, provide the PR for the library change(s) done** :

    N/A

**10. Are their related PRs to your change in this/other repos? If yes, link the PR here** :

    N/A

**11. Testing** _(Describe the testing you have done to ensure the changes made in this pull requests are working correctly and not breaking any existing flow)_:

    N/A

**12. Is there any specific deployment plan to be followed for this change?** :

    N/A

**13. List the service to which this change is to deployed** _(Refrain from writing "All")_ :

    ${name}

**14. How do we verify this change during and post deployment?** :

    N/A

**PR Raised on behalf of** @"${versionBumpUserEmail}"

**Associated JIRA Ticket:** ${jiraTicket}`;
    }

    case "euler-api-gateway": {
      const depList = dependencies.map(d => `- \`${d.dependency}\` to \`${d.version}\``).join('\n    ');
      return `**1. Problem Description** :

    Auto-generated PR bumping multiple dependencies:
    ${depList}

**2. If this is a bug fix or an enhancement, how did you identify the issue?** :

    Enhancement: Automated dependency update workflow

**3. Explain the solution implemented in the PR** :

    The following dependencies are being updated:
    ${depList}
    Updated versions in nix configuration via automated workflow

**4. Documentation**_(Link of confluence docs that you have created/updated because of the change)_ :

    N/A

**5. Provide DB Alter Details**_(if any)_ :

    N/A

**6. Provide Data fix Details**_(if any)_ :

    N/A

**7. Provide Service Config Changes**_(if any)_ :

    N/A

**8. Provide Environment variable Changes** _(Please state clearly if this needs to be added to all services or a specific service)_ :

    N/A

**9. Does this include a Library change, If yes, provide the PR for the library change(s) done** :

    N/A

**10. Are their related PRs to your change in this/other repos? If yes, link the PR here** :

    N/A

**11. Testing** _(Describe the testing you have done to ensure the changes made in this pull requests are working correctly and not breaking any existing flow)_:

    N/A

**12. Is there any specific deployment plan to be followed for this change?** :

    N/A

**13. List the service to which this change is to deployed** _(Refrain from writing "All")_ :

    ${name}

**14. How do we verify this change during and post deployment?** :

    N/A

**15. List all the gateways to which this change will impact** :

    N/A

**PR Raised on behalf of** @"${versionBumpUserEmail}"

**Associated JIRA Ticket:** ${jiraTicket}`;
    }

    case "euler-api-order": {
      const depList = dependencies.map(d => `- \`${d.dependency}\` to \`${d.version}\``).join('\n    ');
      return `**1. Problem Description** :

    Auto-generated PR bumping multiple dependencies:
    ${depList}

**2. If this is a bug fix or an enhancement, how did you identify the issue?** :

    Enhancement: Automated dependency update workflow

**3. Explain the solution implemented in the PR** :

    The following dependencies are being updated:
    ${depList}
    Updated versions in nix configuration via automated workflow

**4. Documentation**_(Link of confluence docs that you have created/updated because of the change)_ :

    N/A

**5. Provide DB Alter Details**_(if any)_ :

    N/A

**6. Provide Data fix Details**_(if any)_ : 

    N/A

**7. Provide Service Config Changes**_(if any)_ :

    N/A

**8. Provide Environment variable Changes** _(Please state clearly if this needs to be added to all services or a specific service)_ :

    N/A

**9. Does this include a Library change, If yes, provide the PR for the library change(s) done** :

    N/A

**10. Are their related PRs to your change in this/other repos? If yes, link the PR here** :

    N/A

**11. Testing** _(Describe the testing you have done to ensure the changes made in this pull requests are working correctly and not breaking any existing flow)_:

    N/A

**12. Is there any specific deployment plan to be followed for this change?** :

    N/A

**13. List the service to which this change is to deployed** _(Refrain from writing "All")_ :

    ${name}

**14. How do we verify this change during and post deployment?** :

    N/A

**15. Provide a brief regarding the Business Impact due to this change** :

    None (Internal dependency update)

**16. Which product does this change impact or implement for?** :

    All products utilizing these dependencies

**PR Raised on behalf of** @"${versionBumpUserEmail}"

**Associated JIRA Ticket:** ${jiraTicket}`;
    }

    case "euler-api-dashboard": {
      const depList = dependencies.map(d => `- \`${d.dependency}\` to \`${d.version}\``).join('\n    ');
      return `1. Problem Description:

    Auto-generated PR bumping multiple dependencies:
    ${depList}

2. If this is a bug fix or an enhancement, in case of bugfix, how did you identify the issue?:

    Enhancement: Automated dependency update workflow

3. Provide the list of API's modified in this PR:

    None (Nix configuration only)

4. Explain the solution implemented in the PR:

    The following dependencies are being updated:
    ${depList}
    Updated versions in nix configuration via automated workflow

5. Documentation(Link of confluence docs that you have created/updated because of the change) :

    N/A

6. Provide DB Alter Details(if any) :

    N/A

7. Provide Data fix Details(if any) :

    N/A

8. Provide Service Config Changes(if any) :

    N/A

9. Provide Environment variable Changes (Please state clearly if this needs to be added to all services or a specific service) :

    N/A

10. Does this include a Library change, If yes, provide the PR for the library change(s) done:

    N/A

11. Are there related PRs to your change in this/other repos? If yes, link the PR here:

    N/A

12. Does this PR have frontend dependency? If yes, link the frontend PR here:

    No

13. Testing (Describe the testing you have done to ensure the changes made in this pull requests are working correctly and not breaking any existing flow):

    N/A

14. Is there any specific deployment plan to be followed for this change?:

    N/A

15. List the service to which this change is to deployed (Refrain from writing "All") :

    ${name}

16. How do we verify this change during and post deployment?:

    N/A

**Kindly do not push flake.lock, overlay.nix unless there is a library change**
**Do not use encodeDecodeTransform**

**PR Raised on behalf of** @"${versionBumpUserEmail}"

**Associated JIRA Ticket:** ${jiraTicket}`;
    }

    default: {
      const depList = dependencies.map(d => `- \`${d.dependency}\` to \`${d.version}\``).join('\n    ');
      return `**1. Problem Description** :

    Auto-generated PR bumping multiple dependencies:
    ${depList}

**2. Explain the solution implemented in the PR** :

    The following dependencies are being updated:
    ${depList}
    Updated versions in nix configuration via automated workflow

**3. Testing** :

    N/A

**4. Is there any specific deployment plan to be followed for this change?** :

    N/A

**5. How do we verify this change during and post deployment?** :

    N/A

**PR Raised on behalf of** @"${versionBumpUserEmail}"

**Associated JIRA Ticket:** ${jiraTicket}`;
    }
  }
};
