import { test, expect } from "vitest";
import {
  connectorTypesFromText,
  connectorTypesUserAskedFor,
  wantsConnectorRoster,
} from "./connector-hints.js";

test("wantsConnectorRoster catches browse phrasings the model used to own", () => {
  expect(wantsConnectorRoster("list down all the connectors")).toBe(true);
  expect(wantsConnectorRoster("what connectors are available")).toBe(true);
  expect(wantsConnectorRoster("show me all mcps")).toBe(true);
  expect(wantsConnectorRoster("which integrations do you support")).toBe(true);
});

test("wantsConnectorRoster stays false when a specific connector is named", () => {
  expect(wantsConnectorRoster("show me the google connector")).toBe(false);
  expect(wantsConnectorRoster("connect the notion integration")).toBe(false);
});

test("wantsConnectorRoster stays false for ordinary tasks", () => {
  expect(wantsConnectorRoster("summarize this doc for me")).toBe(false);
  expect(wantsConnectorRoster("")).toBe(false);
});

test("connectors added to the hint table are inferrable by name and domain", () => {
  expect(connectorTypesFromText("read this article from reddit", { includeKeywords: true })).toContain("reddit");
  expect(connectorTypesFromText("https://www.reddit.com/r/programming/comments/x", {})).toContain("reddit");
  expect(connectorTypesFromText("check this sentry issue", { includeKeywords: true })).toContain("sentry");
  expect(connectorTypesFromText("is jenkins failing", { includeKeywords: true })).toContain("jenkins");
});

test("naming a connector still reads as an explicit ask, not a roster", () => {
  expect(connectorTypesUserAskedFor("connect google")).toContain("google");
  expect(connectorTypesUserAskedFor("show me the google connector")).toContain("google");
  expect(connectorTypesUserAskedFor("summarize this google doc")).toEqual([]);
});
