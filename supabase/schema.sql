-- =============================================================================
-- Obra Missionária — Ala Queimados
-- Esquema, constraints, RLS e Realtime.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. É idempotente: pode
-- rodar de novo sem quebrar nada.
--
-- Duas garantias vivem aqui, e não no JavaScript:
--   1. Dois membros não conseguem pegar a mesma vaga — constraint UNIQUE.
--   2. As telas do LMA são restritas de verdade — policies de RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Quem é líder
--
-- Qualquer pessoa consegue pedir um link mágico para o próprio e-mail e obter
-- uma sessão. Ter sessão, portanto, NÃO é ser líder. A autorização vem desta
-- lista — sem estar aqui, a sessão não abre nada.
-- -----------------------------------------------------------------------------

create table if not exists public.lideres (
  email      text primary key,
  nome       text,
  criado_em  timestamptz not null default now()
);

comment on table public.lideres is
  'Lista de e-mails autorizados como LMA. Ter sessão não basta: é preciso estar aqui.';

-- security definer para que a função enxergue a tabela mesmo quando o
-- solicitante não tem permissão de leitura sobre ela.
create or replace function public.eh_lider()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lideres
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.eh_lider() from public;
grant execute on function public.eh_lider() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Áreas
-- -----------------------------------------------------------------------------

create table if not exists public.areas (
  id     text primary key,
  nome   text not null,
  cor    smallint not null default 0,
  ordem  smallint not null default 0,
  ativa  boolean not null default true
);

insert into public.areas (id, nome, cor, ordem) values
  ('queimados',   'Queimados',     0, 1),
  ('jardins',     'Jardins',       1, 2),
  ('engPedreira', 'Eng. Pedreira', 2, 3),
  ('paracambi',   'Paracambí',     3, 4)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Almoço
-- -----------------------------------------------------------------------------

create table if not exists public.voluntarios_almoco (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (char_length(nome) between 2 and 120),
  telefone      text,
  endereco      text,
  duplas        smallint not null default 1 check (duplas between 1 and 8),
  modalidade    text not null default 'presencial',
  periodicidade text not null default 'livre',
  observacoes   text,
  criado_em     timestamptz not null default now()
);

create table if not exists public.almoco_agenda (
  id          uuid primary key default gen_random_uuid(),
  data        date not null check (data >= date '2024-01-01'),
  area_id     text not null references public.areas(id) on delete cascade,
  nome        text not null check (char_length(nome) between 2 and 120),
  modalidade  text not null default 'presencial',
  observacao  text check (observacao is null or char_length(observacao) <= 280),
  criado_em   timestamptz not null default now(),

  -- ESTA linha é a trava contra dois membros pegando o mesmo dia.
  -- O segundo INSERT simultâneo falha com 23505 e o app mostra o aviso.
  constraint almoco_vaga_unica unique (data, area_id)
);

create index if not exists almoco_agenda_data_idx on public.almoco_agenda (data);

-- -----------------------------------------------------------------------------
-- Lições com membros
-- -----------------------------------------------------------------------------

create table if not exists public.disponibilidade_licoes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (char_length(nome) between 2 and 120),
  telefone    text,
  modalidade  text not null,                 -- presencial | video
  dia         text not null,                 -- dom..sab
  horario     text not null,                 -- '19:00 - 20:00'
  criado_em   timestamptz not null default now(),
  constraint disponibilidade_unica unique (nome, modalidade, dia, horario)
);

create table if not exists public.licoes_agenda (
  id          uuid primary key default gen_random_uuid(),
  data        date not null check (data >= date '2024-01-01'),
  horario     text not null,
  area_id     text not null references public.areas(id) on delete cascade,
  nome        text not null check (char_length(nome) between 2 and 120),
  modalidade  text not null default 'presencial',
  observacao  text check (observacao is null or char_length(observacao) <= 280),
  criado_em   timestamptz not null default now(),
  constraint licao_vaga_unica unique (data, horario, area_id)
);

