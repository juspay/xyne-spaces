/**
 * Generate the CAM AcroForm PDF programmatically - no Acrobat required.
 *
 * Why: the bank's flat CAM PDF can't be filled by tools (no widgets exist
 * in the file). Rather than ask the user to do the Acrobat Prepare Form
 * pass by hand, this script lays out a clean A4 CAM with the same 16
 * sections from the bank template AND attaches AcroForm text widgets with
 * the semantic field names the credit-appraisal-agent expects.
 *
 * Output: a real AcroForm PDF. inspect-pdf-form will return a non-zero
 * field list; fill-pdf-form will populate them; the result is a
 * sanctioning-quality document the agent can hand back.
 *
 * Visual style is utilitarian, not pixel-faithful to the bank's template.
 * Sections, headers, label columns, multi-line commentary boxes - all
 * present. Branding can layer on top later.
 *
 * Usage:
 *   cd xyne-claw-auth/backend
 *   npx tsx scripts/generate-cam-acroform.ts \
 *     /Users/anurag.dwivedi/work_dir/xyne-spaces/cam-templates/template.pdf
 *
 * Then re-upload the folder via the admin UI (replace-all semantics swap
 * the SkillFile bundle atomically).
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
  type PDFTextField,
  type PDFForm,
} from "pdf-lib";

// ─── Page geometry (A4) ──────────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_L = 40;
const MARGIN_R = 40;
const MARGIN_T = 50;
const MARGIN_B = 50;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R; // 515.28

// Colors
const BLUE_DARK = rgb(0.12, 0.22, 0.39);   // section headers
const BLUE_LIGHT = rgb(0.85, 0.89, 0.95);  // row labels
const GREY_LINE = rgb(0.78, 0.80, 0.84);
const TEXT = rgb(0.13, 0.13, 0.13);
const GREY_MUTED = rgb(0.45, 0.45, 0.50);

// ─── Stateful layout cursor ──────────────────────────────────────────────
class Cursor {
  pdf: PDFDocument;
  form: PDFForm;
  font: PDFFont;
  fontBold: PDFFont;
  page: PDFPage;
  y: number; // current Y (bottom-up coordinates in pdf-lib)
  pageNum = 1;

  constructor(pdf: PDFDocument, form: PDFForm, font: PDFFont, fontBold: PDFFont) {
    this.pdf = pdf;
    this.form = form;
    this.font = font;
    this.fontBold = fontBold;
    this.page = pdf.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN_T;
    this.drawFooter();
  }

  /** Ensure there's at least `needed` points of vertical space; page-break if not. */
  ensureSpace(needed: number): void {
    if (this.y - needed < MARGIN_B + 18) {
      this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
      this.pageNum += 1;
      this.y = PAGE_H - MARGIN_T;
      this.drawFooter();
    }
  }

  drawFooter(): void {
    this.page.drawText(`Confidential - Internal Use Only`, {
      x: MARGIN_L,
      y: MARGIN_B - 18,
      size: 8,
      font: this.font,
      color: GREY_MUTED,
    });
    this.page.drawText(`Page ${this.pageNum}`, {
      x: PAGE_W - MARGIN_R - 40,
      y: MARGIN_B - 18,
      size: 8,
      font: this.font,
      color: GREY_MUTED,
    });
  }

  sectionHeader(label: string): void {
    this.ensureSpace(38);
    this.y -= 6;
    this.page.drawRectangle({
      x: MARGIN_L,
      y: this.y - 18,
      width: CONTENT_W,
      height: 22,
      color: BLUE_DARK,
    });
    this.page.drawText(label, {
      x: MARGIN_L + 8,
      y: this.y - 13,
      size: 11,
      font: this.fontBold,
      color: rgb(1, 1, 1),
    });
    this.y -= 30;
  }

  hint(text: string): void {
    this.ensureSpace(14);
    this.page.drawText(text, {
      x: MARGIN_L,
      y: this.y - 8,
      size: 8,
      font: this.font,
      color: GREY_MUTED,
    });
    this.y -= 14;
  }

  /** A single-line label/value row with a text field. Narrower label
   *  column (140pt instead of 180pt) so the value column is roughly
   *  CONTENT_W - 140 = ~375pt — wide enough for full addresses, role
   *  titles, etc. without right-edge clipping. */
  labelRow(label: string, fieldName: string, valueWidth = CONTENT_W - 140): void {
    this.ensureSpace(24);
    const ROW_H = 22;
    const LABEL_W = 140;
    // Label cell
    this.page.drawRectangle({
      x: MARGIN_L,
      y: this.y - ROW_H,
      width: LABEL_W,
      height: ROW_H,
      color: BLUE_LIGHT,
    });
    this.page.drawRectangle({
      x: MARGIN_L,
      y: this.y - ROW_H,
      width: LABEL_W,
      height: ROW_H,
      borderColor: GREY_LINE,
      borderWidth: 0.5,
    });
    this.page.drawText(label, {
      x: MARGIN_L + 6,
      y: this.y - 14,
      size: 9,
      font: this.fontBold,
      color: TEXT,
    });
    // Value cell border
    this.page.drawRectangle({
      x: MARGIN_L + LABEL_W,
      y: this.y - ROW_H,
      width: valueWidth,
      height: ROW_H,
      borderColor: GREY_LINE,
      borderWidth: 0.5,
    });
    // Text field
    const tf = this.form.createTextField(fieldName);
    tf.setText("");
    tf.addToPage(this.page, {
      x: MARGIN_L + LABEL_W + 2,
      y: this.y - ROW_H + 2,
      width: valueWidth - 4,
      height: ROW_H - 4,
      borderWidth: 0,
    });
    this.y -= ROW_H;
  }

  /** A multi-line text-area row with a label above. Default doubled from
   *  60 → 120pt so 3-4 sentences of commentary fit at 9pt without scroll.
   *  Long content still scrolls in Acrobat when flatten=false (the
   *  default in fill-pdf-form) so nothing is ever lost. */
  multilineRow(label: string, fieldName: string, height = 120): void {
    this.ensureSpace(14 + height + 6);
    this.page.drawText(label, {
      x: MARGIN_L,
      y: this.y - 10,
      size: 9,
      font: this.fontBold,
      color: TEXT,
    });
    this.y -= 14;
    this.page.drawRectangle({
      x: MARGIN_L,
      y: this.y - height,
      width: CONTENT_W,
      height: height,
      borderColor: GREY_LINE,
      borderWidth: 0.5,
    });
    const tf = this.form.createTextField(fieldName);
    tf.enableMultiline();
    tf.setText("");
    tf.addToPage(this.page, {
      x: MARGIN_L + 4,
      y: this.y - height + 4,
      width: CONTENT_W - 8,
      height: height - 8,
      borderWidth: 0,
    });
    this.y -= height + 4;
  }

  /** Table header row with N column headers. */
  tableHeader(headers: string[], widths: number[]): void {
    this.ensureSpace(22);
    const ROW_H = 20;
    let x = MARGIN_L;
    for (let i = 0; i < headers.length; i++) {
      const w = widths[i]!;
      this.page.drawRectangle({
        x,
        y: this.y - ROW_H,
        width: w,
        height: ROW_H,
        color: BLUE_DARK,
      });
      this.page.drawText(headers[i]!, {
        x: x + 5,
        y: this.y - 13,
        size: 9,
        font: this.fontBold,
        color: rgb(1, 1, 1),
      });
      x += w;
    }
    this.y -= ROW_H;
  }

  /** Table data row with N text fields (one per column). The first column can
   *  be a static label rather than a field - pass null for those slots. */
  tableRow(widths: number[], fieldNames: Array<string | null>, staticLabels?: Array<string | null>, labelFirstCol = false): void {
    this.ensureSpace(22);
    const ROW_H = 20;
    let x = MARGIN_L;
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i]!;
      const isLabelCell = labelFirstCol && i === 0;
      this.page.drawRectangle({
        x,
        y: this.y - ROW_H,
        width: w,
        height: ROW_H,
        color: isLabelCell ? BLUE_LIGHT : undefined,
        borderColor: GREY_LINE,
        borderWidth: 0.5,
      });
      const staticLabel = staticLabels?.[i] ?? null;
      if (staticLabel) {
        this.page.drawText(staticLabel, {
          x: x + 5,
          y: this.y - 13,
          size: 9,
          font: isLabelCell ? this.fontBold : this.font,
          color: TEXT,
        });
      } else {
        const fieldName = fieldNames[i];
        if (fieldName) {
          const tf = this.form.createTextField(fieldName);
          tf.setText("");
          tf.addToPage(this.page, {
            x: x + 2,
            y: this.y - ROW_H + 2,
            width: w - 4,
            height: ROW_H - 4,
            borderWidth: 0,
          });
        }
      }
      x += w;
    }
    this.y -= ROW_H;
  }

  spacer(n = 8): void {
    this.y -= n;
  }
}

