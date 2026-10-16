-- =============================================================================
-- Obra Missionária — Ala Palmas 4
-- Esquema, constraints, RLS e Realtime.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. É idempotente: pode
-- rodar de novo sem quebrar nada.
--
-- Duas garantias vivem aqui, e não no JavaScript:
--   1. Dois membros não conseguem pegar a mesma vaga — constraint UNIQUE.
--   2. Quem não tem cadastro não vê nada, e as telas do LMA são restritas de
--      verdade — policies de RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Quem é líder
--
-- Desde outubro de 2026 são duas contas, LMA e ADM, criadas à mão no painel do
-- Supabase (ver o fim deste arquivo). Qualquer pessoa pode se cadastrar como
-- membro e ganhar uma sessão, então ter sessão NÃO é ser líder: quem autoriza
-- é esta lista, e o app não escreve nela. Líder novo é uma linha de SQL.
--
-- A lista aponta para a CONTA (usuario_id), não para o e-mail. Com o cadastro
-- aberto e sem confirmação de e-mail, quem registrasse lma@isudapp.netlify.app
-- antes de a conta de verdade existir herdaria o acesso se a chave fosse o
-- e-mail. Pela conta, o intruso fica só com um login sem poder nenhum — e o
-- "Add user" do painel falha avisando que o endereço já existe.
-- -----------------------------------------------------------------------------

create table if not exists public.lideres (
  email      text primary key,
  nome       text,
  criado_em  timestamptz not null default now()
);

alter table public.lideres
  add column if not exists usuario_id uuid unique references auth.users(id) on delete cascade;

-- O e-mail entra sempre em minúsculas. `not valid` deixa as linhas já
-- gravadas em paz.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lideres_email_minusculo') then
    alter table public.lideres
      add constraint lideres_email_minusculo check (email = lower(email)) not valid;
  end if;
end $$;

comment on table public.lideres is
  'Contas com acesso de LMA. Autoriza pela conta (usuario_id); o e-mail é só para leitura humana.';

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
    where usuario_id = auth.uid()
  );
$$;

revoke all on function public.eh_lider() from public;
grant execute on function public.eh_lider() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Membros cadastrados
--
-- Todo membro que oferece almoço, acompanha lições ou usa o app tem cadastro.
-- Uma linha por conta do Supabase Auth — o id É o da conta. A linha nasce do
-- próprio app, logo depois do signUp, com a sessão que ele devolve.
--
-- Tem e-mail e telefone, então só o dono da linha e o LMA leem.
-- -----------------------------------------------------------------------------

create table if not exists public.membros (
  id             uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  nome_completo  text not null check (char_length(nome_completo) between 3 and 120),
  apelido        text not null check (char_length(apelido) between 2 and 40 and apelido = btrim(apelido)),
  email          text not null unique check (email = lower(email)),
  telefone       text not null check (char_length(regexp_replace(telefone, '\D', '', 'g')) between 10 and 13),
  whatsapp       boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- O domínio do app é das contas de líder. Um membro com endereço ali só
-- serviria para confundir quem lê a lista — ou para se passar por uma delas.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'membros_email_pessoal') then
    alter table public.membros
      add constraint membros_email_pessoal check (email !~ '@isudapp\.netlify\.app$');
  end if;
end $$;

comment on table public.membros is
  'Cadastro de cada membro que usa o app. Só o próprio membro e o LMA leem.';

create or replace function public.eh_membro()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.membros where id = auth.uid());
$$;

-- Quem pode abrir o app: líder ou membro com cadastro. Sessão sem cadastro
-- (o signUp que não chegou a gravar a linha) ainda não vê nada.
create or replace function public.pode_usar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.eh_lider() or public.eh_membro();
$$;

-- O nome que vai para os calendários. As policies exigem que a reserva de um
-- membro leve ESTE nome e o id da conta dele. O nome sozinho não prova nada
-- — o membro pode trocar o próprio "como quer ser chamado" —, por isso o app
-- mostra ao LMA, pelo membro_id, de qual cadastro cada reserva saiu.
create or replace function public.apelido_do_membro()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select apelido from public.membros where id = auth.uid();
$$;

