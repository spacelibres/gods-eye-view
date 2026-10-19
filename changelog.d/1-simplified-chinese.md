- Ship the interface in Simplified Chinese (`zh-CN`), complete at 2623
  messages, with a translator glossary in `docs/translations/zh-CN.md`. The
  language picker finds it automatically from the browser or `?lang=zh-CN`.
  A single locale registry now drives the shipped list, and language tags with
  a region resolve in order: exact tag, then bare code, then the browser's
  region (spacelibres, #1).
