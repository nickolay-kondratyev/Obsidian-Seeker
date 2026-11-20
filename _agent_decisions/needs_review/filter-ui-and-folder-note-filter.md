# Filter menu from the search icon + folder-note filter — planning decisions

Tickets: `nid_pse843v9nyfby1bp9arliem22_e` (folder-note filter), then
`nid_il90ju34g89e14fhf18ms7h28_e` (filter menu; depends on the first). Tag `filter-ui`.

1. **The menu is a builder over the existing query syntax, not a second filter model.**
   Picking a menu row yields the same pills/tokens the user could type. The query
   string stays the only source of truth, so deep links, recents, logging and
   `parseQuery` need no change.

2. **The menu reuses the query field's own suggestion dropdown, not Obsidian's `Menu`.**
   The dropdown already does "operator chosen -> pick a value -> pill", is keyboard
   navigable, keeps focus in the text field and works on mobile. A native `Menu`
   would take focus from the contenteditable field (caret/keyboard-dismiss bugs this
   file has a long history of), and the value step would then appear in a different
   place than the first step. Cost of this choice: no native icons/checkmarks.
   Checked against `src/query-field.ts` in ticket review: the dropdown already
   keeps focus (`mousedown` preventDefault on the list and on the icon's row) and
   the value step keys off the text in the field, so a menu pick only has to add
   an operator token. New work is small: an icon-opened menu state, and arrow keys
   that act on it straight away.

3. **Menu rows show plain language first, the syntax second** ("Tag" + `tag:`), so
   people who do not know the syntax can use it and pick it up as they go.

4. **The search icon keeps its glyph and its "model loading" dimming**, and gains a
   hover state + tooltip ("Add filter"). The human asked for the search icon
   specifically; a magnifier does not obviously say "filters", so the tooltip
   carries that. Alternative if discoverability proves weak: a filter glyph.

5. **Token: `is:folder-note`.** Follows the `op:value` shape of the other filters and
   the familiar GitHub/Gmail `is:` convention; leaves room for other `is:` values
   without a new operator each time. Known cost: typing the plain word "is" shows a
   passive `is:` operator hint (same as "be" -> `before:` today; Enter/arrows are
   not hijacked). Unknown values (`is:banana`) stay plain text.

6. **Folder note = file name (minus last extension) equals the IMMEDIATE parent
   folder name**, note INSIDE the folder only (`Projects/Alpha/Alpha.md`), per the
   human's explicit requirement. Decided details:
   - Case-insensitive (`alpha/Alpha.md` counts) — matches `path:` matching and
     case-insensitive file systems.
   - Vault-root files never count.
   - `.md`, `.canvas`, `.base` count; images do not (`Alpha/Alpha.png`).
   - ANDs with every other filter; alone it lists folder notes newest first.
   - Computed from the path at query time: no index change, no reindex.

7. **Not doing:** note-beside-folder style, reading the Folder Notes plugin config,
   custom names like `index.md`, negated `-is:folder-note`, editing pills via the menu.
