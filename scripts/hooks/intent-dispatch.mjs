#!/usr/bin/env node
// Shared Intent hook dispatcher. Registered once per agent at the repository layer:
//
//   .codex/hooks.json      -> node scripts/hooks/intent-dispatch.mjs --agent codex
//   .claude/settings.json  -> node scripts/hooks/intent-dispatch.mjs --agent claude
//
// Why this exists: the Intent gate is frontend guidance, but the hook registrations are repository
// layer files. Without a dispatcher, every session in the repository — including workflow JSON and
// SQL edits — would receive the TanStack skill catalog and could be denied on an edit that has
// nothing to do with the frontend.
//
// Scope rules:
//   SessionStart  delegate only when the session starts inside frontend/; otherwise emit a one-line
//                 pointer so a later frontend edit is not denied in a session with no catalog
//   edit tools    delegate only when an affected path is inside frontend/
//   other tools   delegate always, so an `intent load` run from any directory is still recorded
//                 and a later frontend edit is not denied for a check that did happen
//
// Fail-open by design: a missing gate file, unreadable event, unknown agent, or child failure
// exits 0 without emitting a decision. A hook that blocks work because its own path is wrong is
// worse than a hook that stays quiet.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const GATES = {
  claude: 'frontend/.intent/hooks/intent-claude-gate.mjs',
  codex: 'frontend/.intent/hooks/intent-codex-gate.mjs',
}

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'apply_patch'])

const RELEVANT_ROOT = 'frontend'

try {
  main()
} catch {
  // A hook that throws must not take the tool call down with it.
}

process.exit(0)

function main() {
  const agent = agentFromArgv(process.argv.slice(2))
  const gateRelative = agent ? GATES[agent] : undefined
  if (!gateRelative) return

  const raw = readStdin()
  const event = parseEvent(raw)
  const root = findRepoRoot(typeof event?.cwd === 'string' ? event.cwd : process.cwd())
  if (!root) return

  const gate = join(root, gateRelative)
  if (!existsSync(gate)) return

  if (!inScope(event, root)) {
    // A repository-rooted session still gets told that frontend guidance exists and where. Without
    // this the PreToolUse gate would deny a frontend edit in a session that never saw a catalog.
    if (eventName(event) === 'SessionStart') announceFrontendScope()
    return
  }

  forward(gate, raw)
}

function announceFrontendScope() {
  const pointer = [
    `TanStack Intent skills exist for ${RELEVANT_ROOT}/ in this repository; this session is not scoped to it,`,
    `so no catalog is injected and no edit outside ${RELEVANT_ROOT}/ is gated.`,
    `If the task touches ${RELEVANT_ROOT}/, load the matching skill first: npm exec --no -- intent load <package>#<skill>.`,
    `Entry point: ${RELEVANT_ROOT}/AGENTS.md.`,
  ].join('\n')
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: pointer } }),
  )
}

function agentFromArgv(argv) {
  const index = argv.indexOf('--agent')
  if (index === -1) return undefined
  const value = argv[index + 1]
  return typeof value === 'string' && Object.hasOwn(GATES, value) ? value : undefined
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function parseEvent(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// Walk up until a directory owns a .git entry. Hooks must work from a subdirectory: Codex and
// Claude can both be started anywhere inside the repository, and a cwd-relative path would then
// point at nothing.
function findRepoRoot(start) {
  let dir = resolve(start)
  let previous
  while (dir !== previous) {
    if (existsSync(join(dir, '.git'))) return dir
    previous = dir
    dir = dirname(dir)
  }
  return undefined
}

function isInside(candidate, parent) {
  const rel = relative(parent, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function eventName(event) {
  return event?.hook_event_name ?? event?.hookEventName
}

function toolNameOf(event) {
  return event?.tool_name ?? event?.toolName
}

function inScope(event, root) {
  const relevant = join(root, RELEVANT_ROOT)
  const cwd = typeof event?.cwd === 'string' ? resolve(event.cwd) : root

  if (eventName(event) === 'SessionStart') return isInside(cwd, relevant)

  const toolName = toolNameOf(event)
  if (typeof toolName !== 'string' || !EDIT_TOOLS.has(toolName)) {
    // Observations only: the gate records `intent list|load` invocations but denies nothing here.
    return true
  }

  const paths = affectedPaths(event, root)
  if (paths.length === 0) return isInside(cwd, relevant)
  return paths.some((path) => isInside(path, relevant))
}

// Pull every file the call could touch. Tool input shapes differ per agent: Claude sends
// `file_path`, Codex sends a patch body with `*** Update File:` markers.
function affectedPaths(event, root) {
  const input = event?.tool_input ?? event?.toolArgs
  const found = []

  const push = (value) => {
    if (typeof value !== 'string' || value.length === 0) return
    found.push(isAbsolute(value) ? resolve(value) : resolve(root, value))
  }

  if (typeof input === 'string') {
    for (const match of input.matchAll(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/gm)) {
      push(match[1].trim())
    }
    return found
  }

  if (input && typeof input === 'object') {
    push(input.file_path)
    push(input.filePath)
    push(input.path)
    push(input.notebook_path)
    if (Array.isArray(input.paths)) {
      for (const path of input.paths) push(path)
    }
  }

  return found
}

// Run the agent-specific gate with the original event on stdin and pass its decision through
// unchanged. The gates exit 0 and express a denial as JSON, so stdout is the contract.
function forward(gate, raw) {
  try {
    const stdout = execFileSync(process.execPath, [gate], {
      input: raw,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout: 30_000,
    })
    if (stdout) process.stdout.write(stdout)
  } catch (error) {
    if (error?.stdout) process.stdout.write(String(error.stdout))
  }
}