revoke all on function public.eh_membro() from public;
revoke all on function public.pode_usar() from public;
revoke all on function public.apelido_do_membro() from public;
grant execute on function public.eh_membro() to anon, authenticated;
grant execute on function public.pode_usar() to anon, authenticated;
grant execute on function public.apelido_do_membro() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Senha provisória
--
-- Uma linha aqui obriga a conta a trocar de senha no próximo login: a senha
-- inicial do LMA, e a que o LMA gera para o membro que esqueceu a sua. O
-- e-mail embutido do Supabase não entrega recuperação de senha, então este é
-- o caminho de volta para quem ficou do lado de fora.
-- -----------------------------------------------------------------------------

create table if not exists public.senhas_provisorias (
  id         uuid primary key references auth.users(id) on delete cascade,
  criado_em  timestamptz not null default now()
);


-- O LMA dá ao membro uma senha provisória. Mexe em auth.users, por isso é
-- security definer e confere tudo antes: só líder chama, só sobre conta de
-- membro, nunca sobre conta de líder — senha de líder se troca no painel.
create or replace function public.redefinir_senha_de_membro(p_membro uuid, p_senha text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.eh_lider() then
    raise exception 'Só o líder de missão gera senha provisória.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_senha, '')) < 8 then
    raise exception 'A senha provisória precisa de pelo menos 8 caracteres.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.membros where id = p_membro) then
    raise exception 'Cadastro não encontrado.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.lideres where usuario_id = p_membro) then
    raise exception 'Senha de líder se troca pelo SQL do fim do schema.sql.' using errcode = '42501';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_membro;

  insert into public.senhas_provisorias (id) values (p_membro)
  on conflict (id) do update set criado_em = now();
end;
$$;

revoke all on function public.redefinir_senha_de_membro(uuid, text) from public, anon;
grant execute on function public.redefinir_senha_de_membro(uuid, text) to authenticated;

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

-- Áreas de partida. O LMA cria, renomeia e desativa pela tela de
-- Configurações; isto aqui só garante que o app não abra sem nenhuma.
--
-- `do nothing` e não `do update`: rodar o schema de novo não pode desfazer um
-- nome que o LMA mudou pelo app. Por isso trocar estes nomes aqui só vale para
-- banco novo — num banco que já tem as áreas, renomeie em Configurações.
insert into public.areas (id, nome, cor, ordem) values
  ('area1', 'Palmas 4 Norte', 0, 1),
  ('area2', 'Palmas 4 Sul',   1, 2)
on conflict (id) do nothing;

-- Duplas de missionários por área e mês — os nomes que apareciam no cabeçalho
-- de cada bloco da planilha. Leitura pública para o calendário poder mostrar
-- quem o voluntário vai receber.
create table if not exists public.duplas_missionarios (
  id             uuid primary key default gen_random_uuid(),
  area_id        text not null references public.areas(id) on delete cascade,
  ano            smallint not null,
  mes            smallint not null check (mes between 1 and 12),
  missionario_1  text,
  missionario_2  text,
  atualizado_em  timestamptz not null default now(),
  constraint dupla_unica unique (area_id, ano, mes)
);

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

-- `modalidade` (aqui e em voluntarios_almoco) ficou para trás: desde outubro de
-- 2026 todo almoço é presencial e o app não grava nem mostra a coluna. Ela
-- segue com o default 'presencial' para inserts antigos e o histórico.
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

-- Quem reservou. Nulo nas reservas de antes do cadastro e nas que o LMA faz
-- em nome de alguém; o `nome` continua sendo o que aparece na grade.
alter table public.almoco_agenda
  add column if not exists membro_id uuid references public.membros(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Lições com membros
-- -----------------------------------------------------------------------------

-- Sem constraint de unicidade, de propósito.
--
-- O formulário do membro só acrescenta, e reenviar é normal. Com a
-- constraint, o reenvio caía em ON CONFLICT, que exige ler as linhas em
-- conflito — o anônimo de antes não podia, e o insert falhava com 42501.
-- Linha repetida aqui é inofensiva e a leitura deduplica por (nome,
-- modalidade, dia, horário).
create table if not exists public.disponibilidade_licoes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (char_length(nome) between 2 and 120),
  telefone    text,
  modalidade  text not null,                 -- presencial | video
  dia         text not null,                 -- dom..sab
  horario     text not null,                 -- '19:00 - 20:00'
  criado_em   timestamptz not null default now()
);

alter table public.disponibilidade_licoes
  drop constraint if exists disponibilidade_unica;

-- Sem unicidade, o domínio é o que impede lixo. `not valid` deixa as linhas
-- já existentes em paz e passa a exigir das novas.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'disponibilidade_dia_valido') then
    alter table public.disponibilidade_licoes
      add constraint disponibilidade_dia_valido
      check (dia in ('dom','seg','ter','qua','qui','sex','sab')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'disponibilidade_modalidade_valida') then
    alter table public.disponibilidade_licoes
      add constraint disponibilidade_modalidade_valida
      check (modalidade in ('presencial','video')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'disponibilidade_horario_valido') then
    alter table public.disponibilidade_licoes
      add constraint disponibilidade_horario_valido
      check (horario in (
        '10:30 - 11:30','14:00 - 15:00','15:00 - 16:00','16:00 - 17:00',
        '17:00 - 18:00','18:00 - 19:00','19:00 - 20:00','20:00 - 21:00'
      )) not valid;
  end if;
