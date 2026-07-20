#!/usr/bin/env python3
"""Repair blank Cloud Run env vars by copying shared secrets from bt-booking-service.

Background: an earlier env-copy used a shell-quoted `'$1'` reader; zsh took it
literally, so every secret was written as an empty string. Cloud Run serialises
those as a key with NO `value` field -- `{"name":"JWT_SECRET"}` -- which reads as
"key is present" unless you check the value length. See issues #5 and #6.

This script is immune to that class of bug: it never builds a shell string, it
passes argv lists to subprocess directly, it refuses to run if any source value
is empty, and it picks a delimiter that provably does not occur in any value
(`@` is unsafe -- REDIS_URL is `rediss://default:PASSWORD@host`).

Usage:
    python3 scripts/ops/fix-blank-env.py payment
    python3 scripts/ops/fix-blank-env.py cargo-ledger
    python3 scripts/ops/fix-blank-env.py both --dry-run

Secrets are never printed; only key names and value lengths.
"""
import argparse
import json
import subprocess
import sys

REGION = "asia-south1"
SRC = "bt-booking-service"

# Only the keys each service actually reads from process.env and that are
# currently blank. Verified against src/ on 2026-07-20.
TARGETS = {
    "payment": (
        "bt-payment-service",
        ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "JWT_SECRET", "INTERNAL_SERVICE_SECRET"],
    ),
    "cargo-ledger": (
        "bt-cargo-ledger",
        # REDIS_URL is the hard blocker: lib/redis.ts throws at module load.
        ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "REDIS_URL", "INTERNAL_SERVICE_SECRET"],
    ),
}


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def env_of(service):
    r = run(["gcloud", "run", "services", "describe", service,
             "--region", REGION, "--format", "json"])
    if r.returncode != 0:
        sys.exit(f"ABORT: could not read {service}:\n{r.stderr}")
    spec = json.loads(r.stdout)["spec"]["template"]["spec"]["containers"][0]
    return {e["name"]: e.get("value", "") for e in spec.get("env", [])}


def pick_delimiter(values):
    """gcloud's ^X^ syntax needs a char absent from every value."""
    for candidate in "#%!~|+":
        if not any(candidate in v for v in values):
            return candidate
    sys.exit("ABORT: no safe delimiter found; set these vars one at a time.")


def fix(target, src_env, dry_run):
    service, keys = TARGETS[target]
    print(f"\n=== {service} ===")

    missing = [k for k in keys if not src_env.get(k)]
    if missing:
        print(f"  ABORT: {SRC} has no value for {missing} -- cannot copy.")
        return 2

    dst_env = env_of(service)
    for k in keys:
        state = "blank" if not dst_env.get(k) else f"already len={len(dst_env[k])}"
        print(f"  {k:28} {state:20} -> will set len={len(src_env[k])}")

    delim = pick_delimiter([src_env[k] for k in keys])
    payload = f"^{delim}^" + delim.join(f"{k}={src_env[k]}" for k in keys)

    if dry_run:
        print(f"  DRY RUN -- delimiter {delim!r}, payload {len(payload)} bytes, not applied.")
        return 0

    r = run(["gcloud", "run", "services", "update", service,
             "--region", REGION, "--update-env-vars", payload])

    def scrub(s):
        for k in keys:
            if src_env[k]:
                s = s.replace(src_env[k], f"<{k}>")
        return s

    print(scrub(r.stdout).strip())
    if r.returncode != 0:
        print(scrub(r.stderr).strip(), file=sys.stderr)
    return r.returncode


def main():
    p = argparse.ArgumentParser()
    p.add_argument("target", choices=[*TARGETS, "both"])
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()

    src_env = env_of(SRC)
    targets = list(TARGETS) if a.target == "both" else [a.target]
    rc = 0
    for t in targets:
        rc |= fix(t, src_env, a.dry_run)

    if rc == 0 and not a.dry_run:
        print("\nDone. Verify the new revision goes ready:")
        for t in targets:
            print(f"  gcloud run services describe {TARGETS[t][0]} --region {REGION} "
                  "--format='value(status.conditions[0].status)'")
    return rc


if __name__ == "__main__":
    sys.exit(main())
