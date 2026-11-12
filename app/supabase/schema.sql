-- Relatório de Turno: esquema do servidor (Supabase / PostgreSQL).
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute uma vez.
--
-- Modelo de segurança:
--  * As tabelas têm RLS ligado e NENHUMA política: a chave pública (anon) não lê nem grava nada nelas.
--  * Todo acesso passa pelas funções rt_* (SECURITY DEFINER), que exigem o código da equipe.
--  * O código da equipe é gerado no servidor, guardado só como hash SHA-256 e compartilhado
--    pela própria equipe (ex.: no grupo do WhatsApp). Quem tem o código é membro.

create table if not exists public.rt_equipes (
  id          uuid primary key default gen_random_uuid(),
  codigo_hash text not null unique,
  nome        text not null,
  criado_em   timestamptz not null default now()
);

create table if not exists public.rt_turnos (
  id        text primary key,
  equipe_id uuid not null references public.rt_equipes(id) on delete cascade,
  dados     jsonb not null,
  encerrado boolean not null default false,
  at        bigint not null,              -- relógio do aparelho que gravou (ms), para "última gravação vence"
  srv_at    bigint not null default 0     -- relógio do servidor (ms), cursor de sincronização
);
create index if not exists rt_turnos_eq_srv on public.rt_turnos (equipe_id, srv_at);
create index if not exists rt_turnos_eq_aberto on public.rt_turnos (equipe_id) where not encerrado;

create table if not exists public.rt_ocorrencias (
  id        text primary key,
  turno_id  text not null references public.rt_turnos(id) on delete cascade,
  equipe_id uuid not null references public.rt_equipes(id) on delete cascade,
  dados     jsonb not null,
  excluido  boolean not null default false,
  at        bigint not null,
  srv_at    bigint not null default 0
);
create index if not exists rt_occ_eq_srv on public.rt_ocorrencias (equipe_id, srv_at);

create table if not exists public.rt_pendencias (
  id        text primary key,
  turno_id  text not null references public.rt_turnos(id) on delete cascade,
  equipe_id uuid not null references public.rt_equipes(id) on delete cascade,
  dados     jsonb not null,
  excluido  boolean not null default false,
  at        bigint not null,
  srv_at    bigint not null default 0
);
create index if not exists rt_pend_eq_srv on public.rt_pendencias (equipe_id, srv_at);

alter table public.rt_equipes     enable row level security;
alter table public.rt_turnos      enable row level security;
alter table public.rt_ocorrencias enable row level security;
alter table public.rt_pendencias  enable row level security;
revoke all on public.rt_equipes, public.rt_turnos, public.rt_ocorrencias, public.rt_pendencias from anon, authenticated, public;

-- srv_at sempre com o relógio do servidor
create or replace function public.rt_srv_at() returns trigger language plpgsql as $$
begin
  new.srv_at := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end $$;
drop trigger if exists rt_turnos_srv on public.rt_turnos;
create trigger rt_turnos_srv before insert or update on public.rt_turnos for each row execute function public.rt_srv_at();
drop trigger if exists rt_occ_srv on public.rt_ocorrencias;
create trigger rt_occ_srv before insert or update on public.rt_ocorrencias for each row execute function public.rt_srv_at();
drop trigger if exists rt_pend_srv on public.rt_pendencias;
create trigger rt_pend_srv before insert or update on public.rt_pendencias for each row execute function public.rt_srv_at();