end $$;

alter table public.disponibilidade_licoes
  add column if not exists membro_id uuid references public.membros(id) on delete set null;

create index if not exists disponibilidade_busca_idx
  on public.disponibilidade_licoes (modalidade, dia, horario);

create index if not exists disponibilidade_nome_idx
  on public.disponibilidade_licoes (lower(nome));

-- Teto por membro. Como a tabela não tem unicidade, reenviar o formulário
-- acrescenta linhas; sem limite, um laço de repetição encheria a tabela.
-- 112 é o máximo que faz sentido (7 dias × 8 faixas × 2 modalidades), então
-- 500 dá folga para alguns reenvios e ainda limita. Conta pela conta, não
-- pelo nome digitado, que antes bastava trocar para zerar o teto.
create or replace function public.disponibilidade_sob_limite()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    select count(*) from public.disponibilidade_licoes
    where membro_id = auth.uid()
  ) < 500;
$$;

revoke all on function public.disponibilidade_sob_limite() from public;
grant execute on function public.disponibilidade_sob_limite() to anon, authenticated;

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

alter table public.licoes_agenda
  add column if not exists membro_id uuid references public.membros(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Relatório de progresso
--
-- Colunas achatadas em vez de JSON: o consolidado e os gráficos são somas, e
-- soma em coluna é indexável e conferível.
-- Progredindo, batismos e confirmações NÃO estão aqui — são derivados das
-- listas nominais. Frequência é da ala e mora em tabela própria.
-- -----------------------------------------------------------------------------

-- Casados e Homens adultos deixaram de ser lançados em outubro de 2026: o app
-- lê e grava só as colunas `_total`. As `_casados` e `_homens` ficam aqui com
-- o histórico, sem uso — derrubá-las apagaria dado já lançado por nada.
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

-- -----------------------------------------------------------------------------
-- Caminho do convênio
--
-- Acompanha recém-conversos e membros que voltam à atividade por DOIS anos,
-- que é a janela do "Relatório de Progresso: No Caminho do Convênio". A ficha
-- antiga da ala parava em um ano.
--
-- É o dado mais sensível do app: progresso espiritual de pessoas com nome e
-- telefone. Nada aqui é legível por anônimo.
-- -----------------------------------------------------------------------------

create table if not exists public.caminho_pessoas (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (char_length(nome) between 2 and 120),
  tipo           text not null check (tipo in ('recemConverso', 'retornando')),
  area_id        text references public.areas(id) on delete set null,
  sexo           text check (sexo in ('m', 'f')),
  -- Batismo, para recém-converso; volta à atividade, para quem retorna.
  data_inicio    date not null,
  telefone       text,
  -- O Manual pede consentimento do membro que retorna antes de incluí-lo.
  consentimento  boolean not null default false,
  observacoes    text,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now()
);

create index if not exists caminho_pessoas_inicio_idx
  on public.caminho_pessoas (data_inicio);

create table if not exists public.caminho_marcos (
  id          uuid primary key default gen_random_uuid(),
  pessoa_id   uuid not null references public.caminho_pessoas(id) on delete cascade,
  marco       text not null,
  data        date,
  observacao  text,
  criado_em   timestamptz not null default now(),
  constraint caminho_marco_unico unique (pessoa_id, marco)
);

-- A faixa "Domingos na Igreja" da ficha antiga.
create table if not exists public.caminho_frequencia (
  id          uuid primary key default gen_random_uuid(),
  pessoa_id   uuid not null references public.caminho_pessoas(id) on delete cascade,
  domingo     date not null,
  presente    boolean not null default true,
  constraint caminho_frequencia_unica unique (pessoa_id, domingo)
);

create index if not exists caminho_frequencia_domingo_idx
  on public.caminho_frequencia (domingo);

-- -----------------------------------------------------------------------------
-- Coordenação missionária — Manual Geral 23.4
--
-- A reunião é semanal e reúne as presidências da Sociedade de Socorro, do
-- quórum de élderes e da Primária, representante das Moças, assistente do
-- quórum de sacerdotes e os missionários de ala e de tempo integral.
-- -----------------------------------------------------------------------------

create table if not exists public.coordenacao_reunioes (
  id           uuid primary key default gen_random_uuid(),
  data         date not null unique,
  observacoes  text,
  criado_em    timestamptz not null default now()
);

create table if not exists public.coordenacao_presencas (
  id          uuid primary key default gen_random_uuid(),
  reuniao_id  uuid not null references public.coordenacao_reunioes(id) on delete cascade,
  papel       text not null,
  presente    boolean not null default true,
  constraint coordenacao_presenca_unica unique (reuniao_id, papel)
);

-- reuniao_id fica nulo quando a designação nasce fora de uma reunião.
create table if not exists public.coordenacao_designacoes (
  id            uuid primary key default gen_random_uuid(),
  reuniao_id    uuid references public.coordenacao_reunioes(id) on delete set null,
  descricao     text not null check (char_length(descricao) between 3 and 500),
  responsavel   text,
  prazo         date,
  concluida     boolean not null default false,
  concluida_em  date,
  criado_em     timestamptz not null default now()
);

create index if not exists designacoes_abertas_idx
  on public.coordenacao_designacoes (concluida, prazo);

-- Plano da ala para compartilhar o evangelho. Uma linha por seção.
create table if not exists public.plano_ala (
  id             uuid primary key default gen_random_uuid(),
  secao          text not null unique,
  texto          text,
  atualizado_em  timestamptz not null default now()
);

-- Título editável de cada seção. Nulo é "use o título padrão do app"
-- (SECOES_PLANO em js/config.js) — apagar o campo devolve o padrão.
alter table public.plano_ala add column if not exists titulo text;

-- =============================================================================
-- RLS
--
-- Sem policy, nega. Cada tabela abaixo declara exatamente quem faz o quê.
-- =============================================================================

-- Permissões explícitas em TODAS as tabelas. A partir de 30 de outubro de
-- 2026 o Supabase deixa de dar acesso automático pela API ao que for criado
-- em `public`. No projeto de hoje as tabelas antigas já têm o seu; mas num
-- projeto novo — o caso que o backup existe para cobrir — sem isto nenhuma
-- tela abriria. Quem decide linha a linha continua sendo o RLS, abaixo.
--
-- O anônimo não precisa de tabela nenhuma: desde outubro de 2026 ninguém usa
-- o app sem entrar.
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

alter table public.lideres               enable row level security;
alter table public.membros               enable row level security;
alter table public.senhas_provisorias    enable row level security;
alter table public.areas                 enable row level security;
alter table public.duplas_missionarios   enable row level security;
alter table public.voluntarios_almoco    enable row level security;
alter table public.almoco_agenda         enable row level security;
alter table public.disponibilidade_licoes enable row level security;
alter table public.licoes_agenda         enable row level security;
alter table public.relatorio_semanal     enable row level security;
alter table public.frequencia_ala        enable row level security;
alter table public.batismos              enable row level security;
alter table public.progredindo           enable row level security;
alter table public.caminho_pessoas       enable row level security;
alter table public.caminho_marcos        enable row level security;
alter table public.caminho_frequencia    enable row level security;
alter table public.coordenacao_reunioes   enable row level security;
alter table public.coordenacao_presencas  enable row level security;
alter table public.coordenacao_designacoes enable row level security;
alter table public.plano_ala              enable row level security;

-- Recria as policies do zero para o script poder rodar de novo.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('lideres','membros','senhas_provisorias','areas','duplas_missionarios','voluntarios_almoco','almoco_agenda',
                        'disponibilidade_licoes','licoes_agenda','relatorio_semanal',
                        'frequencia_ala','batismos','progredindo',
                        'caminho_pessoas','caminho_marcos','caminho_frequencia',
                        'coordenacao_reunioes','coordenacao_presencas',
                        'coordenacao_designacoes','plano_ala')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- O que o acesso antigo deixou para trás, já sem policy dependendo dele: o
-- dono que concedia acesso pelo app, e o teto de disponibilidade contado
-- pelo nome digitado.
drop function if exists public.eh_dono();
alter table public.lideres drop column if exists dono;
drop function if exists public.disponibilidade_sob_limite(text);

-- --- lideres: só o líder lê; ninguém escreve pelo app -----------------------
create policy lideres_leitura on public.lideres
  for select using (public.eh_lider());

-- --- membros: cada um com o seu; o LMA vê todos -----------------------------
-- O e-mail da linha é o da conta, conferido no token: ninguém cadastra o
-- endereço de outra pessoa nem troca o seu por um que não é dele.
create policy membros_leitura on public.membros
  for select using (id = auth.uid() or public.eh_lider());
create policy membros_cadastro on public.membros
  for insert with check (
    id = auth.uid() and email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
create policy membros_ajuste on public.membros
  for update using (id = auth.uid())
  with check (id = auth.uid() and email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- --- senha provisória: a conta vê a sua e dá baixa depois de trocar --------
-- Quem cria a linha é redefinir_senha_de_membro() ou o SQL do fim do arquivo.
create policy senha_provisoria_leitura on public.senhas_provisorias
  for select using (id = auth.uid());
create policy senha_provisoria_baixa on public.senhas_provisorias
  for delete using (id = auth.uid());

-- --- areas: quem usa o app lê (o calendário precisa), só o líder escreve ----
create policy areas_leitura on public.areas
  for select using (public.pode_usar());
create policy areas_escrita on public.areas
  for all using (public.eh_lider()) with check (public.eh_lider());

create policy duplas_leitura on public.duplas_missionarios
  for select using (public.pode_usar());
create policy duplas_escrita on public.duplas_missionarios
  for all using (public.eh_lider()) with check (public.eh_lider());

-- --- voluntários: tem telefone e endereço, então NÃO é público ----------------
create policy voluntarios_tudo on public.voluntarios_almoco
  for all using (public.eh_lider()) with check (public.eh_lider());

-- --- agenda do almoço: o coração do modelo de acesso --------------------------
-- Ler: quem tem cadastro, para ver os dias livres. Era qualquer pessoa com o
-- link até outubro de 2026.
create policy almoco_leitura on public.almoco_agenda
  for select using (public.pode_usar());

-- Criar: o membro, em nome próprio, de hoje até um ano à frente.
--
-- O teto não é decoração. Sem ele, dez anos de calendário são ~14.600 linhas
-- e, como o membro não apaga, só o LMA conseguiria limpar, uma a uma.
--
-- O líder escapa das travas porque precisa acertar o passado e reservar em
-- nome de quem pediu por telefone.
create policy almoco_reserva on public.almoco_agenda
  for insert with check (
    public.eh_lider()
    or (
      public.eh_membro()
      and membro_id = auth.uid()
      and nome = public.apelido_do_membro()
      and data >= current_date and data <= current_date + interval '1 year'
    )
  );

-- Alterar e apagar: só o LMA. É o "uma vez gravada, só o admin altera".
create policy almoco_ajuste on public.almoco_agenda
  for update using (public.eh_lider()) with check (public.eh_lider());
create policy almoco_remocao on public.almoco_agenda
  for delete using (public.eh_lider());

-- --- disponibilidade para lições ---------------------------------------------
-- Guarda telefone: o LMA lê tudo, o membro só o que é dele.
create policy disp_leitura on public.disponibilidade_licoes
  for select using (public.eh_lider() or membro_id = auth.uid());
create policy disp_cadastro on public.disponibilidade_licoes
  for insert with check (
    public.eh_lider()
    or (
      public.eh_membro()
      and membro_id = auth.uid()
      and nome = public.apelido_do_membro()
      and public.disponibilidade_sob_limite()
    )
  );
create policy disp_ajuste on public.disponibilidade_licoes
  for update using (public.eh_lider()) with check (public.eh_lider());
create policy disp_remocao on public.disponibilidade_licoes
  for delete using (public.eh_lider());

-- --- agenda das lições: mesmas regras da do almoço ----------------------------
create policy licoes_leitura on public.licoes_agenda
  for select using (public.pode_usar());
create policy licoes_reserva on public.licoes_agenda
  for insert with check (
    public.eh_lider()
    or (
      public.eh_membro()
      and membro_id = auth.uid()
      and nome = public.apelido_do_membro()
      and data >= current_date and data <= current_date + interval '1 year'
    )
  );
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

-- --- caminho do convênio: o dado mais sensível do app ------------------------
create policy caminho_pessoas_tudo on public.caminho_pessoas
  for all using (public.eh_lider()) with check (public.eh_lider());
create policy caminho_marcos_tudo on public.caminho_marcos
  for all using (public.eh_lider()) with check (public.eh_lider());
create policy caminho_frequencia_tudo on public.caminho_frequencia
  for all using (public.eh_lider()) with check (public.eh_lider());

-- --- coordenação: reunião de liderança, nada disso é público -----------------
create policy coord_reunioes_tudo on public.coordenacao_reunioes
  for all using (public.eh_lider()) with check (public.eh_lider());
create policy coord_presencas_tudo on public.coordenacao_presencas
  for all using (public.eh_lider()) with check (public.eh_lider());
create policy coord_designacoes_tudo on public.coordenacao_designacoes
  for all using (public.eh_lider()) with check (public.eh_lider());
create policy plano_ala_tudo on public.plano_ala
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
-- ÚLTIMO PASSO — contas de líder, limpeza e cadastro aberto, NESTA ORDEM
--
-- 1) Crie as contas de líder ANTES de abrir o cadastro.
--    Authentication -> Users -> Add user, marcando "Auto Confirm User":
--
--        lma@isudapp.netlify.app   senha inicial do LMA
--        adm@isudapp.netlify.app   senha do ADM
--
--    Enquanto "Confirm email" estiver LIGADO, ninguém de fora cria conta: o
--    e-mail de confirmação não sai e o cadastro falha inteiro. Então ninguém
--    registra esses endereços antes de você. Se o "Add user" responder que o
--    endereço já existe, apague essa conta na mesma tela e crie de novo.
--
--    Esses endereços NÃO são caixas de e-mail: existem só porque o Supabase
--    Auth não conhece "usuário". O app completa o que for digitado sem "@"
--    com o domínio do site, então no login basta escrever `LMA` ou `ADM`. O
--    domínio fica em DOMINIO_USUARIO, em js/config.js.
--
-- 2) Rode o BLOCO A, descomentado — uma vez só, antes de abrir o cadastro.
--    Tira os acessos antigos: o LeoADM, os liberados por e-mail, e as contas
--    que o login por link criou. Essas não têm senha; sobrando, ficariam
--    presas: o cadastro diria "já existe", o login não entraria, e o LMA não
--    teria cadastro onde gerar senha provisória. Contas não confirmadas saem
--    junto — com a confirmação desligada, cadastrar-se com o e-mail de uma
--    delas entregaria a sessão dela.
--
-- 3) Rode o BLOCO B, descomentado, ANTES do primeiro login das contas. Liga
--    LMA e ADM à lista de líderes pela conta e marca a senha inicial do LMA
--    como provisória: no primeiro login o app pede outra. Pode rodar de novo
--    (para ligar o ADM depois, por exemplo), mas só liga e só marca conta
--    confirmada que NUNCA entrou — uma que já entrou pode ser de alguém que
--    se cadastrou com o endereço, não sua. Entrou antes de ligar? Apague a
--    conta no painel, crie de novo e rode o bloco B antes de entrar.
--
-- 4) Só então abra o cadastro: Authentication -> Sign In / Providers ->
--    Email, DESLIGUE "Confirm email" e deixe "Allow new users to sign up"
--    ligado. O servidor de e-mail embutido só entrega para quem é da equipe do
--    projeto; com a confirmação ligada, o cadastro de qualquer membro falha
--    ("Email address not authorized").
--
-- 5) Publique o site. Os calendários passam a exigir login assim que este
--    arquivo roda, então o site antigo deixa de mostrá-los — rode e publique
--    no mesmo momento.
-- =============================================================================

