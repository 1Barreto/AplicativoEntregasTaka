-- =====================================================================
--  TAKA ÁGUA — Esquema do banco (Supabase / PostgreSQL)
--  Versão 1
--
--  Como usar: no painel do Supabase, abra "SQL Editor" > "New query",
--  cole este arquivo inteiro e clique em "Run". Rode UMA vez num
--  projeto novo.
--
--  Princípios:
--   * Ninguém apaga nem altera lançamentos (movimentações, entregas,
--     pagamentos). Correção = novo lançamento de ajuste, com motivo.
--   * Estoque, carga, vasilhames e fiado são CALCULADOS a partir dos
--     lançamentos (views), nunca guardados como um número solto.
--   * Toda gravação importante passa por funções (RPC) que conferem o
--     perfil de quem chama e são idempotentes: o celular gera um id
--     para cada operação; se a mesma operação chegar duas vezes
--     (sincronização offline), a segunda é ignorada.
--   * Row Level Security liga em todas as tabelas.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. PERFIS, CONVITES E FUNÇÕES DE PERMISSÃO
-- ---------------------------------------------------------------------

create table public.perfis (
  id          uuid primary key references auth.users(id) on delete restrict,
  nome        text not null default '',
  email       text not null,
  papel       text not null default 'entregador'
              check (papel in ('admin','entregador','estoquista','atendente')),
  ativo       boolean not null default false,
  criado_em   timestamptz not null default now(),
  atualizado_por uuid,
  atualizado_em  timestamptz
);

-- O admin cadastra aqui e-mail + papel ANTES de convidar a pessoa.
-- Quando a conta é criada, o perfil já nasce ativo com esse papel.
-- Conta criada sem convite nasce INATIVA (não vê nada).
create table public.convites (
  email      text primary key check (email = lower(email)),
  nome       text not null default '',
  papel      text not null check (papel in ('admin','entregador','estoquista','atendente')),
  criado_por uuid default auth.uid(),
  criado_em  timestamptz not null default now()
);

create or replace function public.meu_papel() returns text
language sql stable security definer set search_path = public as $$
  select papel from public.perfis where id = auth.uid() and ativo
$$;

create or replace function public.eh_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select public.meu_papel() is not null
$$;

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.meu_papel() = 'admin', false)
$$;

create or replace function public.tem_papel(variadic p_papeis text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.meu_papel() = any(p_papeis), false)
$$;

create or replace function public.ao_criar_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.convites%rowtype;
begin
  select * into c from public.convites where email = lower(new.email);
  insert into public.perfis (id, email, nome, papel, ativo)
  values (new.id, lower(new.email), coalesce(c.nome, ''),
          coalesce(c.papel, 'entregador'), c.email is not null);
  return new;
end $$;

create trigger trg_ao_criar_usuario
  after insert on auth.users
  for each row execute function public.ao_criar_usuario();

-- ---------------------------------------------------------------------
-- 2. CADASTROS
-- ---------------------------------------------------------------------

create table public.configuracoes (
  id                  int primary key default 1 check (id = 1),
  nome_negocio        text not null default 'Minha Distribuidora de Água',
  chave_pix           text not null default '',
  nome_recebedor_pix  text not null default '',
  msg_cobranca        text not null default
    'Olá, {nome}! Tudo bem? Passando para lembrar do valor de {valor} referente às entregas de água. Se puder, o Pix é: {pix}. Obrigado! {negocio}',
  msg_oferta          text not null default
    'Olá, {nome}! Tudo bem? Aqui é da {negocio}. Já está precisando de água? Posso levar hoje!',
  dias_aviso_recorrente int not null default 2,
  atualizado_por      uuid,
  atualizado_em       timestamptz
);
insert into public.configuracoes default values;

create table public.produtos (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  preco_padrao    numeric(12,2) not null check (preco_padrao >= 0),
  retornavel      boolean not null default true,     -- tem vasilhame?
  estoque_minimo  int not null default 0,            -- alerta de estoque baixo
  ordem           int not null default 0,            -- ordem dos botões
  ativo           boolean not null default true,
  criado_por      uuid references public.perfis(id) default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_por  uuid,
  atualizado_em   timestamptz
);

create table public.clientes (
  id              uuid primary key default gen_random_uuid(),  -- o app manda o id (offline)
  nome            text not null,
  telefone        text not null default '',
  endereco        text not null default '',
  bairro          text not null default '',
  observacoes     text not null default '',
  ativo           boolean not null default true,
  criado_por      uuid not null references public.perfis(id) default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_por  uuid,
  atualizado_em   timestamptz
);
create index clientes_nome_idx   on public.clientes (lower(nome));
create index clientes_bairro_idx on public.clientes (lower(bairro));

create table public.precos_cliente (
  cliente_id     uuid not null references public.clientes(id),
  produto_id     uuid not null references public.produtos(id),
  preco          numeric(12,2) not null check (preco >= 0),
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now(),
  primary key (cliente_id, produto_id)
);

-- ---------------------------------------------------------------------
-- 3. LANÇAMENTOS (imutáveis)
-- ---------------------------------------------------------------------

-- Uma linha por operação enviada pelo app. Garante que reenvio não duplica.
create table public.operacoes (
  id            uuid primary key,
  tipo          text not null,
  usuario       uuid not null references public.perfis(id),
  registrado_em timestamptz not null default now()
);

-- Turno do entregador: retirada -> entregas -> devolução -> fechamento.
create table public.turnos (
  id                uuid primary key,
  entregador_id     uuid not null references public.perfis(id),
  iniciado_em       timestamptz not null,
  encerrado_em      timestamptz,                 -- devolução feita
  status            text not null default 'aberto'
                    check (status in ('aberto','enviado','confirmado')),
  dinheiro_contado  numeric(12,2),               -- informado pelo entregador
  obs_entregador    text,
  enviado_em        timestamptz,
  confirmado_por    uuid references public.perfis(id),
  confirmado_em     timestamptz,
  obs_admin         text,
  resumo_confirmado jsonb,                       -- foto dos números na confirmação
  registrado_em     timestamptz not null default now()
);
create unique index turnos_um_aberto_idx on public.turnos (entregador_id) where status = 'aberto';

create table public.pedidos (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id),
  produto_id     uuid references public.produtos(id),
  quantidade     int not null default 1 check (quantidade > 0),
  observacao     text not null default '',
  entregador_id  uuid references public.perfis(id),          -- null = livre
  status         text not null default 'pendente'
                 check (status in ('pendente','em_rota','entregue','cancelado')),
  agendado_para  date,
  criado_por     uuid not null references public.perfis(id) default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_por uuid,
  atualizado_em  timestamptz
);
create index pedidos_status_idx on public.pedidos (status, entregador_id);

