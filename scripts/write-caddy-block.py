#!/usr/bin/env python3
"""Write the managed Caddy site block for a God's Eye View deployment.

    write-caddy-block.py CADDYFILE BEGIN END DOMAIN PORTS HOOK_PORT HOOK_PATH

`PORTS` is a comma-separated list of deploy-slot ports: `4174` for the steady
state, `4173,4174` while both slots are meant to answer.

Everything outside the two marker comments is preserved byte for byte, so a
host with other sites keeps them untouched. Only one slot runs between deploys,
so the app handler normally upstreams one port; `lb_try_duration` still rides
out the short restart of that single process.
"""

import re
import sys

TEMPLATE = """{begin}
{domain} {{
\tencode zstd gzip

\t# Caddy's forwarding headers are kept: the app runs behind this proxy and
\t# reads X-Forwarded-Proto to know the visitor's scheme (see GEV_TRUSTED_PROXY
\t# on the service), because the hop to 127.0.0.1 is always plain HTTP.
\t# GitHub pushes land here; everything else is the app.
\thandle {hook_path}* {{
\t\treverse_proxy 127.0.0.1:{hook_port} {{
\t\t}}
\t}}

\thandle {{
{comment}
\t\treverse_proxy {upstreams} {{
\t\t\tlb_try_duration 5s
\t\t\thealth_uri /
\t\t\thealth_interval 2s
\t\t\thealth_timeout 1s
\t\t}}
\t}}
}}
{end}
"""

SINGLE_COMMENT = """\t\t# One serving slot: a deploy starts the new release on the idle port,
\t\t# switches this block to it, and only then stops the old one, so the
\t\t# switch never leaves zero upstreams."""

MULTI_COMMENT = """\t\t# Both deploy slots, health-checked while a deploy hands traffic over
\t\t# from one to the other."""


def main(argv):
    if len(argv) != 8:
        sys.stderr.write(__doc__)
        return 2
    path, begin, end, domain, ports, hook_port, hook_path = argv[1:8]

    upstreams = [part.strip() for part in ports.split(",") if part.strip()]
    if not upstreams or any(not re.fullmatch(r"\d{1,5}", port) for port in upstreams):
        sys.stderr.write("PORTS must be one port or a comma-separated list of ports\n")
        return 2

    with open(path, encoding="utf-8", newline="") as handle:
        text = handle.read()

    # Drop the previous managed block, wherever it sits, then append the new
    # one at the end.
    pattern = re.compile(re.escape(begin) + r".*?" + re.escape(end) + r"(?:\r?\n)?", re.S)
    text = pattern.sub("", text)
    if text and not text.endswith(("\n", "\r")):
        text += "\n"
    text += TEMPLATE.format(
        begin=begin,
        end=end,
        domain=domain,
        upstreams=" ".join(f"127.0.0.1:{port}" for port in upstreams),
        comment=SINGLE_COMMENT if len(upstreams) == 1 else MULTI_COMMENT,
        hook_port=hook_port,
        hook_path=hook_path,
    )

    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
