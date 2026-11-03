// Untrusted-content handling. Everything that originates from a target, a tool
// output, a file or an event body is DATA. It is always wrapped in an explicit
// boundary and stripped of control characters before it can reach a prompt, a
// UI node or a log line, so it can never read as an instruction.
const WRAP_OPEN = '<<UNTRUSTED_DATA>>'
const WRAP_CLOSE = '<<END_UNTRUSTED_DATA>>'

/** Remove C0/C1 control characters (except newline/tab) and Unicode bidi overrides. */
export function stripControl(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
}

/** Collapse to a single line and cap the length (titles, log lines). */
export function oneLine(text: string, max = 200): string {
  const flat = stripControl(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Wrap untrusted text so a reader (model or human) sees the exact boundary. */
export function wrapUntrusted(text: string): string {
  const body = stripControl(text).split(WRAP_CLOSE).join('[escaped close marker]')
  return `${WRAP_OPEN}\n${body}\n${WRAP_CLOSE}`
}

/** Escape text for safe insertion into an HTML string (client views). */
export function escapeHtml(text: string): string {
  return stripControl(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Whether text carries instruction-looking markers that deserve an explicit warning. */
export function looksImperative(text: string): boolean {
  return /(ignore (all|previous)|system prompt|you are now|disregard|execute the following)/i.test(text)
}

/** Redact credential-shaped values from anything that will be persisted or rendered. */
export function redactSecrets(text: string): string {
  return stripControl(text)
    .replace(/\b(sk-[A-Za-z0-9]{12,})\b/g, '[redacted-key]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi, '$1[redacted]')
    .replace(/\b(password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
}
