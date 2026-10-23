// The docs, read on the forge that hosts this repo. Changes with the forge's address.
const REPO_URL = "http://192.168.10.216:3000/sunde/loskai/src/branch/main";

// `path` from the repo root ("docs/guides/…"), so the docs check sees it.
export function docUrl(path: string): string {
  return `${REPO_URL}/${path}`;
}
