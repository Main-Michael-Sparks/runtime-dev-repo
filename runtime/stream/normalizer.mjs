export function normalizeToken(token, config) {
  let out = typeof token === "string" ? token : String(token);

  if (config.stream.enableAnsiCleanup) {
    // Strip actual terminal escape/control sequences only.
    // This does NOT remove normal code text like "\x1b[31m" because
    // that is plain printable characters, not an actual ESC byte.
    out = out
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  }

  return out;
}
