# notify-010-run-failures

Records failed runs. Nothing else.

## Why it exists

A failed collector run used to leave **no trace in the product database**. Three things combined:

1. n8n does not store successful executions in this stack (`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`);
2. the run row is written by the *last* node of the pipeline, which a failed run never reaches;
3. so `mnemora_runs` only ever showed the runs that went well, and "was the run successful?" could
   only be answered by the absence of a row — the same signal as "the schedule is not firing".

This workflow is attached as the **error workflow** of `collect-010`, so n8n invokes it whenever that
workflow fails. It writes a row with `status = 'error'` and the failing node named, using the same
payload shape and the same table a successful run writes to.

## Prerequisites

| credential | type | used by |
|---|---|---|
| `Mnemora DB` | `postgres` | `Record Failure` — inserts straight into `mnemora_runs` as `mnemora_app` |

It deliberately does **not** use `Mnemora Pipe`. The first version posted the failure to the write
pipe, and recorded nothing at all the moment the pipe was down — which is the failure it exists to
report. The pipe is the component most likely to have broken, so the failure logger talks to
Postgres directly.

It reads no environment variables, so it has no `.env.example`.

## Nodes

`On Workflow Failure` → `Build Failure Summary` → `Record Failure` (Postgres INSERT)

`Build Failure Summary` produces the normal `run_summary` shape, with two deliberate differences:

- `status: "error"` — so one query returns successes and failures together.
- the numeric counts are `null`, not `0`. The run died before it knew them, and zero would read as
  "looked at nothing and found nothing", which is a different and misleading fact.

`note` carries `failed in node "<name>": <message>`.

## What you get

```sql
select run_id, trigger_mode, status, note, finished_at_utc
from mnemora_runs
where status = 'error'
order by finished_at_utc desc;
```

and the same rows appear in the `recent_runs` list of the telemetry endpoint, so a failure is visible
wherever you look.

## Wiring it up

The association lives on the *calling* workflow, as a setting:

```
collect-010 settings → errorWorkflow: <id of this workflow>
```

Repointing it is one line in `workflows/collect-010-github-public-cache/workflow.json`
(`settings.errorWorkflow`). If this workflow is missing or unreachable, n8n still records the failure
in its own execution list — it just will not reach the product database.
