/**
 * fill-pdf-form / inspect-pdf-form — work with AcroForm PDFs the agent has
 * access to in its session workspace.
 *
 * Use cases:
 *   - Admin attaches a fillable PDF as a Skill file (lands at
 *     `.skills/<skill-slug>/template.pdf` via session-skills.ts).
 *   - Or user attaches a fillable PDF in their @mention (lands at
 *     `.context/<filename>.pdf` via run.ts's pdf passthrough).
 *
 * Workflow:
 *   1. Agent calls `inspect-pdf-form` with the path → gets the list of field
 *      names and types. This is the contract for the values JSON.
 *   2. Agent extracts values from the source documents (also in .context/).
 *   3. Agent calls `fill-pdf-form` with the same path + values + output
 *      filename. The tool fills the fields, flattens the form (so the output
 *      is final), and pushes the result as an attachment to the thread.
 *
 * Notes:
 *   - We deliberately use the existing pushAttachment progress hook so the
 *     filled PDF appears mid-session, same as create-ppt / create-pdf.
 *   - The flatten step is configurable (default true). For drafts where the
 *     user wants to keep editing in Acrobat, the agent passes flatten=false.
 */

import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import https from "node:https";
import http from "node:http";
import type { ToolDefinition, ToolExecutionContext } from "../types.js";

// pdf-lib is a runtime-only dependency of xyne-claw, not xyne-claw-shared.
// We lazy-import it inside the handlers so the shared package can typecheck
// without taking on the dep. claw-auth never executes these handlers (it
// only consumes tool definitions for DB seeding) so the import never fires
// there. Types are intentionally loose — we only call a handful of methods
// and the runtime errors are surfaced as friendly strings to the agent.
type PdfLibModule = {
  PDFDocument: {
    load: (buf: Buffer | Uint8Array) => Promise<PdfDocLike>;
  };
};
interface PdfFieldLike {
  getName(): string;
  constructor: { name: string };
}
interface PdfTextFieldLike {
  setText(value: string): void;
  setFontSize(size: number): void;
}
interface PdfFormLike {
  getFields(): PdfFieldLike[];
  getTextField(name: string): PdfTextFieldLike;
  getCheckBox(name: string): { check(): void; uncheck(): void };
  getDropdown(name: string): { select(value: string): void };
  getRadioGroup(name: string): { select(value: string): void };
  flatten(): void;
}
interface PdfDocLike {
  getForm(): PdfFormLike;
  save(): Promise<Uint8Array>;
}
async function loadPdfLib(): Promise<PdfLibModule> {
  // Indirect import-specifier — keeps tsc from trying to resolve `pdf-lib`
  // at compile time inside xyne-claw-shared (where the dep isn't installed).
  // Resolved at runtime by xyne-claw, which has pdf-lib in its node_modules.
  const moduleId = "pdf-lib";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await (Function("m", "return import(m)") as (m: string) => Promise<unknown>)(moduleId)) as PdfLibModule;
  return mod;
}

/**
 * Resolve `path` to an absolute filesystem location, refusing anything that
 * escapes the agent's session workspace or its session-skills directory.
 *
 * Allowed roots (determined from the running session context):
 *   - the agent's cwd (resolved by node's process — pi-coding-agent chdir's
 *     to the session workspace before running tool calls)
 *   - the session-skills tree at `${PATHS.dataDir}/session-skills/...`,
 *     which is a sibling to the workspace.
 *
 * We resolve liberally — the working directory is already the session — and
 * only block obvious escapes (absolute paths to /etc, etc).
 */
function resolveSessionPath(relPath: string): string {
  // Refuse absolute paths outside the cwd. We don't know the workspace dir
  // here without plumbing it through — use cwd which IS the workspace at
  // tool-execution time.
  const cwd = process.cwd();
  let candidate: string;
  if (isAbsolute(relPath)) {
    candidate = resolve(relPath);
  } else {
    candidate = resolve(cwd, relPath);
  }
  // Cheap traversal check — refuse paths that go above cwd / session root.
  if (relPath.includes("..")) {
    throw new Error(`refusing path with traversal: ${relPath}`);
  }
  return candidate;
}

