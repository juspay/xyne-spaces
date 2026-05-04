/**
 * Google People API (Contacts) helpers.
 */

import { googleFetch } from "./oauth.js";

interface Person {
  resourceName: string;
  names?: Array<{ displayName: string }>;
  emailAddresses?: Array<{ value: string; type?: string }>;
  phoneNumbers?: Array<{ value: string; type?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
}

interface ConnectionsResponse {
  connections?: Person[];
  totalPeople?: number;
  nextPageToken?: string;
}

interface SearchResponse {
  results?: Array<{ person: Person }>;
}

function formatPerson(p: Person): string {
  const name = p.names?.[0]?.displayName ?? "(no name)";
  const emails = p.emailAddresses?.map((e) => `${e.value}${e.type ? ` (${e.type})` : ""}`).join(", ") ?? "";
  const phones = p.phoneNumbers?.map((ph) => `${ph.value}${ph.type ? ` (${ph.type})` : ""}`).join(", ") ?? "";
  const org = p.organizations?.[0];
  const orgStr = org ? `${org.name ?? ""}${org.title ? ` — ${org.title}` : ""}` : "";

  const parts = [`Name: ${name}`];
  if (emails) parts.push(`Email: ${emails}`);
  if (phones) parts.push(`Phone: ${phones}`);
  if (orgStr) parts.push(`Organization: ${orgStr}`);
  return parts.join("\n");
}

const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,organizations";

/** Search contacts by name or email. */
export async function searchContacts(
  token: string,
  query: string,
  maxResults: number,
): Promise<string> {
  const url = new URL("https://people.googleapis.com/v1/people:searchContacts");
  url.searchParams.set("query", query);
  url.searchParams.set("readMask", PERSON_FIELDS);
  url.searchParams.set("pageSize", String(maxResults));

  const data = (await googleFetch(url.toString(), token)) as SearchResponse;
  const results = data.results ?? [];

  if (results.length === 0) return `No contacts found for "${query}".`;

  const lines = results.map((r, i) => `--- Contact ${i + 1} ---\n${formatPerson(r.person)}`);
  return `Found ${results.length} contact(s):\n\n${lines.join("\n\n")}`;
}

/** List contacts (paginated). */
export async function listContacts(
  token: string,
  maxResults: number,
): Promise<string> {
  const url = new URL("https://people.googleapis.com/v1/people/me/connections");
  url.searchParams.set("personFields", PERSON_FIELDS);
  url.searchParams.set("pageSize", String(maxResults));
  url.searchParams.set("sortOrder", "LAST_MODIFIED_DESCENDING");

  const data = (await googleFetch(url.toString(), token)) as ConnectionsResponse;
  const contacts = data.connections ?? [];

  if (contacts.length === 0) return "No contacts found.";

  const lines = contacts.map((p, i) => `--- Contact ${i + 1} ---\n${formatPerson(p)}`);
  return `${contacts.length} contact(s) (of ${data.totalPeople ?? "unknown"} total):\n\n${lines.join("\n\n")}`;
}
