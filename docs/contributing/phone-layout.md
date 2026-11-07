[Docs](../README.md) › [Contributing](../README.md#contributing)

# On a phone

**Read this when** you add or change a page, a table or a dialog — it has to work at 360px
too.

Loskai has one layout, not a mobile version: each element carries its phone variant beside
its desktop classes. The breakpoint is Tailwind's `sm` (640px) — `max-sm:` is a phone, `sm:`
is anything wider. As long as each change stays behind its prefix, a desktop change can't
break the phone, nor the other way round.

## The patterns

- **The sidebar is a drawer** below `md` (768px), opened from the bar at the top
  (`Layout.tsx`), so the page gets the whole width.
- **A page's title sits above its buttons:** `flex flex-col gap-4 sm:flex-row sm:items-start
  sm:justify-between`, the buttons `flex-wrap`. Settings' categories and a machine's
  dialog's sections are a strip across the top.
- **A big dialog takes the screen:** `Modal` and a machine's dialog are full height below `sm`.
- **A table is a list of cards** — `CARD_TABLE` in `lib/ui.ts`. Each row's cells flow and
  wrap like words, so none is squeezed into a narrow column or pushed off the side. The table
  says the rest on its own elements:
  - its rows' padding, on the `tr` (`max-sm:px-4 max-sm:py-3`);
  - the cells on a line of their own (`max-sm:basis-full`) — usually the name;
  - the buttons kept right (`max-sm:ml-auto`);
  - what a phone leaves out (`max-sm:hidden`): the header row, a column only a wide screen
    has room for (Docker's uptime, CPU and memory), and an empty cell's dash, which means
    nothing without its column heading.

  A table whose header holds a control (Expand all) keeps that one cell: `max-sm:block` on
  the `thead`, `max-sm:hidden` on the other headings.
- **Buttons beside a name** go under it below `sm` (`flex-col … sm:flex-row`), or the name
  gets a minimum width (`max-sm:min-w-32`) and the buttons wrap to the next line when both
  don't fit.
- **A detail cut with an ellipsis needs another way to be read.** A phone has no hover, so
  its tooltip is out of reach. Give it a line of its own (Routing's AdGuard and Caddy rows),
  or leave it out where another section shows it (a machine's address in its dialog's
  header — General has it).

## Traps

- **`CARD_TABLE` zeroes every cell's padding on a phone,** with a descendant selector that
  outranks the cell's own classes: a cell's `max-sm:pl-…` loses. Pad the row instead — the
  `tr`'s own classes are left alone.
- **A hidden `<col>` still takes its place.** In a `table-fixed` table, `hidden` on a `col`
  leaves the column, and the next cell lands in it. Give it no width (`w-0 sm:w-36`) and hide
  the cell's content instead — the Running list does.
- **The tests can't see layout:** jsdom applies no CSS. Text hidden with `hidden sm:inline`
  is still found by `getByText` and still names its button — so an icon-only button on a
  phone needs a `title` to keep a name there.

## The rule

A new column, row button or header control decides its phone place in the same commit: a line
of its own, inline, or hidden. Left alone it still works, but wraps wherever it falls.

## Checking it

```bash
LOSKAI_USER=admin LOSKAI_PASSWORD=… make check-phone                       # :8080, make live
LOSKAI_USER=admin LOSKAI_PASSWORD=… make check-phone URL=http://127.0.0.1:8000
```

`scripts/check-phone.sh` opens each page and the main dialogs of a running Loskai at 412px
and 360px, in Playwright's Docker image — nothing is installed on the host. For each it saves
a screenshot and reports text that overlaps other text, sticks out past the screen, is cut
off without an ellipsis, or is squeezed into a sliver — a word a line, or an ellipsis left
a few letters ("jell…"). It exits non-zero when it finds any. Everything lands in
`.phone-shots/`, with contact sheets to look over.

- **Look at the sheets too.** The detector can't see a table wider than its box — that
  scrolls instead of spilling, so its last columns are only a swipe away.
- **It changes nothing** but the sign-in log, where each width's login shows. It opens
  dialogs and closes them with Escape, never confirms or saves, and leaves out the openers of
  destructive ones — so it is safe against a deployed Loskai.
- **It brings its own crowded data:** a machine's overview and what runs on it, and Check
  for updates, are answered with long made-up names. `BUSY=0` shows only what is there.
  A machine's Tools and Running sections still need one machine with SSH set up.
- **Narrow it** with `ONLY=machine-` (a regex on the step names), and add `WIDTHS="412 1280"`
  to see the desktop beside a phone.
- **A step it couldn't open is listed, not failed** — nothing to edit on an empty Routing
  tab. A step that stops opening after a change usually means a button was renamed: the
  steps find them by name, in `scripts/check-phone.mjs`.