/** POST a base64 attachment to the progress URL — mirrors the existing
 *  pushAttachment helper used by other tools, inlined here so the shared
 *  package doesn't have to import from xyne-claw. */
function pushAttachmentViaProgress(
  progressUrl: string,
  sessionId: string,
  s2sKey: string | undefined,
  attachment: { fileName: string; mimeType: string; data: string; metadata?: Record<string, unknown> },
): void {
  try {
    const u = new URL(progressUrl);
    const body = JSON.stringify({ sessionId, attachment });
    const isHttps = u.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...(s2sKey ? { "x-s2s-key": s2sKey } : {}),
        },
      },
      (res) => { res.resume(); }, // drain
    );
    req.on("error", (err) => {
      console.warn(`[fill-pdf-form] pushAttachment failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    req.write(body);
    req.end();
  } catch (err) {
    console.warn(`[fill-pdf-form] pushAttachment threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── inspect-pdf-form ────────────────────────────────────────────────────────

export const inspectPdfForm: ToolDefinition = {
  slug: "inspect-pdf-form",
  name: "Inspect PDF form",
  description:
    "List the AcroForm field names and types of a fillable PDF in the agent's workspace. Use this BEFORE calling fill-pdf-form so you know the exact field names the template expects.",
  source: "custom:fill-pdf-form",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Relative path to the PDF inside the session workspace. Common locations: `.skills/<skill-slug>/<filename>.pdf` for admin-uploaded templates, `.context/<filename>.pdf` for user-attached files. Resolved against the agent's cwd.",
      },
    },
    required: ["path"],
  },
  execute: async (params: Record<string, unknown>): Promise<string> => {
    const path = String((params as { path?: unknown }).path ?? "").trim();
    if (!path) return "Error: `path` is required.";
    let buf: Buffer;
    try {
      buf = await readFile(resolveSessionPath(path));
    } catch (err) {
      return `Error: could not read ${path}: ${err instanceof Error ? err.message : String(err)}`;
    }
    let pdf: PdfDocLike;
    try {
      const { PDFDocument } = await loadPdfLib();
      pdf = await PDFDocument.load(buf);
    } catch (err) {
      return `Error: not a valid PDF: ${err instanceof Error ? err.message : String(err)}`;
    }
    const form = pdf.getForm();
    const fields = form.getFields();
    if (fields.length === 0) {
      return `No AcroForm fields in ${path}. This is a flat PDF — you cannot fill it. If the user expects to fill this template, they must convert it to a fillable PDF in Acrobat (Prepare Form → save) and re-upload.`;
    }
    const rows: Array<{ name: string; type: string }> = fields.map((f: PdfFieldLike) => {
      const constructor = f.constructor.name;
      const type =
        constructor === "PDFTextField" ? "text" :
        constructor === "PDFCheckBox" ? "checkbox" :
        constructor === "PDFDropdown" ? "dropdown" :
        constructor === "PDFRadioGroup" ? "radio" :
        constructor === "PDFOptionList" ? "optionlist" :
        constructor === "PDFButton" ? "button" :
        "unknown";
      return { name: f.getName(), type };
    });
    const summary = {
      path,
      totalFields: rows.length,
      byType: rows.reduce<Record<string, number>>((acc: Record<string, number>, r: { name: string; type: string }) => {
        acc[r.type] = (acc[r.type] ?? 0) + 1;
        return acc;
      }, {}),
      fields: rows,
    };
    return JSON.stringify(summary, null, 2);
  },
};

// ─── fill-pdf-form ───────────────────────────────────────────────────────────