-- -----------------------------------------------------------------------------
-- Relatório de progresso
--
-- Colunas achatadas em vez de JSON: o consolidado e os gráficos são somas, e
-- soma em coluna é indexável e conferível.
-- Progredindo, batismos e confirmações NÃO estão aqui — são derivados das
-- listas nominais. Frequência é da ala e mora em tabela própria.
-- -----------------------------------------------------------------------------

create table if not exists public.relatorio_semanal (
  id       uuid primary key default gen_random_uuid(),
  data     date not null,
  area_id  text not null references public.areas(id) on delete cascade,

  -- snake_case obrigatório: o Postgres rebaixa identificador não citado para
  -- minúsculas, então "licoesMembro" viraria "licoesmembro" e não casaria com
  -- o nome que o cliente envia.
  referencias             integer not null default 0 check (referencias   >= 0),
  licoes_membro           integer not null default 0 check (licoes_membro >= 0),
  outras_licoes           integer not null default 0 check (outras_licoes >= 0),

  novas_pessoas_casados   integer not null default 0 check (novas_pessoas_casados >= 0),
  novas_pessoas_homens    integer not null default 0 check (novas_pessoas_homens  >= 0),
  novas_pessoas_total     integer not null default 0 check (novas_pessoas_total   >= 0),

  novos_com_data_casados  integer not null default 0 check (novos_com_data_casados >= 0),
  novos_com_data_homens   integer not null default 0 check (novos_com_data_homens  >= 0),
  novos_com_data_total    integer not null default 0 check (novos_com_data_total   >= 0),

  total_com_data_casados  integer not null default 0 check (total_com_data_casados >= 0),
  total_com_data_homens   integer not null default 0 check (total_com_data_homens  >= 0),
  total_com_data_total    integer not null default 0 check (total_com_data_total   >= 0),

  sacramental             integer not null default 0 check (sacramental >= 0),

  atualizado_em timestamptz not null default now(),
  constraint relatorio_semana_area_unica unique (data, area_id)
);

-- Frequência sacramental é da ALA. Na planilha era digitada quatro vezes,
-- idêntica, e nunca somada. Aqui um domingo tem um valor só.
create table if not exists public.frequencia_ala (
  id     uuid primary key default gen_random_uuid(),
  data   date not null unique,
  valor  integer not null default 0 check (valor >= 0)
);

create table if not exists public.batismos (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null check (char_length(nome) between 2 and 120),
  sexo              text not null check (sexo in ('m', 'f')),
  idade             smallint check (idade between 0 and 120),
  area_id           text references public.areas(id) on delete set null,
  data_batismo      date not null,
  data_confirmacao  date,
  familia_completa  boolean not null default false,
  criado_em         timestamptz not null default now()
);

create index if not exists batismos_data_idx on public.batismos (data_batismo);

create table if not exists public.progredindo (
  id            uuid primary key default gen_random_uuid(),
  data          date not null,               -- domingo que fecha a semana
  nome          text not null check (char_length(nome) between 2 and 120),
  area_id       text not null references public.areas(id) on delete cascade,
  sacramentais  smallint not null default 0 check (sacramentais >= 0),
  data_batismo  date,
  organizacao   text,
  criado_em     timestamptz not null default now()
);

create index if not exists progredindo_data_idx on public.progredindo (data);

-- =============================================================================
-- RLS
--
-- Sem policy, nega. Cada tabela abaixo declara exatamente quem faz o quê.
-- =============================================================================

alter table public.lideres               enable row level security;
alter table public.areas                 enable row level security;
alter table public.voluntarios_almoco    enable row level security;
alter table public.almoco_agenda         enable row level security;
alter table public.disponibilidade_licoes enable row level security;
alter table public.licoes_agenda         enable row level security;
alter table public.relatorio_semanal     enable row level security;
alter table public.frequencia_ala        enable row level security;
alter table public.batismos              enable row level security;
alter table public.progredindo           enable row level security;

