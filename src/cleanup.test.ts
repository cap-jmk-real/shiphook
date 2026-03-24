import { describe, expect, it } from "vitest";
import { buildCleanupBashCommand, parseCleanupTarget } from "./cleanup.js";

describe("cleanup CLI args", () => {
  it("parses --all target", () => {
    const parsed = parseCleanupTarget(["node", "shiphook", "cleanup", "--all"]);
    expect(parsed).toEqual({ mode: "all" });
  });

  it("parses --domain target", () => {
    const parsed = parseCleanupTarget([
      "node",
      "shiphook",
      "cleanup",
      "--domain",
      "shiphook.example.com",
    ]);
    expect(parsed).toEqual({ mode: "domain", domain: "shiphook.example.com" });
  });

  it("rejects unknown args", () => {
    const parsed = parseCleanupTarget(["node", "shiphook", "cleanup", "--wat"]);
    expect("error" in parsed && parsed.error).toContain("Unknown cleanup arg");
  });

  it("rejects invalid domain", () => {
    const parsed = parseCleanupTarget([
      "node",
      "shiphook",
      "cleanup",
      "--domain",
      "bad/domain",
    ]);
    expect("error" in parsed && parsed.error).toContain("Invalid domain");
  });

  it("rejects mixing --all and --domain", () => {
    const parsed = parseCleanupTarget([
      "node",
      "shiphook",
      "cleanup",
      "--all",
      "--domain",
      "shiphook.example.com",
    ]);
    expect("error" in parsed && parsed.error).toContain("either --all or --domain");
  });
});

describe("cleanup command builder", () => {
  it("builds all-domains cleanup command with shiphook globs", () => {
    const cmd = buildCleanupBashCommand({ mode: "all" });
    expect(cmd).toContain("/etc/nginx/conf.d/shiphook*.conf");
    expect(cmd).toContain("/etc/systemd/system/shiphook*.service");
    expect(cmd).toContain("nginx -t");
  });

  it("builds domain cleanup command with domain grep", () => {
    const cmd = buildCleanupBashCommand({ mode: "domain", domain: "shiphook.example.com" });
    expect(cmd).toContain("grep -Rls 'shiphook.example.com'");
    expect(cmd).toContain("/etc/systemd/system/shiphook*.service");
    expect(cmd).toContain("systemctl reload nginx");
  });
});

