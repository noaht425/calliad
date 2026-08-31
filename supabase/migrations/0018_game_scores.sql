-- Scores for the memory games (math sprint, roots quiz, riddle solves) so
-- Calliad can show a personal best / streak.
create table game_scores (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  game    text not null,                 -- 'math_sprint' | 'roots_quiz' | 'riddle'
  score   integer not null,
  detail  jsonb not null default '{}'::jsonb,
  at      timestamptz not null default now()
);
create index idx_game_scores_user_game on game_scores (user_id, game, at desc);
alter table game_scores enable row level security;
grant select, insert, update, delete on game_scores to service_role;
