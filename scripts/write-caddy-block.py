#!/usr/bin/env python3
"""Write the managed Caddy site block for a God's Eye View deployment.

    write-caddy-block.py CADDYFILE BEGIN END DOMAIN PORT_A PORT_B HOOK_PORT HOOK_PATH

Everything outside the two marker comments is preserved byte for byte, so a
host with other sites keeps them untouched. The app handler upstreams BOTH
deploy slots: Caddy health-checks each one and retries the other while one is
restarting, which is what lets a deploy swap slots without an outage.
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
\t\t# Both deploy slots, health-checked. A deploy starts the new release on
\t\t# the idle slot; Caddy begins sending to it as soon as it answers and keeps
\t\t# the old one in rotation until then, so the switch never leaves zero
\t\t# upstreams. `lb_try_duration` retries the other slot when one is
\t\t# mid-restart, which is what makes a single missed probe invisible to a
\t\t# visitor.
\t\treverse_proxy 127.0.0.1:{port} 127.0.0.1:{port_b} {{
\t\t\tlb_try_duration 5s
\t\t\thealth_uri /
\t\t\thealth_interval 2s
\t\t\thealth_timeout 1s
\t\t}}
\t}}
}}
{end}
"""


def main(argv):
    if len(argv) != 9:
        sys.stderr.write(__doc__)
        return 2
    path, begin, end, domain, port, port_b, hook_port, hook_path = argv[1:9]

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
        port=port,
        port_b=port_b,
        hook_port=hook_port,
        hook_path=hook_path,
    )

    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
