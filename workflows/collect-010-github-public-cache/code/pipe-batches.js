// Routes Collect's output to the pipeline.
//
// One request per repository record — including skipped repositories, whose records carry no
// commit list but still advance refreshed_at_utc. Plus a single request listing repositories
// that vanished from the listing, so the database can archive them instead of deleting them.
// The run-status item is not a database record and is dropped here; it still goes to the cache
// export, where it belongs.
const out = [];
let archived = [];
for (const item of $('Collect').all()) {
  const j = item.json || {};
  if (j.repository_id !== undefined && j.repository_id !== null && j.repository_id !== '') {
    out.push({ json: j });
  } else {
    // The run-status item carries two things the pipeline needs and the export does not:
    // records that must not overwrite the cache (skipped, failed), and repositories that
    // vanished upstream.
    if (Array.isArray(j.pipe_only_records)) out.push(...j.pipe_only_records.map((r) => ({ json: r })));
    if (Array.isArray(j.archived_repository_ids)) archived = j.archived_repository_ids;
  }
}
if (archived.length) out.push({ json: { archived_repository_ids: archived } });
return out;