-- Recria as policies do zero para o script poder rodar de novo.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('lideres','areas','voluntarios_almoco','almoco_agenda',
                        'disponibilidade_licoes','licoes_agenda','relatorio_semanal',
                        'frequencia_ala','batismos','progredindo')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- --- lideres: só líder enxerga a lista; alterar, só direto no SQL Editor ------
create policy lideres_leitura on public.lideres
  for select using (public.eh_lider());

-- --- areas: leitura pública (o calendário precisa), escrita só do líder -------
create policy areas_leitura on public.areas
  for select using (true);
create policy areas_escrita on public.areas
  for all using (public.eh_lider()) with check (public.eh_lider());

-- --- voluntários: tem telefone e endereço, então NÃO é público ----------------
create policy voluntarios_tudo on public.voluntarios_almoco
  for all using (public.eh_lider()) with check (public.eh_lider());

-- --- agenda do almoço: o coração do modelo de acesso --------------------------
-- Ler: qualquer pessoa com o link, para ver os dias livres.
create policy almoco_leitura on public.almoco_agenda
  for select using (true);

-- Criar: qualquer pessoa com o link, mas só para hoje em diante.
-- O líder escapa da trava de data porque precisa acertar o passado.
create policy almoco_reserva on public.almoco_agenda
  for insert with check (data >= current_date or public.eh_lider());

-- Alterar e apagar: só o LMA. É o "uma vez gravada, só o admin altera".
create policy almoco_ajuste on public.almoco_agenda
  for update using (public.eh_lider()) with check (public.eh_lider());
create policy almoco_remocao on public.almoco_agenda
  for delete using (public.eh_lider());

-- --- disponibilidade para lições ---------------------------------------------
-- Guarda telefone, então a leitura é do líder, como a lista de voluntários.
-- O membro cadastra a própria disponibilidade sem precisar ver a dos outros.
create policy disp_leitura on public.disponibilidade_licoes
  for select using (public.eh_lider());
create policy disp_cadastro on public.disponibilidade_licoes
  for insert with check (true);

-- --- agenda das lições: pública como a do almoço ------------------------------
create policy disp_ajuste on public.disponibilidade_licoes
  for update using (public.eh_lider()) with check (public.eh_lider());
create policy disp_remocao on public.disponibilidade_licoes
  for delete using (public.eh_lider());

create policy licoes_leitura on public.licoes_agenda
  for select using (true);
create policy licoes_reserva on public.licoes_agenda
  for insert with check (data >= current_date or public.eh_lider());
create policy licoes_ajuste on public.licoes_agenda
  for update using (public.eh_lider()) with check (public.eh_lider());
create policy licoes_remocao on public.licoes_agenda
  for delete using (public.eh_lider());

-- --- relatório e listas nominais: nada disso é público ------------------------
create policy relatorio_tudo on public.relatorio_semanal
  for all using (public.eh_lider()) with check (public.eh_lider());
create policy frequencia_tudo on public.frequencia_ala
  for all using (public.eh_lider()) with check (public.eh_lider());
create policy batismos_tudo on public.batismos
  for all using (public.eh_lider()) with check (public.eh_lider());
create policy progredindo_tudo on public.progredindo
  for all using (public.eh_lider()) with check (public.eh_lider());

-- =============================================================================
-- Realtime — só o que precisa aparecer na tela de todo mundo na hora
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array['almoco_agenda','licoes_agenda','disponibilidade_licoes','areas']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =============================================================================
-- ÚLTIMO PASSO — troque pelo seu e-mail e rode.
-- Sem isto, ninguém é líder e as telas restritas ficam vazias para todos.
-- =============================================================================

-- insert into public.lideres (email, nome)
-- values ('leospd.lucas@gmail.com', 'Léo')
-- on conflict (email) do nothing;
