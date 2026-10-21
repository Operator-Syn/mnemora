-- Run lease. $1 = base64(utf8(json)) of { "run_claim": { action, run_id, workflow, ttl_seconds } }
--
-- acquire and release are one statement each because the acquire must be atomic: the conflict
-- clause fires only when the existing lease has expired, so two simultaneous runs cannot both
-- win. Reading first and then writing would leave exactly the window the claim exists to close.
with payload as (
  select convert_from(decode($1, 'base64'), 'UTF8')::jsonb as j
),
req as (
  select j -> 'run_claim' as c from payload
),
released as (
  delete from mnemora_run_lock
   where lock_name = 'collector'
     and (select c ->> 'action' from req) = 'release'
     and run_id = (select c ->> 'run_id' from req)
  returning run_id
),
acquired as (
  insert into mnemora_run_lock as l (lock_name, run_id, workflow, started_at_utc, expires_at_utc)
  select 'collector',
         c ->> 'run_id',
         c ->> 'workflow',
         now(),
         now() + make_interval(secs => coalesce((c ->> 'ttl_seconds')::int, 900))
  from req
  where (select c ->> 'action' from req) = 'acquire'
  on conflict (lock_name) do update
     set run_id = excluded.run_id,
         workflow = excluded.workflow,
         started_at_utc = excluded.started_at_utc,
         expires_at_utc = excluded.expires_at_utc
     where l.expires_at_utc < now()
  returning run_id
)
select
  (select c ->> 'action' from req)                                        as action,
  ((select count(*) from acquired) = 1)                                    as acquired,
  ((select count(*) from released) = 1)                                    as released,
  (select run_id from mnemora_run_lock where lock_name = 'collector')      as holder,
  (select expires_at_utc from mnemora_run_lock where lock_name = 'collector') as holder_expires_at_utc;