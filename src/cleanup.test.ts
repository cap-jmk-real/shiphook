import { describe, expect, it } from "vitest";
import {
  buildCleanupBashCommand,
  parseCleanupTarget,
  selectDomainUnitsForCleanup,
  unitMatchesDomain,
} from "./cleanup.js";

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
    expect(cmd).toContain("systemctl cat \"$u\"");
    expect(cmd).toContain("rm -f \"/etc/systemd/system/$u\"");
    expect(cmd).toContain("systemctl reload nginx");
  });
});

describe("domain-scoped cleanup matching", () => {
  it("matches unit by domain in unit name", () => {
    const matches = unitMatchesDomain(
      "shiphook-shiphook.example.com.service",
      "[Service]\nWorkingDirectory=/srv/app\n",
      "shiphook.example.com"
    );
    expect(matches).toBe(true);
  });

  it("matches unit by fallback domain in unit content", () => {
    const matches = unitMatchesDomain(
      "shiphook-portfolio.service",
      "[Service]\nWorkingDirectory=/srv/portfolio\nEnvironment=SHIPHOOK_HOST=shiphook.example.com\n",
      "shiphook.example.com"
    );
    expect(matches).toBe(true);
  });

  it("does not match unrelated domain", () => {
    const matches = unitMatchesDomain(
      "shiphook-app2.service",
      "[Service]\nWorkingDirectory=/srv/app2\nEnvironment=SHIPHOOK_HOST=other.example.com\n",
      "shiphook.example.com"
    );
    expect(matches).toBe(false);
  });

  it("selects only target-domain units and leaves others untouched", () => {
    const selected = selectDomainUnitsForCleanup(
      [
        {
          name: "shiphook-shiphook.example.com.service",
          content: "[Service]\nWorkingDirectory=/srv/app1\n",
        },
        {
          name: "shiphook-app2.service",
          content:
            "[Service]\nWorkingDirectory=/srv/app2\nEnvironment=SHIPHOOK_HOST=other.example.com\n",
        },
        {
          name: "shiphook-app3.service",
          content:
            "[Service]\nWorkingDirectory=/srv/app3\nEnvironment=SHIPHOOK_HOST=shiphook.example.com\n",
        },
      ],
      "shiphook.example.com"
    );
    expect(selected).toEqual([
      "shiphook-shiphook.example.com.service",
      "shiphook-app3.service",
    ]);
    expect(selected).not.toContain("shiphook-app2.service");
  });
});

