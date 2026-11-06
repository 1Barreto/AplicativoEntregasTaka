-- =====================================================================
--  TAKA ÁGUA — Melhorias 1: loja online, custo/lucro, financeiro
--
--  Como usar: depois do schema.sql, abra o SQL Editor do Supabase,
--  cole este arquivo inteiro e clique em "Run". Pode rodar mais de uma
--  vez sem problema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CONFIGURAÇÕES NOVAS
-- ---------------------------------------------------------------------
alter table public.configuracoes
  add column if not exists cidade            text not null default '',     -- ajuda o mapa a achar o endereço
  add column if not exists dias_trabalho_mes int  not null default 26,      -- para a meta diária
  add column if not exists loja_ativa        boolean not null default false,
  add column if not exists loja_aviso        text not null default '',     -- promoção / recado na loja
  add column if not exists loja_whatsapp     text not null default '';     -- WhatsApp do negócio

grant update (cidade, dias_trabalho_mes, loja_ativa, loja_aviso, loja_whatsapp)
  on public.configuracoes to authenticated;

-- ---------------------------------------------------------------------
-- 2. CUSTO DOS PRODUTOS (só o admin vê)
-- ---------------------------------------------------------------------
create table if not exists public.custos_produto (
  produto_id     uuid primary key references public.produtos(id),
  custo_unitario numeric(12,2) not null check (custo_unitario >= 0),
  detalhe        jsonb,                         -- conta usada na calculadora
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now()
);
alter table public.custos_produto enable row level security;
drop policy if exists custos_admin on public.custos_produto;
create policy custos_admin on public.custos_produto for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());
grant select, insert, update, delete on public.custos_produto to authenticated;

drop trigger if exists trg_carimbo on public.custos_produto;
create trigger trg_carimbo before insert or update on public.custos_produto
  for each row execute function public.carimbar_atualizacao();
drop trigger if exists trg_auditoria on public.custos_produto;
create trigger trg_auditoria after insert or update or delete on public.custos_produto
  for each row execute function public.auditar();

-- ---------------------------------------------------------------------
-- 3. CONTAS A PAGAR (despesas) — só o admin
-- ---------------------------------------------------------------------
create table if not exists public.despesas (
  id             uuid primary key default gen_random_uuid(),
  descricao      text not null check (trim(descricao) <> ''),
  categoria      text not null default 'outros',
  valor          numeric(12,2) not null check (valor > 0),
  vencimento     date not null,
  pago_em        date,
  fixa           boolean not null default false,   -- repete todo mês
  observacao     text not null default '',
  criado_por     uuid references public.perfis(id) default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_por uuid,
  atualizado_em  timestamptz
);
create index if not exists despesas_venc_idx on public.despesas (vencimento);
alter table public.despesas enable row level security;
drop policy if exists despesas_admin on public.despesas;
create policy despesas_admin on public.despesas for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());
grant select, insert, update, delete on public.despesas to authenticated;

drop trigger if exists trg_carimbo on public.despesas;
create trigger trg_carimbo before update on public.despesas
  for each row execute function public.carimbar_atualizacao();
drop trigger if exists trg_auditoria on public.despesas;
create trigger trg_auditoria after update or delete on public.despesas
  for each row execute function public.auditar();

-- ---------------------------------------------------------------------
-- 4. LOJA ONLINE (pedido feito pelo próprio cliente)
-- ---------------------------------------------------------------------
-- Pedidos e clientes criados pela loja não têm um usuário da equipe.
alter table public.pedidos  alter column criado_por drop not null;
alter table public.clientes alter column criado_por drop not null;
alter table public.pedidos
  add column if not exists origem text not null default 'app';
do $$ begin
  alter table public.pedidos add constraint pedidos_origem_chk check (origem in ('app','loja'));
exception when duplicate_object then null; end $$;

-- Só dígitos, sem o 55 do Brasil: "(74) 98113-2047" -> "74981132047"
create or replace function public._tel(p text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^(55)(\d{10,11})$', '\2')
$$;

-- Dados públicos da loja (nome, recado e produtos com preço)
create or replace function public.loja_dados() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'aberta', c.loja_ativa,
    'nome', c.nome_negocio,
    'aviso', c.loja_aviso,
    'whatsapp', c.loja_whatsapp,
    'produtos', case when c.loja_ativa then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'preco', p.preco_padrao) order by p.ordem, p.nome)
        from public.produtos p where p.ativo), '[]'::jsonb) else '[]'::jsonb end)
  from public.configuracoes c where c.id = 1
