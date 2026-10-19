- Add a one-command VPS installer and a signed GitHub webhook. The installer
  puts Node 24 in `/opt/node24`, builds the app, runs it under systemd on
  127.0.0.1:4173 and adds a Caddy site block for the public hostname without
  rewriting existing sites; the webhook rebuilds the site on a push to `main`
  (spacelibres, #2).
