// Theme toggle. The UI is authored dark (components use the slate scale directly); a
// light theme is delivered by remapping `--color-slate-*` under `html.light` in
// index.css — so switching is just toggling that one class, no component changes.

export type Theme = "dark" | "light";

const KEY = "loskai-theme";

export function getTheme(): Theme {
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("light", theme === "light");
  // The brand's tokens pick their dark or light set by this, not by the system's.
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

// The look: Loskai's own, or the Simply Sunde brand's (`html.brand` in index.css — its
// palette, fonts and square corners, in either theme).
export type Look = "loskai" | "simplysunde";

const LOOK_KEY = "loskai-look";

export function getLook(): Look {
  return localStorage.getItem(LOOK_KEY) === "simplysunde" ? "simplysunde" : "loskai";
}

export function applyLook(look: Look): void {
  document.documentElement.classList.toggle("brand", look === "simplysunde");
}

export function setLook(look: Look): void {
  localStorage.setItem(LOOK_KEY, look);
  applyLook(look);
}