-- BLOCO A — uma vez só, antes de abrir o cadastro
--
-- delete from public.lideres
-- where email not in ('lma@isudapp.netlify.app', 'adm@isudapp.netlify.app');
--
-- delete from auth.users
-- where email not in ('lma@isudapp.netlify.app', 'adm@isudapp.netlify.app')
--   and id not in (select id from public.membros);

-- BLOCO B — pode repetir
--
-- insert into public.lideres (email, nome, usuario_id)
-- select u.email, upper(split_part(u.email, '@', 1)), u.id
-- from auth.users u
-- where u.email in ('lma@isudapp.netlify.app', 'adm@isudapp.netlify.app')
--   and u.last_sign_in_at is null and u.email_confirmed_at is not null
-- on conflict (email) do update set usuario_id = excluded.usuario_id, nome = excluded.nome;
--
-- insert into public.senhas_provisorias (id)
-- select id from auth.users
-- where email = 'lma@isudapp.netlify.app'
--   and last_sign_in_at is null and email_confirmed_at is not null
-- on conflict (id) do nothing;

-- Conferência: LMA e ADM devem aparecer, com usuario_id preenchido.
-- select email, nome, usuario_id from public.lideres;

-- =============================================================================
-- DEPOIS
--
-- Senha de líder: o LMA troca pelo próprio app (toque no nome, no topo).
-- Esqueceu? O painel não define senha — só manda e-mail de recuperação, que
-- não chega a lma@isudapp.netlify.app. Dê uma provisória por aqui (troque a
-- senha e o e-mail) e o app pede outra no login:
--
-- update auth.users
--    set encrypted_password = extensions.crypt('provisoria-123', extensions.gen_salt('bf', 10)),
--        updated_at = now()
--  where email = 'lma@isudapp.netlify.app';
-- insert into public.senhas_provisorias (id)
-- select id from auth.users where email = 'lma@isudapp.netlify.app'
-- on conflict (id) do nothing;
--
-- Senha de membro esquecida: Configurações -> Membros -> "Senha provisória".
-- O membro entra com ela e o app pede uma nova.
--
-- Líder novo: crie a conta no painel (ela nasce sem login), troque os
-- e-mails no bloco B e rode ANTES de a pessoa entrar. Tirar o acesso:
--   delete from public.lideres where email = '...';
-- =============================================================================
