// The Docker host's address, as far as the browser can tell: the address the setup page was
// opened on, when that is a LAN IP. A name (or this machine itself) says nothing about it.
export function hostFromAddress(hostname: string): string {
  const ip = /^(\d{1,3})(\.\d{1,3}){3}$/.test(hostname);
  return ip && !hostname.startsWith("127.") && hostname !== "0.0.0.0" ? hostname : "";
}
