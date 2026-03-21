import { describe, it, expect } from "vitest";
import { sanitizeDeployLogIdSuffix } from "./deploy-logs.js";

describe("sanitizeDeployLogIdSuffix", () => {
  it("keeps UUID-shaped suffixes", () => {
    const u = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(sanitizeDeployLogIdSuffix(u)).toBe(u);
  });

  it("strips path segments and parent-dir tricks", () => {
    expect(sanitizeDeployLogIdSuffix("../../../etc/passwd")).toBe("etcpasswd");
    expect(sanitizeDeployLogIdSuffix("a/b\\c")).toBe("abc");
  });

  it("returns empty for all-invalid input so caller can fall back to UUID", () => {
    expect(sanitizeDeployLogIdSuffix("..../..../")).toBe("");
    expect(sanitizeDeployLogIdSuffix("///")).toBe("");
  });

  it("truncates long safe strings", () => {
    const long = "a".repeat(200);
    expect(sanitizeDeployLogIdSuffix(long).length).toBe(128);
  });
});
