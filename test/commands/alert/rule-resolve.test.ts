import { describe, expect, test } from "vitest";

import { parseIssueRuleArg } from "../../../src/commands/alert/issues/rule-resolve.js";
import { parseMetricRuleArg } from "../../../src/commands/alert/metrics/rule-resolve.js";
import { ValidationError } from "../../../src/lib/errors.js";

const HINT = "sentry alert <type> view <target>";

describe("parseIssueRuleArg", () => {
  test("empty string throws ValidationError", () => {
    expect(() => parseIssueRuleArg("", HINT)).toThrow(ValidationError);
  });

  test("bare name returns ref with no targetArg", () => {
    expect(parseIssueRuleArg("my-rule", HINT)).toEqual({
      ref: "my-rule",
      targetArg: undefined,
    });
  });

  test("bare numeric returns ref with no targetArg", () => {
    expect(parseIssueRuleArg("42", HINT)).toEqual({
      ref: "42",
      targetArg: undefined,
    });
  });

  test("single slash throws ValidationError (missing rule)", () => {
    expect(() => parseIssueRuleArg("org/project", HINT)).toThrow(
      ValidationError
    );
  });

  test("two slashes parses org/project and rule ref", () => {
    expect(parseIssueRuleArg("org/project/42", HINT)).toEqual({
      ref: "42",
      targetArg: "org/project",
    });
  });

  test("name with spaces after two slashes", () => {
    expect(parseIssueRuleArg("org/project/My Rule Name", HINT)).toEqual({
      ref: "My Rule Name",
      targetArg: "org/project",
    });
  });

  test("trailing slash after two slashes throws ValidationError", () => {
    expect(() => parseIssueRuleArg("org/project/", HINT)).toThrow(
      ValidationError
    );
  });

  test("whitespace is trimmed", () => {
    expect(parseIssueRuleArg("  org/project/42  ", HINT)).toEqual({
      ref: "42",
      targetArg: "org/project",
    });
  });
});

describe("parseMetricRuleArg", () => {
  test("empty string throws ValidationError", () => {
    expect(() => parseMetricRuleArg("", HINT)).toThrow(ValidationError);
  });

  test("bare name returns ref with no targetArg", () => {
    expect(parseMetricRuleArg("my-rule", HINT)).toEqual({
      ref: "my-rule",
      targetArg: undefined,
    });
  });

  test("single slash parses org and rule ref", () => {
    expect(parseMetricRuleArg("org/42", HINT)).toEqual({
      ref: "42",
      targetArg: "org/",
    });
  });

  test("single slash with name ref", () => {
    expect(parseMetricRuleArg("org/Rule Name", HINT)).toEqual({
      ref: "Rule Name",
      targetArg: "org/",
    });
  });

  test("trailing slash throws ValidationError (missing rule ref)", () => {
    expect(() => parseMetricRuleArg("org/", HINT)).toThrow(ValidationError);
  });

  test("bare org with slash but no ref throws", () => {
    expect(() => parseMetricRuleArg("my-org/", HINT)).toThrow(ValidationError);
  });

  test("two slashes (org/project/rule) throws — metric alerts are org-scoped", () => {
    expect(() => parseMetricRuleArg("org/project/42", HINT)).toThrow(
      ValidationError
    );
  });
});
