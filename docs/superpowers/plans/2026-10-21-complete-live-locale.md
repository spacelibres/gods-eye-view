# Complete live UI locale switching

The current switch retranslates opted-in static markup and asks nonexistent generic layer refresh methods. Runtime DOM controls, startup-built headings and cached overlay text retain the old language.

- Record English source descriptors for actual t()/tn() render results in bounded caches. Retranslate rendered UI from those descriptors, never translate arbitrary data values or edit input values.
- Bind existing and newly inserted UI text nodes and accessibility/placeholder/title attributes with a scoped MutationObserver. Preserve DOM nodes, icons, focus, form state and translate=no regions. Retranslate synchronously on locale choice and release the observer on shell teardown.
- Preserve markup fields that runtime owners replaced, rather than restoring their startup defaults. Refresh actual layer group/name presentation and cached map text without fetching layer data.
- Test runtime text/attribute and plural round trips, newly inserted content, runtime overrides, excluded/user fields, source binding and cleanup. Browser QA must switch all seven shipped locales on the same running page, inspect dynamic layer controls and menus, and retain camera/layer/form/panel state.
- Run i18n/related unit checks, build and boundary checks, increment patch and commit/push/deploy only after verification.
