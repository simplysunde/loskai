// The docs, read on the forge that hosts this repo. Changes with the forge's address.
const REPO_URL = "https://github.com/simplysunde/loskai/blob/main";

// `path` from the repo root ("docs/guides/…"), so the docs check sees it.
export function docUrl(path: string): string {
  return `${REPO_URL}/${path}`;
}
