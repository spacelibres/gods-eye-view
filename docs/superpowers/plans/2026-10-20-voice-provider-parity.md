# Voice provider control parity

Goal: give Qwen voice and Doubao voice the same application tools as OpenAI.
The user selected Qwen for Doubao tool decisions, retaining Doubao ASR/TTS.

- [x] Share server-owned instructions and the complete standalone tool catalog.
- [x] Configure Qwen realtime tools and expose its socket through the existing
  controller channel so tool outputs, follow-up turns, context and text work.
- [x] Adapt Doubao ASR into Qwen tool decisions through a bounded same-site
  server endpoint. Use the existing action executor and results; play only
  externally supplied TTS, never the vendor's unexecuted chat confirmations.
- [x] Test navigation/layer/control execution, result feedback, cancellation,
  credential isolation and browser-compatible transports before implementation.
- [x] Verify voice tests, build, format, i18n and boundaries. Record existing
  baseline failures. Update runtime docs, bump patch, commit and push to GitHub.

Keep keys server-side. No new OpenAI dependency. Both websocket transports use
same-origin relays because browsers cannot attach Authorization headers.
Official references: Alibaba Qwen Function Calling and realtime docs; Volcengine
end-to-end realtime API, ChatTTSText (500), ASRResponse and TTSSentenceStart.


Validation: 621 focused voice/provider/relay tests pass, production build,
format, i18n and import/package boundaries pass. The real-app browser fixture
checks Qwen native calls and Doubao ASR/typed commands with actual panel actions.
Full-suite attempts retain the six documented baseline failures and intermittent
resource/timing failures under concurrency; allocation groups pass. Earlier
track gate retains its documented external-provider and stale-readout failures.
Live cloud calls remain unverified because no vendor credentials are configured.