-- ---------- helpers internos (não expostos) ----------
create or replace function public.rt_hash(codigo text) returns text language sql immutable as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(codigo,''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex')
$$;

create or replace function public.rt_equipe_id(codigo text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.rt_equipes where codigo_hash = public.rt_hash(codigo);
  if v is null then raise exception 'codigo-invalido' using errcode = 'P0001'; end if;
  return v;
end $$;

-- ---------- API ----------
-- Cria uma equipe e devolve o código (a única vez em que ele aparece em texto puro).
create or replace function public.rt_criar_equipe(nome text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; codigo text := ''; i int; n text;
begin
  n := left(trim(coalesce(nome, '')), 60);
  if n = '' then raise exception 'nome-obrigatorio'; end if;
  for i in 1..8 loop codigo := codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1); end loop;
  insert into public.rt_equipes (codigo_hash, nome) values (public.rt_hash(codigo), n);
  return jsonb_build_object('codigo', substr(codigo, 1, 4) || '-' || substr(codigo, 5, 4), 'nome', n);
end $$;

create or replace function public.rt_entrar(codigo text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e record;
begin
  select id, nome into e from public.rt_equipes where id = public.rt_equipe_id(codigo);
  return jsonb_build_object('nome', e.nome);
end $$;

-- Inicia um turno. Se a equipe já tem um turno aberto, devolve esse em vez de criar outro.
create or replace function public.rt_iniciar_turno(codigo text, turno jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare eq uuid; aberto record;
begin
  eq := public.rt_equipe_id(codigo);
  perform pg_advisory_xact_lock(hashtext(eq::text));
  select id, dados, at into aberto from public.rt_turnos where equipe_id = eq and not encerrado order by (dados->>'criadoEm')::bigint desc nulls last limit 1;
  if aberto.id is not null then
    return jsonb_build_object('existente', true, 'turno', aberto.dados || jsonb_build_object('id', aberto.id, 'at', aberto.at));
  end if;
  insert into public.rt_turnos (id, equipe_id, dados, encerrado, at)
    values (turno->>'id', eq, turno - 'ocorrencias' - 'pendencias', false, coalesce((turno->>'at')::bigint, 0));
  return jsonb_build_object('existente', false, 'turno', turno);
end $$;

-- Grava alterações vindas de um aparelho. Para cada registro vale a gravação mais recente (campo at).
create or replace function public.rt_push(codigo text, turnos jsonb default '[]', occs jsonb default '[]', pends jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public as $$
declare eq uuid; r jsonb; n int := 0;
begin
  eq := public.rt_equipe_id(codigo);
  for r in select * from jsonb_array_elements(coalesce(turnos, '[]')) loop
    insert into public.rt_turnos (id, equipe_id, dados, encerrado, at)
      values (r->>'id', eq, r - 'ocorrencias' - 'pendencias', coalesce(r->>'encerradoEm', '') <> '', coalesce((r->>'at')::bigint, 0))
    on conflict (id) do update set
      -- "prontos" (quem já confirmou seus lançamentos) é unido, nunca sobrescrito
      dados = (excluded.dados) || jsonb_build_object('prontos', (
        select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from (
          select jsonb_array_elements_text(coalesce(public.rt_turnos.dados->'prontos', '[]')) x
          union select jsonb_array_elements_text(coalesce(excluded.dados->'prontos', '[]'))) s)),
      encerrado = excluded.encerrado, at = excluded.at
    where public.rt_turnos.equipe_id = eq and excluded.at >= public.rt_turnos.at;
    n := n + 1;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(occs, '[]')) loop
    continue when not exists (select 1 from public.rt_turnos where id = r->>'turnoId' and equipe_id = eq);
    insert into public.rt_ocorrencias (id, turno_id, equipe_id, dados, excluido, at)
      values (r->>'id', r->>'turnoId', eq, r - 'turnoId', coalesce((r->>'excluido')::boolean, false), coalesce((r->>'at')::bigint, 0))
    on conflict (id) do update set dados = excluded.dados, excluido = excluded.excluido, at = excluded.at
    where public.rt_ocorrencias.equipe_id = eq and excluded.at >= public.rt_ocorrencias.at;
    n := n + 1;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(pends, '[]')) loop
    continue when not exists (select 1 from public.rt_turnos where id = r->>'turnoId' and equipe_id = eq);
    insert into public.rt_pendencias (id, turno_id, equipe_id, dados, excluido, at)
      values (r->>'id', r->>'turnoId', eq, r - 'turnoId', coalesce((r->>'excluido')::boolean, false), coalesce((r->>'at')::bigint, 0))
    on conflict (id) do update set dados = excluded.dados, excluido = excluded.excluido, at = excluded.at
    where public.rt_pendencias.equipe_id = eq and excluded.at >= public.rt_pendencias.at;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- Devolve tudo o que mudou na equipe depois de "desde" (srv_at). Na primeira vez (desde = 0) traz os últimos 120 dias.
create or replace function public.rt_pull(codigo text, desde bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare eq uuid; agora bigint; corte bigint;
begin
  eq := public.rt_equipe_id(codigo);
  agora := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  corte := case when coalesce(desde, 0) > 0 then 0 else agora - 120::bigint * 86400000 end;
  return jsonb_build_object(
    'agora', agora,
    'turnos', coalesce((select jsonb_agg(t.dados || jsonb_build_object('id', t.id, 'at', t.at) order by t.srv_at)
                        from public.rt_turnos t where t.equipe_id = eq and t.srv_at > desde and (corte = 0 or coalesce((t.dados->>'criadoEm')::bigint, agora) > corte)), '[]'),
    'occs', coalesce((select jsonb_agg(o.dados || jsonb_build_object('id', o.id, 'turnoId', o.turno_id, 'at', o.at, 'excluido', o.excluido) order by o.srv_at)
                      from public.rt_ocorrencias o join public.rt_turnos t on t.id = o.turno_id
                      where o.equipe_id = eq and o.srv_at > desde and (corte = 0 or coalesce((t.dados->>'criadoEm')::bigint, agora) > corte)), '[]'),
    'pends', coalesce((select jsonb_agg(p.dados || jsonb_build_object('id', p.id, 'turnoId', p.turno_id, 'at', p.at, 'excluido', p.excluido) order by p.srv_at)
                       from public.rt_pendencias p join public.rt_turnos t on t.id = p.turno_id
                       where p.equipe_id = eq and p.srv_at > desde and (corte = 0 or coalesce((t.dados->>'criadoEm')::bigint, agora) > corte)), '[]'));
end $$;

-- Permissões: só as funções da API ficam acessíveis à chave pública.
revoke all on function public.rt_hash(text), public.rt_equipe_id(text), public.rt_srv_at() from public, anon, authenticated;
grant execute on function public.rt_criar_equipe(text), public.rt_entrar(text), public.rt_iniciar_turno(text, jsonb),
  public.rt_push(text, jsonb, jsonb, jsonb), public.rt_pull(text, bigint) to anon, authenticated;
