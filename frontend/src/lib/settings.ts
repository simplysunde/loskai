// The shape of GET /api/settings: every configurable key, each tagged with where its
// value came from (backend `shared/settings.py`). It lives here rather than beside a
// form component because four surfaces read the same ["settings"] query — the two
// settings categories, the Routing page, and the Add route modal — and one cache entry
// should have exactly one type (same pattern as useHealth).
export interface SettingField {
  value: string | null;
  source: "env" | "stored" | "unset";
  secret: boolean;
}

export type SettingsView = Record<string, SettingField>;

// The install wizard's git sources — `recipes_repos`, the one configurable key whose
// value is a list rather than a string (backend `shared/settings.recipe_sources`). Each
// entry is independently enabled; `builtin` marks the shipped default, which can be
// switched off or removed but is labelled while it is there.
export interface RecipeSource {
  url: string;
  enabled: boolean;
  name?: string | null;
  builtin?: boolean;
}

// One cast, here, with the reason: `recipes_repos` cannot ride the `string | null` shape
// the form fields share, and widening `SettingField` would push the narrowing onto every
// caller of the four surfaces that read this query.
export function recipeSources(view?: SettingsView): RecipeSource[] {
  return (view?.recipes_repos?.value as unknown as RecipeSource[] | null) ?? [];
}

// How a settings key is presented in a form. `hint` becomes the input placeholder;
// `options` turns the field into a select (a fixed set the backend also validates, so a
// free-text box could only ever produce a 422).
export interface FieldDef {
  key: string;
  label: string;
  hint?: string;
  options?: { value: string; label: string }[];
}