export const fillPdfForm: ToolDefinition = {
  slug: "fill-pdf-form",
  name: "Fill PDF form",
  description:
    "Fill the AcroForm fields of a fillable PDF and post the filled result as an attachment in the thread. Use `inspect-pdf-form` first to learn the exact field names. Fields not present in the template are reported back so the caller can correct its mapping.",
  source: "custom:fill-pdf-form",
  inputSchema: {
    type: "object",
    properties: {
      templatePath: {
        type: "string",
        description:
          "Relative path to the fillable PDF in the workspace (same locations as inspect-pdf-form).",
      },
      values: {
        type: "object",
        description:
          "Field name → value mapping. Values are coerced to strings. Checkbox fields accept true/false. Text fields accept any string; multi-line text is preserved.",
        additionalProperties: true,
      },
      outputFileName: {
        type: "string",
        description:
          "Filename for the attachment posted back to the thread, e.g. 'CAM-Acme-2026-05-30.pdf'.",
      },
      flatten: {
        type: "boolean",
        description:
          "Default FALSE — the output keeps form fields live, so Acrobat shows scrollbars for any multi-line content that overflows the box (no clipping/oversizing). Pass true ONLY when the user wants the final signed/sanctioned version that must be non-editable.",
      },
    },
    required: ["templatePath", "values", "outputFileName"],
  },
  execute: async (
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string> => {
    const templatePath = String((params as { templatePath?: unknown }).templatePath ?? "").trim();
    const outputFileName = String((params as { outputFileName?: unknown }).outputFileName ?? "").trim();
    const valuesRaw = (params as { values?: unknown }).values;
    // Default FALSE — see prop description. The agent should only pass
    // true=flatten when the user explicitly asks for a non-editable final.
    const flatten = (params as { flatten?: unknown }).flatten === true;

    if (!templatePath) return "Error: `templatePath` is required.";
    if (!outputFileName) return "Error: `outputFileName` is required.";
    if (!valuesRaw || typeof valuesRaw !== "object" || Array.isArray(valuesRaw)) {
      return "Error: `values` must be an object mapping field names to values.";
    }
    const values = valuesRaw as Record<string, unknown>;

    let buf: Buffer;
    try {
      buf = await readFile(resolveSessionPath(templatePath));
    } catch (err) {
      return `Error: could not read template ${templatePath}: ${err instanceof Error ? err.message : String(err)}`;
    }
    let pdf: PdfDocLike;
    try {
      const { PDFDocument } = await loadPdfLib();
      pdf = await PDFDocument.load(buf);
    } catch (err) {
      return `Error: template is not a valid PDF: ${err instanceof Error ? err.message : String(err)}`;
    }
    const form = pdf.getForm();
    const fields = form.getFields();
    if (fields.length === 0) {
      return `Error: ${templatePath} has no AcroForm fields. Convert the template to a fillable PDF in Acrobat (Prepare Form → save) and re-upload before calling fill-pdf-form.`;
    }

    const fieldsByName = new Map<string, PdfFieldLike>();
    for (const f of fields) fieldsByName.set(f.getName(), f);

    const filled: string[] = [];
    const unknownFields: string[] = [];
    const setErrors: Array<{ field: string; error: string }> = [];

    for (const [fieldName, value] of Object.entries(values)) {
      const field = fieldsByName.get(fieldName);
      if (!field) {
        unknownFields.push(fieldName);
        continue;
      }
      try {
        const ctor = field.constructor.name;
        if (ctor === "PDFTextField") {
          const tf = form.getTextField(fieldName);
          const str = value === null || value === undefined ? "" : String(value);
          tf.setText(str);
          // Lock the font size so pdf-lib's flatten doesn't auto-scale the
          // text. Without this, short strings in multi-line boxes render
          // huge (filling the box vertically) and long strings in narrow
          // single-line boxes get clipped on the right. 9pt is the sweet
          // spot for the CAM template's row heights (22pt single-line,
          // 50-80pt multi-line); shrink to 8pt for very long values that
          // would otherwise still overflow.
          const fontSize = str.length > 120 ? 8 : 9;
          try {
            tf.setFontSize(fontSize);
          } catch {
            // Older pdf-lib versions or non-standard fields may reject
            // setFontSize; better to render with the default than to fail
            // the whole fill.
          }
          filled.push(fieldName);
        } else if (ctor === "PDFCheckBox") {
          const cb = form.getCheckBox(fieldName);
          if (value === true || value === "true" || value === 1 || value === "1" || value === "yes") cb.check();
          else cb.uncheck();
          filled.push(fieldName);
        } else if (ctor === "PDFDropdown") {
          const dd = form.getDropdown(fieldName);
          dd.select(String(value));
          filled.push(fieldName);
        } else if (ctor === "PDFRadioGroup") {
          const rg = form.getRadioGroup(fieldName);
          rg.select(String(value));
          filled.push(fieldName);
        } else {
          setErrors.push({ field: fieldName, error: `unsupported field type ${ctor}` });
        }
      } catch (err) {
        setErrors.push({
          field: fieldName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (flatten) {
      try { form.flatten(); } catch { /* some fields may resist flatten — non-fatal */ }
    }

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await pdf.save();
    } catch (err) {
      return `Error: pdf.save() failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Also stream a mid-session preview via the progress endpoint when we
    // have one. This is best-effort UX (Spaces can render the attachment
    // chip while the model is still talking). The CANONICAL attachment
    // delivery is the [ATTACHMENT:...] marker at the END of the tool's
    // return string — that is what custom-tools.ts scans for and forwards
    // to claw-auth's /webhook/result handler. Without the marker, the
    // attachment never lands in the final Spaces message — we hit this
    // when fill-pdf-form first ran in prod: 99 fields filled, "0
    // attachment(s)" in run completion, agent told the user "PDF attached"
    // (it wasn't).
    if (context?.progressUrl && context.sessionId) {
      pushAttachmentViaProgress(context.progressUrl, context.sessionId, context.s2sKey, {
        fileName: outputFileName,
        mimeType: "application/pdf",
        data: Buffer.from(pdfBytes).toString("base64"),
      });
    }

    // Summary back to the agent. List of un-filled template fields helps it
    // see what's still missing without us having to scan the JSON itself.
    const allTemplateFieldNames = Array.from(fieldsByName.keys());
    const notFilledInTemplate = allTemplateFieldNames.filter((n) => !filled.includes(n));

    const summary = JSON.stringify(
      {
        success: true,
        outputFileName,
        sizeBytes: pdfBytes.byteLength,
        filledCount: filled.length,
        filled,
        unknownFields,
        notFilledInTemplate,
        setErrors,
        flatten,
        note:
          unknownFields.length > 0
            ? "Some values you provided don't match any template field. Run inspect-pdf-form to see the exact field names."
            : notFilledInTemplate.length > 0
              ? "Template has fields you didn't fill — they're listed under notFilledInTemplate."
              : "All template fields were filled.",
      },
      null,
      2,
    );

    // Attachment marker. ATTACHMENT_RE in xyne-claw/src/custom-tools.ts is
    // anchored at start-of-string, so the marker MUST be the first thing
    // returned. Format (mirrors create-pdf / create-ppt):
    //   [ATTACHMENT:<fileName>:<mime>]\n<single-line base64>\n\n<summary>
    // The trailing summary text is what the LLM sees in its tool-result
    // content blocks; the marker + base64 is stripped by the runtime and
    // routed into allAttachments → /webhook/result → Spaces.
    const PDF_MIME = "application/pdf";
    return (
      `[ATTACHMENT:${outputFileName}:${PDF_MIME}]\n` +
      Buffer.from(pdfBytes).toString("base64") +
      `\n\n` +
      summary
    );
  },
};
