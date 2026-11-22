-- Notifications (F-NOTIFY-1..5, T21).

-- F-NOTIFY-5: a user mutes a project's email notifications for themselves.
create table public.notification_mutes (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);
create index notification_mutes_project_id_idx on public.notification_mutes (project_id);

alter table public.notification_mutes enable row level security;

-- Personal preference: each user sees and changes only their own rows, for projects they can view.
create policy notification_mutes_select on public.notification_mutes for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_mutes_insert on public.notification_mutes for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_view(project_id));
create policy notification_mutes_delete on public.notification_mutes for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.notification_mutes to authenticated;

-- F-NOTIFY-1: an email channel without an address goes to all project members; a Slack channel
-- always has its encrypted webhook URL.
alter table public.notification_channels
  add constraint notification_channels_target_check check (
    (type = 'slack' and target_enc is not null and target is null)
    or (type = 'email' and target_enc is null)
  );
