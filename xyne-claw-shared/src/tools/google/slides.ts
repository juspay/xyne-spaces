/**
 * Google Slides API helpers — create presentations and add slides.
 * Requires scope: https://www.googleapis.com/auth/presentations
 */

import { googleFetch } from "./oauth.js";

const BASE = "https://slides.googleapis.com/v1";
const MAX_SLIDE_TEXT_CHARS = 20_000;

interface PresentationResponse {
  presentationId: string;
  title?: string;
}

/** Create a Google Slides presentation. */
export async function createPresentation(token: string, title: string): Promise<string> {
  if (!title.trim()) throw new Error("Presentation title cannot be empty");
  const created = (await googleFetch(`${BASE}/presentations`, token, {
    method: "POST",
    body: JSON.stringify({ title }),
  })) as PresentationResponse;
  return [
    `Presentation created: ${title}`,
    `Presentation ID: ${created.presentationId}`,
    `URL: https://docs.google.com/presentation/d/${created.presentationId}/edit`,
  ].join("\n");
}

/** Add a slide with optional title and body text to an existing presentation. */
export async function addSlide(
  token: string,
  presentationId: string,
  layout: "BLANK" | "TITLE" | "TITLE_AND_BODY" = "TITLE_AND_BODY",
  title?: string,
  body?: string,
): Promise<string> {
  if (!presentationId.trim()) throw new Error("presentationId is required");
  if (title && title.length > MAX_SLIDE_TEXT_CHARS) {
    throw new Error(`Slide title too long. Max ${MAX_SLIDE_TEXT_CHARS} characters.`);
  }
  if (body && body.length > MAX_SLIDE_TEXT_CHARS) {
    throw new Error(`Slide body too long. Max ${MAX_SLIDE_TEXT_CHARS} characters.`);
  }
  const slideObjectId = `slide_${Date.now()}`;
  const titleId = `${slideObjectId}_title`;
  const bodyId = `${slideObjectId}_body`;

  const requests: Record<string, unknown>[] = [
    {
      createSlide: {
        objectId: slideObjectId,
        slideLayoutReference: { predefinedLayout: layout },
        placeholderIdMappings: [
          ...(title ? [{ layoutPlaceholder: { type: "TITLE", index: 0 }, objectId: titleId }] : []),
          ...(body ? [{ layoutPlaceholder: { type: "BODY", index: 0 }, objectId: bodyId }] : []),
        ],
      },
    },
  ];
  if (title) requests.push({ insertText: { objectId: titleId, text: title } });
  if (body) requests.push({ insertText: { objectId: bodyId, text: body } });

  await googleFetch(`${BASE}/presentations/${encodeURIComponent(presentationId)}:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
  return `Slide added to presentation ${presentationId}`;
}
