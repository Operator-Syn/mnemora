# n8n vendor overrides

Files here are mounted **over** files inside n8n's compiled distribution. They are patches to
somebody else's code, and they are here because the alternative was worse.

| override | replaces | why |
|---|---|---|
| `workflow-import-url-removed.rule.js` | `dist/modules/breaking-changes/rules/v3/workflow-import-url-removed.rule.js` | The rule reports unconditionally (`isAffected: true`, no condition, no flag), is instance-level so `migration_finding` cannot triage it, and gives no way to retire a notice about a capability we have already replaced. |

## Rules for living with these

1. **Mount, never copy.** A `docker cp` or a rebuild is lost on the next pull. The mount in
   `compose.yaml` is what makes this durable, and it is on both `n8n` and `worker` because either
   can serve the request.
2. **Keep the file shape identical.** n8n compiles with legacy TypeScript decorators and discovers
   rules by their decorated export. The override copies the `__decorate` helper verbatim from the
   shipped file; a cleaner-looking rewrite is how registration silently stops.
3. **Say what it does not do.** These suppress notices, never restore features. The editor's
   import-from-URL is gone from n8n 3.x; `./scripts/workflows.sh import-url` is the capability.
4. **Re-check on every `N8N_VERSION` bump.** `scripts/check-n8n-overrides.py` asserts the mount
   exists on both services, the file still suppresses, and — with the stack running — that the rule
   inside the container actually returns `isAffected: false`. It is wired into
   `./scripts/workflows.sh check` and blocks imports if it fails.

## Removing one

Delete the volume line from both services in `compose.yaml`, delete the file here, recreate the
containers. The notice returns, which is the correct state if n8n ever reappears with the feature.