// ─── Build the form ──────────────────────────────────────────────────────
async function buildCam(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Credit Appraisal Memorandum (CAM)");
  pdf.setSubject("Per-Borrower Credit Appraisal Note");
  pdf.setCreator("xyne-claw credit-appraisal-agent");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();
  const c = new Cursor(pdf, form, font, fontBold);

  // ─── Cover Page ────────────────────────────────────────────────────────
  c.page.drawText("CREDIT APPRAISAL MEMORANDUM (CAM)", {
    x: MARGIN_L,
    y: c.y - 12,
    size: 16,
    font: fontBold,
    color: BLUE_DARK,
  });
  c.y -= 30;
  c.page.drawText("Corporate Credit Underwriting - Per-Borrower Appraisal Note", {
    x: MARGIN_L,
    y: c.y - 10,
    size: 10,
    font,
    color: GREY_MUTED,
  });
  c.y -= 28;

  c.labelRow("Proposal reference", "proposal_ref");
  c.labelRow("Borrower (legal name)", "borrower_legal_name");
  c.labelRow("Facility & amount", "facility_headline");
  c.labelRow("Proposal type", "proposal_type");
  c.labelRow("Prepared by", "prepared_by");
  c.labelRow("Date", "prepared_date");
  c.labelRow("Recommendation", "recommendation");
  c.labelRow("Classification", "classification");

  // ─── Section 1 - Executive Summary ─────────────────────────────────────
  c.sectionHeader("1. Executive Summary / Proposal Snapshot");
  c.labelRow("Borrower", "section1.borrower");
  c.labelRow("Constitution / Group", "section1.constitution");
  c.labelRow("Facility requested", "section1.facility_requested");
  c.labelRow("Tenor", "section1.tenor");
  c.labelRow("Purpose", "section1.purpose");
  c.labelRow("Pricing (ROI / fees)", "section1.pricing");
  c.labelRow("Primary security", "section1.primary_security");
  c.labelRow("Internal rating / score", "section1.internal_rating");
  c.labelRow("Recommendation (with conditions in §15)", "section1.recommendation");

  // ─── Section 2 - Borrower Profile ──────────────────────────────────────
  c.sectionHeader("2. Borrower Profile");
  c.labelRow("Legal name", "borrower.legal_name");
  c.labelRow("CIN", "borrower.cin");
  c.labelRow("LEI (mandatory >= Rs.5 cr)", "borrower.lei");
  c.labelRow("PAN / GSTIN", "borrower.pan_gstin");
  c.labelRow("Date of incorporation", "borrower.date_of_incorporation");
  c.labelRow("Vintage (years)", "borrower.vintage");
  c.labelRow("Registered office", "borrower.registered_office");
  c.labelRow("Line of business", "borrower.line_of_business");
  c.labelRow("Group / associate concerns", "borrower.group_concerns");
  c.multilineRow("Background (history, products, locations, scale)", "borrower.background");

  // ─── Section 3 - Facility Details ──────────────────────────────────────
  c.sectionHeader("3. Facility Details");
  c.tableHeader(
    ["Facility", "Limit (Rs. lakh)", "Tenor", "Margin / ROI"],
    [180, 130, 100, CONTENT_W - 410],
  );
  c.tableRow(
    [180, 130, 100, CONTENT_W - 410],
    [null, "facility.cc_limit", "facility.cc_tenor", "facility.cc_margin"],
    ["Cash credit / OD", null, null, null],
    true,
  );
  c.tableRow(
    [180, 130, 100, CONTENT_W - 410],
    [null, "facility.tl_limit", "facility.tl_tenor", "facility.tl_margin"],
    ["Term loan", null, null, null],
    true,
  );
  c.tableRow(
    [180, 130, 100, CONTENT_W - 410],
    [null, "facility.lcbg_limit", "facility.lcbg_tenor", "facility.lcbg_margin"],
    ["LC / BG (non-fund)", null, null, null],
    true,
  );
  c.tableRow(
    [180, 130, 100, CONTENT_W - 410],
    [null, "facility.total_exposure", null, null],
    ["Total exposure", null, null, null],
    true,
  );
  c.hint("Note: total exposure drives the LEI gate (>= Rs.5 cr) and sanctioning authority.");

  // ─── Section 4 - Means of Finance ──────────────────────────────────────
  c.sectionHeader("4. Purpose of Loan & Means of Finance");
  c.tableHeader(["Use of funds", "Rs. lakh", "Source", "Amount"], [160, 100, 160, CONTENT_W - 420]);
  c.tableRow(
    [160, 100, 160, CONTENT_W - 420],
    [null, "funds.land", null, "source.promoter"],
    ["Land & site development", null, "Promoter contribution", null],
    true,
  );
  c.tableRow(
    [160, 100, 160, CONTENT_W - 420],
    [null, "funds.plant", null, "source.bank"],
    ["Plant & machinery", null, "Bank term loan", null],
    true,
  );
  c.tableRow(
    [160, 100, 160, CONTENT_W - 420],
    [null, "funds.wc_margin", null, "source.accruals"],
    ["Working-capital margin", null, "Internal accruals", null],
    true,
  );
  c.tableRow(
    [160, 100, 160, CONTENT_W - 420],
    [null, "funds.total", null, "source.total"],
    ["Total", null, "Total", null],
    true,
  );

  // ─── Section 5 - Management ────────────────────────────────────────────
  c.sectionHeader("5. Management & Ownership");
  c.tableHeader(
    ["Name", "DIN", "Role", "Stake %", "Experience (yrs)"],
    [160, 110, 90, 70, CONTENT_W - 430],
  );
  for (let i = 1; i <= 5; i++) {
    c.tableRow(
      [160, 110, 90, 70, CONTENT_W - 430],
      [
        `management.${i}.name`,
        `management.${i}.din`,
        `management.${i}.role`,
        `management.${i}.stake`,
        `management.${i}.experience`,
      ],
    );
  }
  c.multilineRow("Shareholding pattern (promoter vs non-promoter, pledges)", "shareholding_pattern");

  // ─── Section 6 - Industry & SWOT ───────────────────────────────────────
  c.sectionHeader("6. Industry & Business Analysis");
  c.multilineRow("Sector outlook & borrower position (commentary)", "industry_commentary");
  c.multilineRow("Strengths", "swot.strengths");
  c.multilineRow("Weaknesses", "swot.weaknesses");
  c.multilineRow("Opportunities", "swot.opportunities");
  c.multilineRow("Threats", "swot.threats");

  // ─── Section 7 - Six-Pillar Check ──────────────────────────────────────
  c.sectionHeader("7. Regulatory Data Verification (Six-Pillar Check)");
  const pillarCols = [80, 290, 90, CONTENT_W - 460];
  c.tableHeader(["Pillar", "Finding", "Status", "Notes"], pillarCols);
  for (const p of ["mca", "lei", "itr", "gst", "sebi", "cersai"] as const) {
    c.tableRow(
      pillarCols,
      [null, `pillar.${p}.finding`, `pillar.${p}.status`, `pillar.${p}.notes`],
      [p.toUpperCase(), null, null, null],
      true,
    );
  }
  c.spacer(4);
  c.labelRow("GST vs ITR variance (%)", "triangulation.gst_vs_itr_pct");
  c.labelRow("MCA vs ITR consistent?", "triangulation.mca_vs_itr");
  c.labelRow("MCA charges vs CERSAI reconciled?", "triangulation.mca_vs_cersai");
  c.multilineRow("Variances explained", "triangulation.variances_explained");

  // ─── Section 8 - Financial Analysis ────────────────────────────────────
  c.sectionHeader("8. Financial Analysis (Rs. lakh)");
  const finCols = [180, (CONTENT_W - 180) / 4, (CONTENT_W - 180) / 4, (CONTENT_W - 180) / 4, (CONTENT_W - 180) / 4];
  c.tableHeader(["Particulars", "FY24", "FY25", "FY26 (A)", "FY27 (P)"], finCols);
  const finRows: Array<{ label: string; key: string }> = [
    { label: "Net revenue", key: "revenue" },
    { label: "EBITDA", key: "ebitda" },
    { label: "EBITDA margin %", key: "ebitda_pct" },
    { label: "Profit after tax", key: "pat" },
    { label: "Tangible net worth", key: "tnw" },
    { label: "Total debt", key: "debt" },
  ];
  for (const r of finRows) {
    c.tableRow(
      finCols,
      [null, `fin.fy24.${r.key}`, `fin.fy25.${r.key}`, `fin.fy26a.${r.key}`, `fin.fy27p.${r.key}`],
      [r.label, null, null, null, null],
      true,
    );
  }
  c.spacer(8);
  const ratioCols = [180, 100, 100, CONTENT_W - 380];
  c.tableHeader(["Ratio", "FY26 (A)", "FY27 (P)", "Benchmark"], ratioCols);
  const ratioRows: Array<{ label: string; key: string; bench: string }> = [
    { label: "Current ratio", key: "current", bench: ">= 1.33" },
    { label: "Debt-equity (D/E)", key: "de", bench: "<= 2.0" },
    { label: "TOL / TNW", key: "tol_tnw", bench: "<= 3.0 preferred" },
    { label: "Interest coverage", key: "icr", bench: ">= 2.0" },
    { label: "DSCR (term loan)", key: "dscr", bench: ">= 1.25 avg" },
    { label: "WC cycle (days)", key: "wc_cycle", bench: "vs industry" },
  ];
  for (const r of ratioRows) {
    const a = r.key === "dscr" ? null : `ratio.${r.key}.fy26a`;
    const p = `ratio.${r.key}.fy27p`;
    c.tableRow(
      ratioCols,
      [null, a, p, null],
      [r.label, a ? null : "-", null, r.bench],
      true,
    );
  }
  c.multilineRow("Financials commentary (trend, leverage, cash flow adequacy)", "financials.commentary");

  // ─── Section 9 - Banking & Conduct ─────────────────────────────────────
  c.sectionHeader("9. Banking Arrangement & Conduct");
  c.multilineRow("Banking arrangement (sole / multiple / consortium)", "banking_arrangement");
  c.multilineRow("Account conduct (utilisation, SMA status)", "account_conduct");
  c.multilineRow("Bureau & CRILC findings (confirm no SMA-2/NPA/wilful default)", "bureau_crilc");

  // ─── Section 10 - Security ─────────────────────────────────────────────
  c.sectionHeader("10. Security & Collateral");
  const secCols = [110, 220, 110, CONTENT_W - 440];
  c.tableHeader(["Type", "Description", "Value (Rs. lakh)", "Charge"], secCols);
  c.tableRow(
    secCols,
    [null, "security.primary.description", "security.primary.value", "security.primary.charge"],
    ["Primary", null, null, null],
    true,
  );
  c.tableRow(
    secCols,
    [null, "security.collateral.description", "security.collateral.value", "security.collateral.charge"],
    ["Collateral", null, null, null],
    true,
  );
  c.tableRow(
    secCols,
    [null, "security.guarantee.description", "security.guarantee.value", null],
    ["Guarantee", null, null, "-"],
    true,
  );
  c.labelRow("Security cover (x of exposure)", "security.cover_multiple");

  // ─── Section 11 - Risk & Mitigants ─────────────────────────────────────
  c.sectionHeader("11. Risk Assessment & Mitigants");
  c.multilineRow("Customer / sector concentration risk + mitigant", "risk.concentration");
  c.multilineRow("Margin pressure / input-cost volatility + mitigant", "risk.margin");
  c.multilineRow("Promoter / key-person dependence + mitigant", "risk.key_person");
  c.multilineRow("Collateral / enforceability + mitigant", "risk.enforceability");

  // ─── Section 12 - Scorecard ────────────────────────────────────────────
  c.sectionHeader("12. Credit Rating / Scorecard");
  const scoreCols = [180, 110, 100, CONTENT_W - 390];
  c.tableHeader(["Pillar", "Sub-score (0-100)", "Weight", "Weighted"], scoreCols);
  const pillarsAndWeights: Array<{ name: string; key: string; weight: string }> = [
    { name: "MCA - legal standing", key: "mca", weight: "15%" },
    { name: "LEI - identity / group", key: "lei", weight: "5%" },
    { name: "ITR - financial strength", key: "itr", weight: "25%" },
    { name: "GST - activity / compliance", key: "gst", weight: "20%" },
    { name: "SEBI - conduct / governance", key: "sebi", weight: "10%" },
    { name: "CERSAI - collateral", key: "cersai", weight: "25%" },
  ];
  for (const p of pillarsAndWeights) {
    c.tableRow(
      scoreCols,
      [null, `score.${p.key}`, null, `score.${p.key}_weighted`],
      [p.name, null, p.weight, null],
      true,
    );
  }
  c.spacer(4);
  c.labelRow("Composite score (/100)", "score.composite");
  c.labelRow("Grade (A / B / C / D)", "score.grade");

  // ─── Section 13 - Compliance ───────────────────────────────────────────
  c.sectionHeader("13. Compliance & Exposure");
  c.labelRow("Single / group borrower limit usage (%)", "compliance.exposure_pct");
  c.multilineRow("KYC & sanctions screening + beneficial ownership", "compliance.kyc");
  c.multilineRow("Policy deviations (each with justification & approver)", "compliance.deviations");

  // ─── Section 14 - Pricing ──────────────────────────────────────────────
  c.sectionHeader("14. Pricing & Profitability");
  c.labelRow("ROI / spread over benchmark", "pricing.roi_spread");
  c.labelRow("Fees (processing, commission)", "pricing.fees");
  c.labelRow("Indicative yield / RAROC", "pricing.raroc");
  c.labelRow("Value of total relationship", "pricing.relationship_value");

  // ─── Section 15 - Covenants ────────────────────────────────────────────
  c.sectionHeader("15. Terms, Conditions & Covenants");
  c.multilineRow("Pre-disbursement conditions", "covenants.pre_disbursement");
  c.multilineRow("Financial covenants (D/E <=, DSCR >=, CR >=)", "covenants.financial");
  c.multilineRow("Ongoing covenants (reporting, audited financials, etc.)", "covenants.ongoing");

  // ─── Section 16 - Recommendation & Sanction ────────────────────────────
  c.sectionHeader("16. Recommendation & Sanction");
  c.multilineRow("Concise recommendation + decision band + approving authority", "sanction.summary");
  c.tableHeader(["Stage", "Name & designation", "Signature", "Date"], [150, 200, 90, CONTENT_W - 440]);
  c.tableRow(
    [150, 200, 90, CONTENT_W - 440],
    [null, "sign.prepared_by_name", null, "sign.prepared_by_date"],
    ["Prepared by", null, " ", null],
    true,
  );
  c.tableRow(
    [150, 200, 90, CONTENT_W - 440],
    [null, "sign.recommended_by_name", null, "sign.recommended_by_date"],
    ["Recommended by", null, " ", null],
    true,
  );
  c.tableRow(
    [150, 200, 90, CONTENT_W - 440],
    [null, "sign.sanctioned_by_name", null, "sign.sanctioned_by_date"],
    ["Sanctioned by", null, " ", null],
    true,
  );

  return await pdf.save();
}

async function main(): Promise<void> {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error("Usage: tsx scripts/generate-cam-acroform.ts /absolute/output/path/template.pdf");
    process.exit(1);
  }
  const abs = resolve(outPath);
  const bytes = await buildCam();
  await writeFile(abs, bytes);
  console.log(`[generate-cam-acroform] Wrote ${abs} (${bytes.byteLength.toLocaleString()} bytes)`);

  // Sanity-print the field count by reloading.
  const doc = await PDFDocument.load(bytes);
  const fields = doc.getForm().getFields();
  console.log(`[generate-cam-acroform] AcroForm fields: ${fields.length}`);
  console.log(`[generate-cam-acroform] First 10 field names:`);
  for (const f of fields.slice(0, 10)) {
    const t = f.constructor.name.replace(/^PDF/, "").replace(/Field$/, "").toLowerCase();
    console.log(`  - ${f.getName()} (${t})`);
  }
}

main().catch((err) => {
  console.error("[generate-cam-acroform] failed:", err);
  process.exit(1);
});