create table public.entregas (
  id              uuid primary key,                           -- gerado no celular
  operacao_id     uuid references public.operacoes(id),
  cliente_id      uuid references public.clientes(id),        -- null = venda avulsa
  entregador_id   uuid not null references public.perfis(id),
  turno_id        uuid references public.turnos(id),
  pedido_id       uuid references public.pedidos(id),
  forma_pagamento text not null check (forma_pagamento in ('pix','dinheiro','cartao','fiado')),
  valor_total     numeric(12,2) not null,
  estorno_de      uuid unique references public.entregas(id), -- preenchido só no estorno
  motivo          text,
  ocorrido_em     timestamptz not null,                       -- hora no celular
  criado_por      uuid not null references public.perfis(id) default auth.uid(),
  registrado_em   timestamptz not null default now(),         -- hora que chegou no servidor
  check (forma_pagamento <> 'fiado' or cliente_id is not null)
);
create index entregas_cliente_idx on public.entregas (cliente_id, ocorrido_em);
create index entregas_turno_idx   on public.entregas (turno_id);
create index entregas_data_idx    on public.entregas (ocorrido_em);

create table public.entrega_itens (
  id               uuid primary key default gen_random_uuid(),
  entrega_id       uuid not null references public.entregas(id),
  produto_id       uuid not null references public.produtos(id),
  quantidade       int not null,
  preco_unitario   numeric(12,2) not null,
  vazios_recebidos int not null default 0
);
create index entrega_itens_entrega_idx on public.entrega_itens (entrega_id);

-- Livro-razão do estoque. O app informa tipo + quantidades; o gatilho
-- calcula o efeito em cada lugar (depósito, entregador, cliente).
create table public.movimentacoes (
  id             uuid primary key default gen_random_uuid(),
  operacao_id    uuid references public.operacoes(id),
  tipo           text not null check (tipo in
                   ('entrada','saida_vazios','retirada','devolucao','venda','ajuste')),
  produto_id     uuid not null references public.produtos(id),
  qtd_cheios     int not null default 0,
  qtd_vazios     int not null default 0,
  -- efeitos (+ entra, - sai)
  dep_cheios     int not null default 0,
  dep_vazios     int not null default 0,
  ent_cheios     int not null default 0,
  ent_vazios     int not null default 0,
  cli_vasilhames int not null default 0,
  entregador_id  uuid references public.perfis(id),
  cliente_id     uuid references public.clientes(id),
  turno_id       uuid references public.turnos(id),
  entrega_id     uuid references public.entregas(id),
  custo_unitario numeric(12,2),
  fornecedor     text,
  motivo         text,
  ocorrido_em    timestamptz not null default now(),
  criado_por     uuid not null references public.perfis(id) default auth.uid(),
  registrado_em  timestamptz not null default now()
);
create index mov_produto_idx    on public.movimentacoes (produto_id);
create index mov_entregador_idx on public.movimentacoes (entregador_id);
create index mov_turno_idx      on public.movimentacoes (turno_id);
create index mov_cliente_idx    on public.movimentacoes (cliente_id);
create index mov_data_idx       on public.movimentacoes (ocorrido_em);

-- Dinheiro que entrou. tipo:
--   na_entrega = pago no ato (pix/dinheiro/cartão)
--   fiado      = pagamento de dívida (total ou parcial)
--   ajuste     = correção do admin no saldo do cliente
--                (valor > 0 abate dívida; valor < 0 lança dívida, ex.: saldo inicial)
create table public.pagamentos (
  id            uuid primary key default gen_random_uuid(),
  operacao_id   uuid references public.operacoes(id),
  cliente_id    uuid references public.clientes(id),
  entrega_id    uuid references public.entregas(id),
  turno_id      uuid references public.turnos(id),
  tipo          text not null check (tipo in ('na_entrega','fiado','ajuste')),
  forma         text check (forma in ('pix','dinheiro','cartao')),
  valor         numeric(12,2) not null,
  recebido_por  uuid not null references public.perfis(id),
  motivo        text,
  estorno_de    uuid unique references public.pagamentos(id),
  ocorrido_em   timestamptz not null,
  criado_por    uuid not null references public.perfis(id) default auth.uid(),
  registrado_em timestamptz not null default now(),
  check (tipo = 'ajuste' or forma is not null)
);
create index pag_cliente_idx on public.pagamentos (cliente_id);
create index pag_turno_idx   on public.pagamentos (turno_id);

-- Estoquista confere retirada/devolução no depósito.
create table public.conferencias (
  id            uuid primary key default gen_random_uuid(),
  turno_id      uuid not null references public.turnos(id),
  etapa         text not null check (etapa in ('retirada','devolucao')),
  ok            boolean not null,
  observacao    text not null default '',
  conferido_por uuid not null references public.perfis(id) default auth.uid(),
  conferido_em  timestamptz not null default now()
);

