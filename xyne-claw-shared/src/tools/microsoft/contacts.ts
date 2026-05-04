/**
 * Microsoft People / Contacts API helpers (via Microsoft Graph).
 */

import { microsoftFetch } from "./oauth.js";

const BASE = "https://graph.microsoft.com/v1.0/me";

interface EmailAddress {
  name?: string;
  address: string;
}

interface Contact {
  id: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  emailAddresses?: EmailAddress[];
  businessPhones?: string[];
  mobilePhone?: string;
  companyName?: string;
  jobTitle?: string;
}

interface PeopleResult {
  id: string;
  displayName?: string;
  scoredEmailAddresses?: Array<{ address: string }>;
  phones?: Array<{ number: string; type?: string }>;
  companyName?: string;
  jobTitle?: string;
}

function formatContact(c: Contact): string {
  const name = c.displayName ?? ([c.givenName, c.surname].filter(Boolean).join(" ") || "(no name)");
  const emails = c.emailAddresses?.map((e) => e.address).join(", ") ?? "";
  const phones = [
    ...(c.businessPhones ?? []),
    ...(c.mobilePhone ? [c.mobilePhone] : []),
  ].join(", ");
  const org = [c.companyName, c.jobTitle].filter(Boolean).join(" — ");

  const parts = [`Name: ${name}`];
  if (emails) parts.push(`Email: ${emails}`);
  if (phones) parts.push(`Phone: ${phones}`);
  if (org) parts.push(`Organization: ${org}`);
  return parts.join("\n");
}

function formatPerson(p: PeopleResult): string {
  const name = p.displayName ?? "(no name)";
  const emails = p.scoredEmailAddresses?.map((e) => e.address).join(", ") ?? "";
  const phones = p.phones?.map((ph) => `${ph.number}${ph.type ? ` (${ph.type})` : ""}`).join(", ") ?? "";
  const org = [p.companyName, p.jobTitle].filter(Boolean).join(" — ");

  const parts = [`Name: ${name}`];
  if (emails) parts.push(`Email: ${emails}`);
  if (phones) parts.push(`Phone: ${phones}`);
  if (org) parts.push(`Organization: ${org}`);
  return parts.join("\n");
}

/** Search contacts/people by name or email using the People API. */
export async function searchContacts(
  token: string,
  query: string,
  maxResults: number,
): Promise<string> {
  // People API — searches across contacts, directory, and recent communications
  const params = new URLSearchParams({
    $search: `"${query.replace(/"/g, '\\"')}"`,
    $top: String(maxResults),
    $select: "displayName,scoredEmailAddresses,phones,companyName,jobTitle",
  });

  const result = (await microsoftFetch(`${BASE}/people?${params}`, token)) as {
    value: PeopleResult[];
  };

  if (!result.value || result.value.length === 0) {
    return `No contacts found for "${query}".`;
  }

  const lines = result.value.map((p, i) => `--- Contact ${i + 1} ---\n${formatPerson(p)}`);
  return `Found ${result.value.length} contact(s):\n\n${lines.join("\n\n")}`;
}

/** List contacts from the user's contact folder. */
export async function listContacts(
  token: string,
  maxResults: number,
): Promise<string> {
  const params = new URLSearchParams({
    $top: String(maxResults),
    $select: "id,displayName,givenName,surname,emailAddresses,businessPhones,mobilePhone,companyName,jobTitle",
    $orderby: "displayName",
  });

  const result = (await microsoftFetch(`${BASE}/contacts?${params}`, token)) as {
    value: Contact[];
  };

  if (!result.value || result.value.length === 0) {
    return "No contacts found.";
  }

  const lines = result.value.map((c, i) => `--- Contact ${i + 1} ---\n${formatContact(c)}`);
  return `${result.value.length} contact(s):\n\n${lines.join("\n\n")}`;
}
