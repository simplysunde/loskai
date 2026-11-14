import { useCallback, useState } from "react";

// The hosts keys were tested on, newest first — in this browser only, a convenience like the
// theme: offered again in a host field, each forgotten on its own. One list for every
// machine, since GitHub and a Forgejo are the same wherever a key is. Storage that can't be
// read or written leaves it empty.
const KEY = "loskai-recent-hosts";
const MOST = 10;

function read(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((h): h is string => typeof h === "string").slice(0, MOST) : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not kept past this page, then.
  }
}

export function useRecentHosts() {
  const [hosts, setHosts] = useState(read);
  const remember = useCallback((host: string) => {
    const next = [host, ...read().filter((h) => h !== host)].slice(0, MOST);
    write(next);
    setHosts(next);
  }, []);
  const forget = useCallback((host: string) => {
    const next = read().filter((h) => h !== host);
    write(next);
    setHosts(next);
  }, []);
  // Read again as a field opens: another field may have added one since.
  const refresh = useCallback(() => setHosts(read()), []);
  return { hosts, remember, forget, refresh };
}
