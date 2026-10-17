import { describe, it, expect } from "vitest";
import { buildLabelModifications, resolveDriveFileId } from "./drive.js";

describe("buildLabelModifications", () => {
  it("maps each field value type to the Drive API shape", () => {
    expect(
      buildLabelModifications([
        {
          labelId: "L1",
          fields: [
            { fieldId: "sel", selectionChoiceIds: ["c1"] },
            { fieldId: "txt", text: ["hello"] },
            { fieldId: "num", integer: [5] },
            { fieldId: "dt", date: ["2026-10-15"] },
            { fieldId: "usr", userEmails: ["a@b.com"] },
            { fieldId: "clr", unset: true },
          ],
        },
      ]),
    ).toEqual({
      labelModifications: [
        {
          labelId: "L1",
          fieldModifications: [
            { fieldId: "sel", setSelectionValues: ["c1"] },
            { fieldId: "txt", setTextValues: ["hello"] },
            { fieldId: "num", setIntegerValues: ["5"] },
            { fieldId: "dt", setDateValues: [{ year: 2026, month: 10, day: 15 }] },
            { fieldId: "usr", setUserValues: ["a@b.com"] },
            { fieldId: "clr", unsetValues: true },
          ],
        },
      ],
    });
  });

  it("supports applying a label with no fields and removing a label", () => {
    expect(buildLabelModifications([{ labelId: "A" }, { labelId: "B", removeLabel: true }])).toEqual({
      labelModifications: [{ labelId: "A" }, { labelId: "B", removeLabel: true }],
    });
  });

  it("rejects empty changes, missing values and bad dates", () => {
    expect(() => buildLabelModifications([])).toThrow();
    expect(() => buildLabelModifications([{ labelId: "A", fields: [{ fieldId: "f" }] }])).toThrow(/provide a value/);
    expect(() => buildLabelModifications([{ labelId: "A", fields: [{ fieldId: "f", date: ["15/10/2026"] }] }])).toThrow(/YYYY-MM-DD/);
  });
});

describe("resolveDriveFileId", () => {
  it("extracts IDs from Drive URLs", () => {
    expect(resolveDriveFileId("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz");
    expect(resolveDriveFileId("1AbCdEfGhIjKlMnOpQrStUvWxYz")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz");
  });
});
