# Security Policy

We take the security of Xyne Spaces seriously. Xyne Spaces is a
permission-aware org-context layer that indexes and serves sensitive
organizational data, so we treat vulnerability reports with high priority.

## Reporting a Vulnerability

If you believe you have found a security vulnerability, please report it to us
**privately**. **Do not open a public GitHub issue for security
vulnerabilities**, as that discloses the issue before a fix is available.

Please report via one of the following:

- **GitHub private advisory (preferred):**
  https://github.com/juspay/xyne-spaces/security/advisories/new
- **Email:** security@xyne.juspay.net <!-- TODO: confirm monitored inbox -->

Please include as much of the following as you can:

- A description of the vulnerability and its potential impact
- Steps to reproduce, ideally with a proof-of-concept
- The affected version or commit SHA, and deployment mode (self-hosted / cloud)
- Any configuration relevant to the issue
- Any suggested remediation

## Our Commitment

- We will **acknowledge your report within 1 business day**.
- We will provide an initial assessment and an expected remediation timeline
  within **5 business days**.
- We will keep you informed as we work on a fix.
- We will credit you in the release notes once the issue is resolved, unless
  you prefer to remain anonymous.

We follow a coordinated disclosure model. Please give us a reasonable window to
remediate before any public disclosure.

## Supported Versions

Security fixes are applied to the latest released version on the `main` branch.
Self-hosted operators are strongly encouraged to stay current with the latest
release to receive security updates.

## Scope

**In scope:**

- The Xyne Spaces application code in this repository
- Official Docker images and the documented self-hosting deployment
  configurations

**Out of scope:**

- Third-party integrations and dependencies (please report those to the
  respective upstream projects)
- Issues that require privileged local access to a machine already running
  Xyne Spaces
- Social-engineering and physical attacks

Thank you for helping keep Xyne Spaces and its users safe.
