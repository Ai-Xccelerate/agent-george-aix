-- Follow-up to 20260515000200: the original FK on agent_jobs.created_by had
-- no ON DELETE action, so deleting the admin who created a job would hard
-- fail. Match the SET NULL behavior used elsewhere in the schema.

alter table public.agent_jobs
  drop constraint if exists agent_jobs_created_by_fkey;

alter table public.agent_jobs
  add constraint agent_jobs_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;
