// ExecutionBackend contract. Every backend is fully asynchronous: `start`
// returns a handle immediately, `output` polls a cursor, `stop` terminates. A
// long scan must never block the commander or lose its ability to be steered
// and stopped.
import type { Backend, ExecStatus, SideEffect } from '../domain/index.js'

export interface ExecRequest {
  command: string
  cwd: string
  /** Wall-clock ceiling; the backend kills the process at the deadline. */
  timeoutMs?: number
  env?: Record<string, string>
}

export interface ExecHandle {
  ref: string
  backend: Backend
  started_at: string
}

export interface OutputChunk {
  chunk: string
  cursor: number
  status: ExecStatus
  exit_code: number | null
  /** True when the buffer dropped older output because the consumer fell behind. */
  truncated: boolean
}

export interface HealthStatus {
  backend: Backend
  ok: boolean
  /** True only after a real round trip to the backend succeeded. */
  verified: boolean
  detail: string
}

export interface ExecutionBackend {
  readonly kind: Backend
  healthCheck(): Promise<HealthStatus>
  start(request: ExecRequest): Promise<ExecHandle>
  output(ref: string, cursor: number): Promise<OutputChunk>
  stop(ref: string): Promise<void>
}

/** Action classes the policy layer understands. Unknown commands fall back to `unknown`. */
export const ACTION_CLASSES = [
  'scan',
  'read',
  'fetch',
  'write',
  'credential',
  'exploit',
  'submit',
  'unknown'
] as const
export type ActionClass = (typeof ACTION_CLASSES)[number]

const RULES: { action: ActionClass; effect: SideEffect; pattern: RegExp }[] = [
  { action: 'scan', effect: 'read', pattern: /\b(nmap|masscan|nikto|whatweb|rustscan|gobuster|ffuf|dirb|feroxbuster)\b/i },
  { action: 'credential', effect: 'write', pattern: /\b(hydra|medusa|john|hashcat|crackmapexec|secretsdump|kerberoast)\b/i },
  { action: 'exploit', effect: 'write', pattern: /\b(msfconsole|metasploit|sqlmap|nuclei|searchsploit|msfvenom|psexec)\b/i },
  { action: 'fetch', effect: 'read', pattern: /\b(curl|wget|iwr|invoke-webrequest|http)\b/i },
  { action: 'write', effect: 'write', pattern: /(^|\s)(>|>>|tee\b|set-content\b|out-file\b|rm\b|del\b|remove-item)/i },
  { action: 'read', effect: 'read', pattern: /\b(type|cat|dir|ls|get-childitem|findstr|select-string|whoami|ipconfig|systeminfo|ping|echo|printf|nslookup|dig)\b/i },
  { action: 'submit', effect: 'write', pattern: /\b(git push|gh pr|npm publish|scp|rsync)\b/i }
]

export interface Classification {
  action: ActionClass
  side_effect: SideEffect
  requires_confirm: boolean
  reason: string
}

/**
 * Classify one command deterministically. Anything unrecognised is `unknown`
 * plus confirm-required: an unclassifiable action must never inherit the
 * permissive default of a read-only probe.
 */
export function classifyCommand(command: string): Classification {
  const text = command.trim()
  if (text === '') {
    return { action: 'unknown', side_effect: 'unknown', requires_confirm: true, reason: 'empty command' }
  }
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      const destructive = rule.effect === 'write'
      return {
        action: rule.action,
        side_effect: rule.effect,
        requires_confirm: destructive || rule.action === 'unknown',
        reason: `matched ${rule.action}`
      }
    }
  }
  return {
    action: 'unknown',
    side_effect: 'unknown',
    requires_confirm: true,
    reason: 'no policy class matched; defaulting to confirm'
  }
}
