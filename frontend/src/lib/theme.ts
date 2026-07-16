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
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}
