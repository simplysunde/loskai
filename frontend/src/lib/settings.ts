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

// How a settings key is presented in a form. `hint` becomes the input placeholder.
export interface FieldDef {
  key: string;
  label: string;
  hint?: string;
}
