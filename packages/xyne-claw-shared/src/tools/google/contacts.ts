/**
 * Google People API (Contacts) helpers.
 */

import { googleFetch } from "./oauth.js";

/** People API FieldMetadata — the `primary` flag marks the canonical email/phone. */
interface FieldMetadata {
  primary?: boolean;
}

interface Person {
  resourceName: string;
  names?: Array<{ displayName: string }>;
  emailAddresses?: Array<{ value: string; type?: string; metadata?: FieldMetadata }>;
  phoneNumbers?: Array<{ value: string; type?: string; metadata?: FieldMetadata }>;
  // `department` is returned by the API but was previously never modeled.
  organizations?: Array<{ name?: string; title?: string; department?: string }>;
  // `addresses` / `birthdays` were previously never requested nor surfaced.
  addresses?: Array<{
    formattedValue?: string;
    type?: string;
    streetAddress?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  }>;
  birthdays?: Array<{ date?: { year?: number; month?: number; day?: number }; text?: string }>;
}

interface ConnectionsResponse {
  connections?: Person[];
  totalPeople?: number;
  nextPageToken?: string;
}

interface SearchResponse {
  results?: Array<{ person: Person }>;
}

/** Render one birthday: prefer the API `text`, else assemble the `date` parts. */
function formatBirthday(b: NonNullable<Person["birthdays"]>[number]): string {
  if (b.text) return b.text;
  const d = b.date;
  if (!d || d.month === undefined || d.day === undefined) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  // `year` is optional in the People API (many contacts store only month/day).
  return d.year ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : `${pad(d.month)}-${pad(d.day)}`;
}

/** Render one postal address: prefer the API `formattedValue`, else assemble parts. */
function formatAddress(a: NonNullable<Person["addresses"]>[number]): string {
  const value =
    a.formattedValue ??
    [a.streetAddress, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ");
  return value ? `${value}${a.type ? ` (${a.type})` : ""}` : "";
}

function formatPerson(p: Person): string {
  const name = p.names?.[0]?.displayName ?? "(no name)";
  // Preserve all emails/phones and mark the API's metadata.primary entry.
  const emails =
    p.emailAddresses
      ?.map((e) => `${e.value}${e.type ? ` (${e.type})` : ""}${e.metadata?.primary ? " (primary)" : ""}`)
      .join(", ") ?? "";
  const phones =
    p.phoneNumbers
      ?.map((ph) => `${ph.value}${ph.type ? ` (${ph.type})` : ""}${ph.metadata?.primary ? " (primary)" : ""}`)
      .join(", ") ?? "";
  // Surface ALL organizations (not just [0]) and include the `department` field.
  const orgStr =
    p.organizations
      ?.map((o) => [o.name, o.department, o.title].filter(Boolean).join(" — "))
      .filter((s) => s.length > 0)
      .join("; ") ?? "";
  // People API `addresses` — previously never surfaced.
  const addressStr =
    p.addresses
      ?.map(formatAddress)
      .filter((s) => s.length > 0)
      .join("; ") ?? "";
  // People API `birthdays` — previously never surfaced.
  const birthdayStr =
    p.birthdays
      ?.map(formatBirthday)
      .filter((s) => s.length > 0)
      .join(", ") ?? "";

  const parts = [`Name: ${name}`];
  if (emails) parts.push(`Email: ${emails}`);
  if (phones) parts.push(`Phone: ${phones}`);
  if (orgStr) parts.push(`Organization: ${orgStr}`);
  if (addressStr) parts.push(`Address: ${addressStr}`);
  if (birthdayStr) parts.push(`Birthday: ${birthdayStr}`);
  return parts.join("\n");
}

// readMask fields fetched from the People API. `addresses`/`birthdays` were
// previously omitted (address/birthday questions were unanswerable); `metadata`
// is added so the primary email/phone can be marked.
const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,organizations,addresses,birthdays,metadata";

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
  // Keep the (of N total) disclosure; if the API returned a nextPageToken there
  // are more contacts beyond this single page — say so rather than imply this is all.
  const total = data.totalPeople ?? "unknown";
  const moreNote = data.nextPageToken ? " — more can be paged (nextPageToken present)" : "";
  return `${contacts.length} contact(s) (of ${total} total)${moreNote}:\n\n${lines.join("\n\n")}`;
}
