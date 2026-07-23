/** Opens URLs in the user's default browser, best-effort. */
import { spawn } from "node:child_process";

/** Errors are advisory — the login flow always prints the URL too. */
export function open(url: string): boolean {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    spawn(command as string, args as string[], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return true;
  } catch {
    return false;
  }
}
