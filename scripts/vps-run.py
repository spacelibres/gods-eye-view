#!/usr/bin/env python3
"""Run a local shell script on the VPS through a password login.

    GEV_VPS_PASSWORD='...' python3 scripts/vps-run.py <local-script> [args...]

This machine has no sshpass and the host has no key for us yet, so scp and
ssh are driven with pexpect. vps-deploy.py installs a key, after which plain
ssh works and this helper is only needed for the probe runs.
"""
import os
import shlex
import sys

import pexpect

HOST = os.environ.get("GEV_VPS_HOST", "176.122.169.165")
PORT = os.environ.get("GEV_VPS_PORT", "22")
USER = os.environ.get("GEV_VPS_USER", "root")
PASSWORD = os.environ.get("GEV_VPS_PASSWORD")

if len(sys.argv) < 2:
    sys.exit("usage: vps-run.py <local-script> [args...]")
if not PASSWORD:
    sys.exit("GEV_VPS_PASSWORD is not set")

local_script = sys.argv[1]
remote_name = "/tmp/gev-run.sh"
remote_args = " ".join(shlex.quote(arg) for arg in sys.argv[2:])

COMMON = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "PreferredAuthentications=password",
    "-o", "PubkeyAuthentication=no",
    "-o", "LogLevel=ERROR",
]


def answer_password(child, echo):
    index = child.expect_exact(["password:", pexpect.EOF, pexpect.TIMEOUT])
    if index != 0:
        child.close()
        raise SystemExit("SSH asked for something other than a password")
    child.sendline(PASSWORD)
    if echo:
        child.logfile_read = sys.stdout


# 1. Copy the script up.
scp = pexpect.spawn(
    "scp",
    ["-P", PORT] + COMMON + [local_script, f"{USER}@{HOST}:{remote_name}"],
    timeout=120,
    encoding="utf-8",
    codec_errors="replace",
)
answer_password(scp, echo=False)
scp.expect(pexpect.EOF)
scp.close()
if scp.exitstatus:
    raise SystemExit(f"upload failed with {scp.exitstatus}")

# 2. Run it through a login shell so installed toolchains are on PATH.
command = (
    f"chmod +x {remote_name} && bash -lc 'bash {remote_name} {remote_args}'; "
    f"rc=$?; rm -f {remote_name}; exit $rc"
)
ssh = pexpect.spawn(
    "ssh",
    ["-p", PORT] + COMMON + [f"{USER}@{HOST}", command],
    timeout=1800,
    encoding="utf-8",
    codec_errors="replace",
    dimensions=(60, 220),
)
answer_password(ssh, echo=True)
ssh.expect(pexpect.EOF)
ssh.close()
sys.exit(ssh.exitstatus or 0)