-- Histórico de alterações em cadastros (quem mudou o quê).
create table public.auditoria (
  id          bigint generated always as identity primary key,
  tabela      text not null,
  registro_id text,
  acao        text not null,
  antes       jsonb,
  depois      jsonb,
  usuario     uuid default auth.uid(),
  em          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. GATILHOS
-- ---------------------------------------------------------------------

-- 4.1 Lançamentos não podem ser alterados nem apagados
create or replace function public.bloquear_alteracao() returns trigger
language plpgsql as $$
begin
  raise exception 'Registros de "%" não podem ser alterados nem apagados. Faça um lançamento de ajuste.', tg_table_name;
end $$;

create trigger trg_imutavel before update or delete on public.operacoes     for each row execute function public.bloquear_alteracao();
create trigger trg_imutavel before update or delete on public.entregas      for each row execute function public.bloquear_alteracao();
create trigger trg_imutavel before update or delete on public.entrega_itens for each row execute function public.bloquear_alteracao();
create trigger trg_imutavel before update or delete on public.movimentacoes for each row execute function public.bloquear_alteracao();
create trigger trg_imutavel before update or delete on public.pagamentos    for each row execute function public.bloquear_alteracao();
create trigger trg_imutavel before update or delete on public.conferencias  for each row execute function public.bloquear_alteracao();
create trigger trg_imutavel before update or delete on public.auditoria     for each row execute function public.bloquear_alteracao();

-- 4.2 Carimbo de quem alterou
create or replace function public.carimbar_atualizacao() returns trigger
language plpgsql as $$
begin
  new.atualizado_por := auth.uid();
  new.atualizado_em  := now();
  return new;
end $$;

create trigger trg_carimbo before update on public.perfis         for each row execute function public.carimbar_atualizacao();
create trigger trg_carimbo before update on public.configuracoes  for each row execute function public.carimbar_atualizacao();
create trigger trg_carimbo before update on public.produtos       for each row execute function public.carimbar_atualizacao();
create trigger trg_carimbo before update on public.clientes       for each row execute function public.carimbar_atualizacao();
create trigger trg_carimbo before update on public.pedidos        for each row execute function public.carimbar_atualizacao();
create trigger trg_carimbo before insert or update on public.precos_cliente for each row execute function public.carimbar_atualizacao();

-- 4.3 Auditoria de cadastros
create or replace function public.auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_novo jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_velho jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_reg  jsonb := coalesce(v_novo, v_velho);
begin
  insert into public.auditoria (tabela, registro_id, acao, antes, depois)
  values (tg_table_name,
          coalesce(v_reg->>'id', v_reg->>'email', (v_reg->>'cliente_id') || '/' || (v_reg->>'produto_id')),
          tg_op, v_velho, v_novo);
  return coalesce(new, old);
end $$;

create trigger trg_auditoria after update or delete on public.perfis                   for each row execute function public.auditar();
create trigger trg_auditoria after insert or update or delete on public.convites       for each row execute function public.auditar();
create trigger trg_auditoria after update on public.configuracoes                      for each row execute function public.auditar();
create trigger trg_auditoria after update on public.produtos                           for each row execute function public.auditar();
create trigger trg_auditoria after update on public.clientes                           for each row execute function public.auditar();
create trigger trg_auditoria after insert or update or delete on public.precos_cliente for each row execute function public.auditar();
create trigger trg_auditoria after update on public.pedidos                            for each row execute function public.auditar();
create trigger trg_auditoria after update on public.turnos                             for each row execute function public.auditar();

-- 4.4 Efeito de cada movimentação no estoque
create or replace function public.calcular_efeitos_mov() returns trigger
language plpgsql as $$
declare v_ret boolean;
begin
  select retornavel into v_ret from public.produtos where id = new.produto_id;
  if v_ret is null then raise exception 'Produto inexistente'; end if;

  if new.tipo <> 'ajuste' then
    if new.qtd_cheios < 0 or new.qtd_vazios < 0 then
      raise exception 'Quantidades não podem ser negativas';
    end if;
    if not v_ret then new.qtd_vazios := 0; end if;
    new.dep_cheios := 0; new.dep_vazios := 0;
    new.ent_cheios := 0; new.ent_vazios := 0; new.cli_vasilhames := 0;
  end if;

  case new.tipo
    when 'entrada' then                       -- chegou do fornecedor
      new.dep_cheios := new.qtd_cheios;
    when 'saida_vazios' then                  -- vazios voltam ao fornecedor
      new.dep_vazios := -new.qtd_vazios;
    when 'retirada' then                      -- depósito -> entregador
      new.dep_cheios := -new.qtd_cheios;
      new.ent_cheios :=  new.qtd_cheios;
    when 'devolucao' then                     -- entregador -> depósito
      new.dep_cheios :=  new.qtd_cheios;
      new.ent_cheios := -new.qtd_cheios;
      new.dep_vazios :=  new.qtd_vazios;
      new.ent_vazios := -new.qtd_vazios;
    when 'venda' then                         -- entregador -> cliente
      new.ent_cheios := -new.qtd_cheios;
      if v_ret then
        new.ent_vazios     := new.qtd_vazios;
        new.cli_vasilhames := new.qtd_cheios - new.qtd_vazios;
      end if;
    when 'ajuste' then                        -- admin informa os efeitos direto
      if coalesce(trim(new.motivo), '') = '' then
        raise exception 'Ajuste precisa de motivo';
      end if;
      if new.cli_vasilhames <> 0 and new.cliente_id is null then
        raise exception 'Ajuste de vasilhame precisa do cliente';
      end if;
  end case;

  if (new.ent_cheios <> 0 or new.ent_vazios <> 0) and new.entregador_id is null then
    raise exception 'Movimentação com entregador precisa informar o entregador';
  end if;
  return new;
end $$;

create trigger trg_efeitos before insert on public.movimentacoes
  for each row execute function public.calcular_efeitos_mov();

-- ---------------------------------------------------------------------
-- 5. FUNÇÕES DE GRAVAÇÃO (RPC) — chamadas pelo app
-- ---------------------------------------------------------------------

-- Registra a operação; devolve false se ela já foi processada.
create or replace function public._nova_operacao(p_op uuid, p_tipo text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_op is null then raise exception 'Operação sem id'; end if;
  insert into public.operacoes (id, tipo, usuario) values (p_op, p_tipo, auth.uid())
  on conflict (id) do nothing;
  return found;
end $$;

create or replace function public._quando(p timestamptz) returns timestamptz
language sql stable as $$ select least(coalesce(p, now()), now()) $$;

create or replace function public._exigir(p_ok boolean, p_msg text) returns void
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_msg; end if;
end $$;

-- Entrada do fornecedor / saída de vazios para o fornecedor
-- p_itens: [{"produto_id": "...", "qtd": 10, "custo": 8.50}]
create or replace function public.registrar_mov_deposito(
  p_op uuid, p_tipo text, p_itens jsonb, p_fornecedor text default null,
  p_quando timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  perform _exigir(tem_papel('admin','estoquista'), 'Sem permissão');
  perform _exigir(p_tipo in ('entrada','saida_vazios'), 'Tipo inválido');
  if not _nova_operacao(p_op, p_tipo) then return; end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    insert into movimentacoes (operacao_id, tipo, produto_id, qtd_cheios, qtd_vazios,
                               custo_unitario, fornecedor, ocorrido_em)
    values (p_op, p_tipo, (it->>'produto_id')::uuid,
            case when p_tipo = 'entrada' then (it->>'qtd')::int else 0 end,
            case when p_tipo = 'saida_vazios' then (it->>'qtd')::int else 0 end,
            nullif(it->>'custo','')::numeric, p_fornecedor, _quando(p_quando));
  end loop;
end $$;

-- Início do turno com a primeira carga. p_itens: [{"produto_id": "...", "qtd": 20}]
create or replace function public.iniciar_turno(
  p_op uuid, p_turno_id uuid, p_itens jsonb, p_quando timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  perform _exigir(tem_papel('admin','entregador'), 'Sem permissão');
  if not _nova_operacao(p_op, 'iniciar_turno') then return p_turno_id; end if;
  perform _exigir(not exists (select 1 from turnos where entregador_id = auth.uid() and status = 'aberto'),
                  'Você já tem um turno aberto');
  insert into turnos (id, entregador_id, iniciado_em) values (p_turno_id, auth.uid(), _quando(p_quando));
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    if (it->>'qtd')::int > 0 then
      insert into movimentacoes (operacao_id, tipo, produto_id, qtd_cheios, entregador_id, turno_id, ocorrido_em)
      values (p_op, 'retirada', (it->>'produto_id')::uuid, (it->>'qtd')::int, auth.uid(), p_turno_id, _quando(p_quando));
    end if;
  end loop;
  return p_turno_id;
end $$;

-- Retirada extra no meio do turno (reabastecer)
create or replace function public.registrar_retirada(
  p_op uuid, p_turno_id uuid, p_itens jsonb, p_quando timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  perform _exigir(tem_papel('admin','entregador'), 'Sem permissão');
  if not _nova_operacao(p_op, 'retirada') then return; end if;
  perform _exigir(exists (select 1 from turnos where id = p_turno_id and entregador_id = auth.uid() and status = 'aberto'),
                  'Turno não encontrado ou já fechado');
  for it in select * from jsonb_array_elements(p_itens) loop
    if (it->>'qtd')::int > 0 then
      insert into movimentacoes (operacao_id, tipo, produto_id, qtd_cheios, entregador_id, turno_id, ocorrido_em)
      values (p_op, 'retirada', (it->>'produto_id')::uuid, (it->>'qtd')::int, auth.uid(), p_turno_id, _quando(p_quando));
    end if;
  end loop;
end $$;

-- Devolução no fim do turno. p_itens: [{"produto_id": "...", "cheios": 3, "vazios": 15}]
create or replace function public.registrar_devolucao(
  p_op uuid, p_turno_id uuid, p_itens jsonb, p_quando timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  perform _exigir(tem_papel('admin','entregador'), 'Sem permissão');
  if not _nova_operacao(p_op, 'devolucao') then return; end if;
  perform _exigir(exists (select 1 from turnos where id = p_turno_id and entregador_id = auth.uid() and status = 'aberto'),
                  'Turno não encontrado ou já fechado');
  for it in select * from jsonb_array_elements(p_itens) loop
    if coalesce((it->>'cheios')::int,0) > 0 or coalesce((it->>'vazios')::int,0) > 0 then
      insert into movimentacoes (operacao_id, tipo, produto_id, qtd_cheios, qtd_vazios, entregador_id, turno_id, ocorrido_em)
      values (p_op, 'devolucao', (it->>'produto_id')::uuid,
              coalesce((it->>'cheios')::int,0), coalesce((it->>'vazios')::int,0),
              auth.uid(), p_turno_id, _quando(p_quando));
    end if;
  end loop;
  update turnos set encerrado_em = _quando(p_quando) where id = p_turno_id;
end $$;

-- Entrega (a operação mais usada). p_entrega:
-- {"id": "...", "cliente_id": "...", "turno_id": "...", "pedido_id": null,
--  "forma_pagamento": "pix", "ocorrido_em": "2026-11-06T10:00:00-03:00",
--  "itens": [{"produto_id": "...", "quantidade": 2, "vazios": 2}]}
-- O preço é calculado aqui (preço do cliente ou padrão), nunca vem do celular.
create or replace function public.registrar_entrega(p_op uuid, p_entrega jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := (p_entrega->>'id')::uuid;
  v_cli    uuid := nullif(p_entrega->>'cliente_id','')::uuid;
  v_turno  uuid := nullif(p_entrega->>'turno_id','')::uuid;
  v_pedido uuid := nullif(p_entrega->>'pedido_id','')::uuid;
  v_forma  text := p_entrega->>'forma_pagamento';
  v_quando timestamptz := _quando(nullif(p_entrega->>'ocorrido_em','')::timestamptz);
  v_total  numeric(12,2) := 0;
  v_preco  numeric(12,2);
  v_qtd    int;
  v_vaz    int;
  it       jsonb;
begin
  perform _exigir(tem_papel('admin','entregador'), 'Sem permissão');
  if not _nova_operacao(p_op, 'entrega') then return v_id; end if;
  perform _exigir(exists (select 1 from turnos where id = v_turno and entregador_id = auth.uid()
                          and status <> 'confirmado'), 'Abra um turno (Minha carga) antes de entregar');
  perform _exigir(jsonb_array_length(coalesce(p_entrega->'itens','[]')) > 0, 'Entrega sem produto');

  -- 1ª passada: valida e soma
  for it in select * from jsonb_array_elements(p_entrega->'itens') loop
    v_qtd := coalesce((it->>'quantidade')::int, 0);
    v_vaz := coalesce((it->>'vazios')::int, 0);
    perform _exigir(v_qtd >= 0 and v_vaz >= 0 and (v_qtd > 0 or v_vaz > 0), 'Quantidade inválida');
    select coalesce(pc.preco, p.preco_padrao) into v_preco
      from produtos p
      left join precos_cliente pc on pc.produto_id = p.id and pc.cliente_id = v_cli
     where p.id = (it->>'produto_id')::uuid;
    perform _exigir(v_preco is not null, 'Produto inexistente');
    v_total := v_total + v_qtd * v_preco;
  end loop;

  insert into entregas (id, operacao_id, cliente_id, entregador_id, turno_id, pedido_id,
                        forma_pagamento, valor_total, ocorrido_em)
  values (v_id, p_op, v_cli, auth.uid(), v_turno, v_pedido, v_forma, v_total, v_quando);

  -- 2ª passada: itens e estoque
  for it in select * from jsonb_array_elements(p_entrega->'itens') loop
    v_qtd := coalesce((it->>'quantidade')::int, 0);
    v_vaz := coalesce((it->>'vazios')::int, 0);
    select coalesce(pc.preco, p.preco_padrao) into v_preco
      from produtos p
      left join precos_cliente pc on pc.produto_id = p.id and pc.cliente_id = v_cli
     where p.id = (it->>'produto_id')::uuid;
    insert into entrega_itens (entrega_id, produto_id, quantidade, preco_unitario, vazios_recebidos)
    values (v_id, (it->>'produto_id')::uuid, v_qtd, v_preco, v_vaz);
    insert into movimentacoes (operacao_id, tipo, produto_id, qtd_cheios, qtd_vazios,
                               entregador_id, cliente_id, turno_id, entrega_id, ocorrido_em)
    values (p_op, 'venda', (it->>'produto_id')::uuid, v_qtd, v_vaz,
            auth.uid(), v_cli, v_turno, v_id, v_quando);
  end loop;

  if v_forma <> 'fiado' and v_total > 0 then
    insert into pagamentos (operacao_id, cliente_id, entrega_id, turno_id, tipo, forma, valor, recebido_por, ocorrido_em)
    values (p_op, v_cli, v_id, v_turno, 'na_entrega', v_forma, v_total, auth.uid(), v_quando);
  end if;

  if v_pedido is not null then
    update pedidos set status = 'entregue', entregador_id = coalesce(entregador_id, auth.uid())
     where id = v_pedido and status <> 'cancelado';
  end if;
  return v_id;
end $$;

-- Pagamento de fiado (total ou parcial)
create or replace function public.receber_pagamento(
  p_op uuid, p_cliente_id uuid, p_valor numeric, p_forma text,
  p_turno_id uuid default null, p_quando timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _exigir(tem_papel('admin','entregador','atendente'), 'Sem permissão');
  perform _exigir(p_valor > 0, 'Valor deve ser maior que zero');
  perform _exigir(p_forma in ('pix','dinheiro','cartao'), 'Forma de pagamento inválida');
  if not _nova_operacao(p_op, 'pagamento') then return; end if;
  if p_turno_id is not null then
    perform _exigir(exists (select 1 from turnos where id = p_turno_id and entregador_id = auth.uid()
                            and status <> 'confirmado'), 'Turno inválido');
  end if;
  insert into pagamentos (operacao_id, cliente_id, turno_id, tipo, forma, valor, recebido_por, ocorrido_em)
  values (p_op, p_cliente_id, p_turno_id, 'fiado', p_forma, round(p_valor, 2), auth.uid(), _quando(p_quando));
end $$;

-- Entregador envia o fechamento do turno
create or replace function public.enviar_fechamento(
  p_turno_id uuid, p_dinheiro_contado numeric, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _exigir(tem_papel('admin','entregador'), 'Sem permissão');
  update turnos
     set status = 'enviado', dinheiro_contado = round(p_dinheiro_contado, 2),
         obs_entregador = p_obs, enviado_em = now(),
         encerrado_em = coalesce(encerrado_em, now())
   where id = p_turno_id and entregador_id = auth.uid() and status = 'aberto';
  -- se já estava enviado (reenvio offline), não faz nada
end $$;

-- Admin confere e confirma o fechamento
create or replace function public.confirmar_fechamento(p_turno_id uuid, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_resumo jsonb;
begin
  perform _exigir(eh_admin(), 'Só o admin confirma fechamentos');
  select to_jsonb(r) into v_resumo from v_resumo_turno r where r.turno_id = p_turno_id;
  v_resumo := v_resumo || jsonb_build_object('produtos',
    (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from v_conferencia_turno c where c.turno_id = p_turno_id));
  update turnos set status = 'confirmado', confirmado_por = auth.uid(), confirmado_em = now(),
                    obs_admin = p_obs, resumo_confirmado = v_resumo
   where id = p_turno_id and status = 'enviado';
  perform _exigir(found, 'O fechamento precisa estar "enviado" para ser confirmado');
end $$;

-- Ajuste de estoque (admin). Informe o efeito em cada lugar.
create or replace function public.ajustar_estoque(
  p_op uuid, p_produto_id uuid, p_motivo text,
  p_dep_cheios int default 0, p_dep_vazios int default 0,
  p_ent_cheios int default 0, p_ent_vazios int default 0, p_entregador_id uuid default null,
  p_cli_vasilhames int default 0, p_cliente_id uuid default null,
  p_turno_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _exigir(eh_admin(), 'Só o admin faz ajustes');
  if not _nova_operacao(p_op, 'ajuste_estoque') then return; end if;
  insert into movimentacoes (operacao_id, tipo, produto_id, dep_cheios, dep_vazios, ent_cheios, ent_vazios,
                             entregador_id, cli_vasilhames, cliente_id, turno_id, motivo)
  values (p_op, 'ajuste', p_produto_id, p_dep_cheios, p_dep_vazios, p_ent_cheios, p_ent_vazios,
          p_entregador_id, p_cli_vasilhames, p_cliente_id, p_turno_id, p_motivo);
end $$;

-- Ajuste no saldo de fiado do cliente (admin).
-- p_valor > 0 abate a dívida (desconto/perdão); p_valor < 0 lança dívida (ex.: saldo inicial).
create or replace function public.ajustar_fiado(p_op uuid, p_cliente_id uuid, p_valor numeric, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _exigir(eh_admin(), 'Só o admin faz ajustes');
  perform _exigir(coalesce(trim(p_motivo),'') <> '', 'Informe o motivo');
  perform _exigir(p_valor <> 0, 'Valor não pode ser zero');
  if not _nova_operacao(p_op, 'ajuste_fiado') then return; end if;
  insert into pagamentos (operacao_id, cliente_id, tipo, valor, recebido_por, motivo, ocorrido_em)
  values (p_op, p_cliente_id, 'ajuste', round(p_valor, 2), auth.uid(), p_motivo, now());
end $$;

-- Estorno de entrega lançada errada (admin): cria o lançamento inverso.
create or replace function public.estornar_entrega(p_op uuid, p_entrega_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare e entregas%rowtype; v_novo uuid := gen_random_uuid();
begin
  perform _exigir(eh_admin(), 'Só o admin estorna');
  perform _exigir(coalesce(trim(p_motivo),'') <> '', 'Informe o motivo');
  if not _nova_operacao(p_op, 'estorno_entrega') then
    return (select id from entregas where estorno_de = p_entrega_id);
  end if;
  select * into e from entregas where id = p_entrega_id;
  perform _exigir(found and e.estorno_de is null, 'Entrega não encontrada');
  perform _exigir(not exists (select 1 from entregas where estorno_de = p_entrega_id), 'Entrega já estornada');

  insert into entregas (id, operacao_id, cliente_id, entregador_id, turno_id, pedido_id, forma_pagamento,
                        valor_total, estorno_de, motivo, ocorrido_em)
  values (v_novo, p_op, e.cliente_id, e.entregador_id, e.turno_id, null, e.forma_pagamento,
          -e.valor_total, e.id, p_motivo, now());
  insert into entrega_itens (entrega_id, produto_id, quantidade, preco_unitario, vazios_recebidos)
  select v_novo, produto_id, -quantidade, preco_unitario, -vazios_recebidos from entrega_itens where entrega_id = e.id;
  insert into movimentacoes (operacao_id, tipo, produto_id, dep_cheios, dep_vazios, ent_cheios, ent_vazios,
                             cli_vasilhames, entregador_id, cliente_id, turno_id, entrega_id, motivo)
  select p_op, 'ajuste', produto_id, -dep_cheios, -dep_vazios, -ent_cheios, -ent_vazios,
         -cli_vasilhames, entregador_id, cliente_id, turno_id, v_novo, 'Estorno: ' || p_motivo
    from movimentacoes where entrega_id = e.id and tipo = 'venda';
  insert into pagamentos (operacao_id, cliente_id, entrega_id, turno_id, tipo, forma, valor, recebido_por,
                          motivo, estorno_de, ocorrido_em)
  select p_op, cliente_id, v_novo, turno_id, tipo, forma, -valor, recebido_por, p_motivo, id, now()
    from pagamentos where entrega_id = e.id and tipo = 'na_entrega';
  return v_novo;
end $$;

-- Estorno de pagamento de fiado lançado errado (admin)
create or replace function public.estornar_pagamento(p_op uuid, p_pagamento_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare pg pagamentos%rowtype;
begin
  perform _exigir(eh_admin(), 'Só o admin estorna');
  perform _exigir(coalesce(trim(p_motivo),'') <> '', 'Informe o motivo');
  if not _nova_operacao(p_op, 'estorno_pagamento') then return; end if;
  select * into pg from pagamentos where id = p_pagamento_id;
  perform _exigir(found and pg.tipo = 'fiado' and pg.estorno_de is null and pg.valor > 0,
                  'Só pagamentos de fiado podem ser estornados aqui (para pagamento na entrega, estorne a entrega)');
  insert into pagamentos (operacao_id, cliente_id, turno_id, tipo, forma, valor, recebido_por, motivo, estorno_de, ocorrido_em)
  values (p_op, pg.cliente_id, pg.turno_id, pg.tipo, pg.forma, -pg.valor, pg.recebido_por, p_motivo, pg.id, now());
end $$;

-- Pedidos: entregador pega um pedido livre
create or replace function public.pegar_pedido(p_pedido_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform _exigir(tem_papel('admin','entregador'), 'Sem permissão');
  update pedidos set entregador_id = auth.uid(), status = 'em_rota'
   where id = p_pedido_id and status = 'pendente' and entregador_id is null;
  return found;
end $$;

-- Pedidos: entregador muda o status de um pedido seu
-- (em_rota, pendente = devolver para a fila, cancelado)
create or replace function public.mudar_status_pedido(p_pedido_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _exigir(eh_ativo(), 'Sem permissão');
  perform _exigir(p_status in ('pendente','em_rota','cancelado'), 'Status inválido');
  update pedidos
     set status = p_status,
         entregador_id = case when p_status = 'pendente' then null else entregador_id end
   where id = p_pedido_id and status in ('pendente','em_rota')
     and (entregador_id = auth.uid() or tem_papel('admin','atendente'));
  perform _exigir(found, 'Pedido não encontrado ou não é seu');
end $$;

-- Estoquista confere retirada/devolução
create or replace function public.conferir_turno(p_turno_id uuid, p_etapa text, p_ok boolean, p_obs text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _exigir(tem_papel('admin','estoquista'), 'Sem permissão');
  insert into conferencias (turno_id, etapa, ok, observacao) values (p_turno_id, p_etapa, p_ok, coalesce(p_obs,''));
end $$;

-- ---------------------------------------------------------------------
-- 6. VIEWS (saldos calculados)
--   "security_invoker" = respeita o RLS de quem consulta (cada um vê o seu).
--   As demais são compartilhadas com a equipe ativa (filtro eh_ativo()).
-- ---------------------------------------------------------------------

-- Saldo do depósito por produto (compartilhada)
create view public.v_saldo_deposito as
select p.id as produto_id, p.nome, p.retornavel, p.estoque_minimo, p.ordem,
       coalesce(sum(m.dep_cheios), 0)::int as cheios,
       coalesce(sum(m.dep_vazios), 0)::int as vazios,
       coalesce(sum(m.dep_cheios), 0) <= p.estoque_minimo as estoque_baixo
  from public.produtos p
  left join public.movimentacoes m on m.produto_id = p.id
 where p.ativo and public.eh_ativo()
 group by p.id;

-- Carga atual de cada entregador (entregador vê só a dele)
create view public.v_carga_entregador with (security_invoker = true) as
select m.entregador_id, pf.nome as entregador, m.produto_id, p.nome as produto,
       sum(m.ent_cheios)::int as cheios, sum(m.ent_vazios)::int as vazios
  from public.movimentacoes m
  join public.produtos p on p.id = m.produto_id
  join public.perfis pf on pf.id = m.entregador_id
 where m.entregador_id is not null
 group by m.entregador_id, pf.nome, m.produto_id, p.nome
having sum(m.ent_cheios) <> 0 or sum(m.ent_vazios) <> 0;

-- Vasilhames emprestados por cliente (compartilhada)
create view public.v_vasilhames_cliente as
select m.cliente_id, c.nome as cliente, c.bairro, m.produto_id, p.nome as produto,
       sum(m.cli_vasilhames)::int as saldo
  from public.movimentacoes m
  join public.clientes c on c.id = m.cliente_id
  join public.produtos p on p.id = m.produto_id
 where p.retornavel and public.eh_ativo()
 group by m.cliente_id, c.nome, c.bairro, m.produto_id, p.nome
having sum(m.cli_vasilhames) <> 0;

-- Total de vasilhames por lugar (compartilhada)
create view public.v_vasilhames_total as
select p.id as produto_id, p.nome,
       coalesce(sum(m.dep_cheios + m.dep_vazios), 0)::int as no_deposito,
       coalesce(sum(m.ent_cheios + m.ent_vazios), 0)::int as com_entregadores,
       coalesce(sum(m.cli_vasilhames), 0)::int as na_rua,
       coalesce(sum(m.dep_cheios + m.dep_vazios + m.ent_cheios + m.ent_vazios + m.cli_vasilhames), 0)::int as total
  from public.produtos p
  left join public.movimentacoes m on m.produto_id = p.id
 where p.retornavel and p.ativo and public.eh_ativo()
 group by p.id;

-- Fiado: quem deve, quanto e desde quando (dívida mais antiga em aberto)
create view public.v_fiado as
with debitos as (
  select cliente_id, id::text as ref, ocorrido_em, valor_total as valor
    from public.entregas where forma_pagamento = 'fiado' and cliente_id is not null
  union all
  select cliente_id, id::text, ocorrido_em, -valor
    from public.pagamentos where tipo = 'ajuste' and valor < 0 and cliente_id is not null
), creditos as (
  select cliente_id, sum(valor) as total
    from public.pagamentos
   where cliente_id is not null and (tipo = 'fiado' or (tipo = 'ajuste' and valor > 0))
   group by cliente_id
), saldos as (
  select d.cliente_id, sum(d.valor) - coalesce(max(c.total), 0) as saldo
    from debitos d left join creditos c using (cliente_id)
   group by d.cliente_id
), janela as (
  select d.*, sum(d.valor) over (partition by d.cliente_id order by d.ocorrido_em desc, d.ref
                                 rows between unbounded preceding and current row) as acumulado
    from debitos d
), desde as (
  select s.cliente_id, s.saldo,
         (select min(j.ocorrido_em) from janela j
           where j.cliente_id = s.cliente_id and j.acumulado - j.valor < s.saldo) as desde
    from saldos s
   where s.saldo > 0.009
)
select c.id as cliente_id, c.nome, c.telefone, c.bairro, c.endereco,
       d.saldo::numeric(12,2) as saldo, d.desde,
       ((now() at time zone 'America/Sao_Paulo')::date
         - (d.desde at time zone 'America/Sao_Paulo')::date) as dias
  from desde d
  join public.clientes c on c.id = d.cliente_id
 where public.eh_ativo();

-- Clientes recorrentes e próxima compra prevista (compartilhada)
create view public.v_recorrentes as
with validas as (
  select e.cliente_id, e.ocorrido_em
    from public.entregas e
   where e.cliente_id is not null and e.estorno_de is null and e.valor_total > 0
     and not exists (select 1 from public.entregas x where x.estorno_de = e.id)
), seq as (
  select cliente_id, ocorrido_em,
         lag(ocorrido_em) over (partition by cliente_id order by ocorrido_em) as anterior
    from validas
), agg as (
  select cliente_id, count(*) as entregas, max(ocorrido_em) as ultima,
         avg(extract(epoch from (ocorrido_em - anterior)) / 86400.0)
           filter (where anterior is not null and ocorrido_em - anterior > interval '12 hours') as media_dias
    from seq group by cliente_id
)
select c.id as cliente_id, c.nome, c.telefone, c.bairro, a.entregas, a.ultima,
       round(a.media_dias::numeric, 1) as intervalo_medio_dias,
       a.ultima + make_interval(secs => a.media_dias * 86400) as proxima_prevista
  from agg a
  join public.clientes c on c.id = a.cliente_id
 where a.media_dias is not null and c.ativo and public.eh_ativo();

-- Vendas item a item (base dos relatórios; entregador vê só as dele)
create view public.v_vendas with (security_invoker = true) as
select e.id as entrega_id, e.ocorrido_em,
       (e.ocorrido_em at time zone 'America/Sao_Paulo')::date as dia,
       e.entregador_id, pf.nome as entregador, e.turno_id,
       e.cliente_id, c.nome as cliente, c.bairro,
       e.forma_pagamento, i.produto_id, p.nome as produto,
       i.quantidade, i.preco_unitario, (i.quantidade * i.preco_unitario)::numeric(12,2) as valor,
       i.vazios_recebidos, e.estorno_de is not null as eh_estorno, e.estorno_de
  from public.entregas e
  join public.entrega_itens i on i.entrega_id = e.id
  join public.produtos p on p.id = i.produto_id
  join public.perfis pf on pf.id = e.entregador_id
  left join public.clientes c on c.id = e.cliente_id;

-- Conferência de produto por turno: retirado = entregue + devolvido
create view public.v_conferencia_turno with (security_invoker = true) as
select m.turno_id, t.entregador_id, m.produto_id, p.nome as produto,
       coalesce(sum(m.qtd_cheios) filter (where m.tipo = 'retirada'), 0)::int  as retirado,
       coalesce(-sum(m.ent_cheios) filter (where m.tipo = 'venda'), 0)::int    as entregue,
       coalesce(sum(m.qtd_cheios) filter (where m.tipo = 'devolucao'), 0)::int as devolvido_cheios,
       coalesce(sum(m.ent_cheios) filter (where m.tipo = 'ajuste'), 0)::int    as ajustes,
       sum(m.ent_cheios)::int as diferenca_cheios,            -- deveria ser 0 após a devolução
       coalesce(sum(m.ent_vazios) filter (where m.tipo = 'venda'), 0)::int     as vazios_recebidos,
       coalesce(sum(m.qtd_vazios) filter (where m.tipo = 'devolucao'), 0)::int as vazios_devolvidos,
       sum(m.ent_vazios)::int as diferenca_vazios
  from public.movimentacoes m
  join public.turnos t on t.id = m.turno_id
  join public.produtos p on p.id = m.produto_id
 group by m.turno_id, t.entregador_id, m.produto_id, p.nome;

-- Resumo financeiro do turno (caixa do entregador)
create view public.v_resumo_turno with (security_invoker = true) as
select t.id as turno_id, t.entregador_id, pf.nome as entregador, t.status,
       t.iniciado_em, t.encerrado_em, t.enviado_em, t.confirmado_em, t.confirmado_por,
       coalesce((select sum(valor_total) from public.entregas e where e.turno_id = t.id), 0)::numeric(12,2) as total_vendido,
       coalesce((select sum(valor_total) from public.entregas e where e.turno_id = t.id and e.forma_pagamento = 'fiado'), 0)::numeric(12,2) as vendido_fiado,
       coalesce(sum(pg.valor) filter (where pg.forma = 'dinheiro'), 0)::numeric(12,2) as recebido_dinheiro,
       coalesce(sum(pg.valor) filter (where pg.forma = 'pix'), 0)::numeric(12,2)      as recebido_pix,
       coalesce(sum(pg.valor) filter (where pg.forma = 'cartao'), 0)::numeric(12,2)   as recebido_cartao,
       coalesce(sum(pg.valor) filter (where pg.tipo = 'fiado'), 0)::numeric(12,2)    as recebido_de_fiado_antigo,
       t.dinheiro_contado,
       (t.dinheiro_contado - coalesce(sum(pg.valor) filter (where pg.forma = 'dinheiro'), 0))::numeric(12,2) as diferenca_dinheiro,
       coalesce((select bool_or(c.diferenca_cheios <> 0 or c.diferenca_vazios <> 0)
                   from public.v_conferencia_turno c where c.turno_id = t.id), false)
         and t.encerrado_em is not null as divergencia_produto,
       t.obs_entregador, t.obs_admin
  from public.turnos t
  join public.perfis pf on pf.id = t.entregador_id
  left join public.pagamentos pg on pg.turno_id = t.id
 group by t.id, pf.nome;

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.perfis         enable row level security;
alter table public.convites       enable row level security;
alter table public.configuracoes  enable row level security;
alter table public.produtos       enable row level security;
alter table public.clientes       enable row level security;
alter table public.precos_cliente enable row level security;
alter table public.operacoes      enable row level security;
alter table public.turnos         enable row level security;
alter table public.pedidos        enable row level security;
alter table public.entregas       enable row level security;
alter table public.entrega_itens  enable row level security;
alter table public.movimentacoes  enable row level security;
alter table public.pagamentos     enable row level security;
alter table public.conferencias   enable row level security;
alter table public.auditoria      enable row level security;

-- perfis: equipe ativa vê nomes (para "quem fez"); só admin altera
create policy perfis_ler   on public.perfis for select to authenticated using (public.eh_ativo() or id = auth.uid());
create policy perfis_admin on public.perfis for update to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- convites: só admin
create policy convites_admin on public.convites for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- configurações: todos leem; admin altera
create policy config_ler   on public.configuracoes for select to authenticated using (public.eh_ativo());
create policy config_admin on public.configuracoes for update to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- produtos: todos leem; admin cadastra/altera
create policy produtos_ler     on public.produtos for select to authenticated using (public.eh_ativo());
create policy produtos_inserir on public.produtos for insert to authenticated with check (public.eh_admin());
create policy produtos_alterar on public.produtos for update to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- clientes: compartilhados por toda a equipe
create policy clientes_ler     on public.clientes for select to authenticated using (public.eh_ativo());
create policy clientes_inserir on public.clientes for insert to authenticated with check (public.eh_ativo() and criado_por = auth.uid());
create policy clientes_alterar on public.clientes for update to authenticated using (public.eh_ativo()) with check (public.eh_ativo());

-- preço especial: todos leem; admin define
create policy precos_ler   on public.precos_cliente for select to authenticated using (public.eh_ativo());
create policy precos_admin on public.precos_cliente for all    to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- operações: só admin consulta
create policy operacoes_ler on public.operacoes for select to authenticated using (public.eh_admin());

-- turnos: admin/estoquista veem todos; entregador só os seus
create policy turnos_ler on public.turnos for select to authenticated
  using (public.tem_papel('admin','estoquista') or (public.eh_ativo() and entregador_id = auth.uid()));

-- pedidos: admin/atendente gerenciam; entregador vê os seus e os livres
create policy pedidos_ler on public.pedidos for select to authenticated
  using (public.tem_papel('admin','atendente')
         or (public.eh_ativo() and (entregador_id = auth.uid() or (entregador_id is null and status = 'pendente'))));
create policy pedidos_inserir on public.pedidos for insert to authenticated
  with check (public.tem_papel('admin','atendente') and criado_por = auth.uid());
create policy pedidos_alterar on public.pedidos for update to authenticated
  using (public.tem_papel('admin','atendente')) with check (public.tem_papel('admin','atendente'));

-- entregas: admin vê todas; entregador só as suas (gravação só via RPC)
create policy entregas_ler on public.entregas for select to authenticated
  using (public.eh_admin() or (public.eh_ativo() and entregador_id = auth.uid()));
create policy itens_ler on public.entrega_itens for select to authenticated
  using (exists (select 1 from public.entregas e where e.id = entrega_id));

-- movimentações: admin/estoquista veem todas; entregador só as suas
create policy mov_ler on public.movimentacoes for select to authenticated
  using (public.tem_papel('admin','estoquista') or (public.eh_ativo() and entregador_id = auth.uid()));

-- pagamentos: admin vê todos; quem recebeu vê os seus
create policy pag_ler on public.pagamentos for select to authenticated
  using (public.eh_admin() or (public.eh_ativo() and recebido_por = auth.uid()));

-- conferências: admin e estoquista
create policy conf_ler on public.conferencias for select to authenticated using (public.tem_papel('admin','estoquista'));

-- auditoria: só admin
create policy aud_ler on public.auditoria for select to authenticated using (public.eh_admin());

-- ---------------------------------------------------------------------
-- 8. PERMISSÕES (GRANTS)
--   Por padrão o Supabase libera tudo para anon/authenticated; aqui
--   fechamos e liberamos só o necessário. Lançamentos não têm INSERT
--   direto: só pelas funções acima.
-- ---------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on all tables in schema public to authenticated;   -- o RLS filtra as linhas

grant update (nome, papel, ativo)                                on public.perfis         to authenticated;
grant insert, delete                                             on public.convites       to authenticated;
grant update (nome_negocio, chave_pix, nome_recebedor_pix, msg_cobranca, msg_oferta, dias_aviso_recorrente)
                                                                 on public.configuracoes  to authenticated;
grant insert (nome, preco_padrao, retornavel, estoque_minimo, ordem, ativo),
      update (nome, preco_padrao, retornavel, estoque_minimo, ordem, ativo)
                                                                 on public.produtos       to authenticated;
grant insert (id, nome, telefone, endereco, bairro, observacoes, criado_por),
      update (nome, telefone, endereco, bairro, observacoes, ativo)
                                                                 on public.clientes       to authenticated;
grant insert (cliente_id, produto_id, preco), update (preco), delete
                                                                 on public.precos_cliente to authenticated;
grant insert (id, cliente_id, produto_id, quantidade, observacao, entregador_id, status, agendado_para, criado_por),
      update (cliente_id, produto_id, quantidade, observacao, entregador_id, status, agendado_para)
                                                                 on public.pedidos        to authenticated;

-- funções usadas pelo RLS e pelo app
grant execute on function public.meu_papel(), public.eh_ativo(), public.eh_admin(), public.tem_papel(text[]),
  public.registrar_mov_deposito(uuid, text, jsonb, text, timestamptz),
  public.iniciar_turno(uuid, uuid, jsonb, timestamptz),
  public.registrar_retirada(uuid, uuid, jsonb, timestamptz),
  public.registrar_devolucao(uuid, uuid, jsonb, timestamptz),
  public.registrar_entrega(uuid, jsonb),
  public.receber_pagamento(uuid, uuid, numeric, text, uuid, timestamptz),
  public.enviar_fechamento(uuid, numeric, text),
  public.confirmar_fechamento(uuid, text),
  public.ajustar_estoque(uuid, uuid, text, int, int, int, int, uuid, int, uuid, uuid),
  public.ajustar_fiado(uuid, uuid, numeric, text),
  public.estornar_entrega(uuid, uuid, text),
  public.estornar_pagamento(uuid, uuid, text),
  public.pegar_pedido(uuid),
  public.mudar_status_pedido(uuid, text),
  public.conferir_turno(uuid, text, boolean, text)
to authenticated;

-- ---------------------------------------------------------------------
-- 9. TEMPO REAL (sincronização entre os celulares)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table
  public.pedidos, public.entregas, public.movimentacoes, public.pagamentos,
  public.turnos, public.clientes, public.produtos, public.precos_cliente,
  public.configuracoes, public.perfis;

-- =====================================================================
-- DEPOIS DE RODAR: torne-se admin (troque pelo seu e-mail) — só depois
-- de criar sua conta em Authentication > Users:
--
--   update public.perfis set papel = 'admin', ativo = true, nome = 'Seu Nome'
--    where email = 'seu@email.com';
-- =====================================================================
