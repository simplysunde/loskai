// The class strings every form shares, so a text field looks the same on every page.
export const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500";

// A table that is a list of cards on a phone: each row's cells flow and wrap like words, so
// none is squeezed into a narrow column or pushed off the side. Each table says the rest on
// its own elements: its rows' padding, the cells on a line of their own
// (`max-sm:basis-full`), the buttons kept right (`max-sm:ml-auto`), and what a phone doesn't
// show (`max-sm:hidden` — the header row, a column only a wide screen has room for).
export const CARD_TABLE =
  "max-sm:block max-sm:[&_tbody]:block max-sm:[&_tr]:flex max-sm:[&_tr]:flex-wrap max-sm:[&_tr]:items-center max-sm:[&_tr]:gap-x-3 max-sm:[&_tr]:gap-y-1 max-sm:[&_td]:p-0 max-sm:[&_th]:p-0";