$$;

-- O telefone já é cliente? (devolve só sim/não, para não expor dados)
create or replace function public.loja_conhece(p_telefone text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v text := public._tel(p_telefone);
begin
  if length(v) < 10 or not (select loja_ativa from public.configuracoes where id = 1) then return false; end if;
  return exists (select 1 from public.clientes where ativo and public._tel(telefone) = v);
end $$;

-- Cria o pedido. p_itens: [{"produto_id": "...", "quantidade": 2}]
create or replace function public.loja_pedido(
  p_telefone text, p_nome text, p_endereco text, p_bairro text, p_itens jsonb, p_obs text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tel text := public._tel(p_telefone);
  v_cli uuid;
  v_novo boolean := false;
  v_item jsonb;
  v_qtd int;
  v_prod uuid;
  v_n int := 0;
  v_obs text := left(trim(coalesce(p_obs, '')), 300);
begin
  perform public._exigir((select loja_ativa from public.configuracoes where id = 1), 'A loja está fechada no momento.');
  perform public._exigir(length(v_tel) between 10 and 11, 'Informe um telefone com DDD.');
  perform public._exigir(jsonb_typeof(p_itens) = 'array' and jsonb_array_length(p_itens) between 1 and 10, 'Escolha ao menos um produto.');
  -- trava contra abuso: no máximo 40 pedidos da loja por hora
  perform public._exigir((select count(*) from public.pedidos where origem = 'loja' and criado_em > now() - interval '1 hour') < 40,
    'Muitos pedidos agora. Tente em alguns minutos ou chame no WhatsApp.');

  select id into v_cli from public.clientes where ativo and public._tel(telefone) = v_tel order by criado_em limit 1;
  if v_cli is null then
    perform public._exigir(length(trim(coalesce(p_nome, ''))) >= 2, 'Informe seu nome.');
    perform public._exigir(length(trim(coalesce(p_endereco, ''))) >= 4, 'Informe o endereço de entrega.');
    insert into public.clientes (nome, telefone, endereco, bairro, observacoes, criado_por)
    values (left(trim(p_nome), 80), v_tel, left(trim(p_endereco), 150), left(trim(coalesce(p_bairro, '')), 60),
            'Cadastrado pela loja online', null)
    returning id into v_cli;
    v_novo := true;
  else
    perform public._exigir((select count(*) from public.pedidos where cliente_id = v_cli and origem = 'loja'
                             and status in ('pendente','em_rota')) < 3,
      'Você já tem pedidos em andamento. Aguarde a entrega ou chame no WhatsApp.');
    -- endereço diferente do cadastro vai na observação do pedido
    if length(trim(coalesce(p_endereco, ''))) >= 4 then
      v_obs := left(trim('Entregar em: ' || trim(p_endereco) || coalesce(' - ' || nullif(trim(p_bairro), ''), '') || '. ' || v_obs), 300);
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_qtd := coalesce((v_item->>'quantidade')::int, 0);
    v_prod := (v_item->>'produto_id')::uuid;
    continue when v_qtd <= 0;
    perform public._exigir(v_qtd <= 20, 'Para mais de 20 unidades, chame no WhatsApp.');
    perform public._exigir(exists (select 1 from public.produtos where id = v_prod and ativo), 'Produto indisponível.');
    insert into public.pedidos (cliente_id, produto_id, quantidade, observacao, status, origem, criado_por)
    values (v_cli, v_prod, v_qtd, v_obs, 'pendente', 'loja', null);
    v_n := v_n + 1;
  end loop;
  perform public._exigir(v_n > 0, 'Escolha ao menos um produto.');
  return jsonb_build_object('ok', true, 'pedidos', v_n, 'cliente_novo', v_novo);
end $$;

revoke execute on function public._tel(text) from public;
revoke execute on function public.loja_dados(), public.loja_conhece(text),
  public.loja_pedido(text, text, text, text, jsonb, text) from public;
grant execute on function public.loja_dados(), public.loja_conhece(text),
  public.loja_pedido(text, text, text, text, jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. TEMPO REAL das tabelas novas
-- ---------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.despesas, public.custos_produto;
exception when duplicate_object then null; end $$;
