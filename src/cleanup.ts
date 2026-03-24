import { spawnSync } from "node:child_process";

export type CleanupTarget =
  | { mode: "all" }
  | { mode: "domain"; domain: string };

export function parseCleanupTarget(argv: string[]): CleanupTarget | { error: string } {
  const args = argv.slice(3);
  if (args.length === 0) {
    return { error: "Missing cleanup target. Use --all or --domain <host>." };
  }

  let all = false;
  let domain = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--all") {
      all = true;
      continue;
    }
    if (a === "--domain") {
      const next = args[i + 1];
      if (!next) return { error: "Missing value for --domain." };
      domain = next.trim();
      i += 1;
      continue;
    }
    return { error: `Unknown cleanup arg: ${a}` };
  }

  if (all && domain) return { error: "Use either --all or --domain <host>, not both." };
  if (!all && !domain) return { error: "Missing cleanup target. Use --all or --domain <host>." };

  if (domain) {
    if (!/^[A-Za-z0-9.-]+$/.test(domain)) {
      return { error: "Invalid domain for --domain (allowed: letters, digits, '.', '-')." };
    }
    return { mode: "domain", domain };
  }
  return { mode: "all" };
}

export function buildCleanupBashCommand(target: CleanupTarget): string {
  const prelude = [
    "set -euo pipefail",
    "ts=$(date +%Y%m%d-%H%M%S)",
    "backup_dir=\"/etc/shiphook-cleanup-$ts\"",
    "mkdir -p \"$backup_dir\"",
    "cp -a /etc/nginx \"$backup_dir/nginx-backup\"",
  ];

  const systemdCleanup = [
    "for u in $(systemctl list-unit-files --no-legend --no-pager 2>/dev/null | awk '$1 ~ /^shiphook.*\\.service$/ {print $1}'); do",
    "  systemctl disable --now \"$u\" || true",
    "done",
    "rm -f /etc/systemd/system/shiphook*.service",
    "systemctl daemon-reload || true",
    "systemctl reset-failed || true",
  ];

  const nginxCommon = [
    "nginx -t",
    "systemctl reload nginx || service nginx reload || true",
  ];

  if (target.mode === "all") {
    const allNginx = [
      "mkdir -p \"$backup_dir/nginx-files\"",
      "for f in /etc/nginx/conf.d/shiphook*.conf /etc/nginx/sites-available/shiphook* /etc/nginx/sites-enabled/shiphook*; do",
      "  [ -e \"$f\" ] || continue",
      "  mv \"$f\" \"$backup_dir/nginx-files/\"",
      "done",
    ];
    return [...prelude, ...systemdCleanup, ...allNginx, ...nginxCommon].join("; ");
  }

  const escapedDomain = target.domain.replace(/'/g, "'\"'\"'");
  const domainCleanup = [
    "mkdir -p \"$backup_dir/domain-files\"",
    `for f in $(grep -Rls '${escapedDomain}' /etc/nginx/conf.d /etc/nginx/sites-available /etc/nginx/sites-enabled 2>/dev/null || true); do`,
    "  [ -f \"$f\" ] || continue",
    "  mv \"$f\" \"$backup_dir/domain-files/\"",
    "done",
  ];
  return [...prelude, ...systemdCleanup, ...domainCleanup, ...nginxCommon].join("; ");
}

export function runCleanup(target: CleanupTarget): boolean {
  const command = buildCleanupBashCommand(target);
  const r = spawnSync("sudo", ["bash", "-lc", command], { stdio: "inherit" });
  return r.status === 0;
}

