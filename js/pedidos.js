// Pedidos, prováveis pedidos (clientes recorrentes) e relatórios.
import * as D from './dados.js';
import {
  h, limpar, icone, toast, folha, confirmar, campo, entrada, selecao, contador, escolha,
  brl, normalizar, uuid, linkWhats, vazio, etiqueta, num, dataHora, baixarCsv, diasRelativo,
} from './ui.js';
import { nomePerfil, detalheCliente } from './cadastros.js';
import { produtosAtivos, TIPOS } from './estoque.js';
import { ganchos, prepararPedido, FORMAS } from './entregas.js';
import { barra } from './caixa.js';

const STATUS = { pendente: ['Pendente', 'amarelo'], em_rota: ['Em rota', 'azul'], entregue: ['Entregue', 'verde'], cancelado: ['Cancelado', ''] };
const produto = (id) => D.tabela('produtos').find((p) => p.id === id) || { nome: '?' };
const cliente = (id) => D.tabela('clientes').find((c) => c.id === id) || { nome: '?' };
const minutos = (d) => {
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.floor(m / 60)} h` : `há ${Math.floor(m / 1440)} dia(s)`;
};
const abertos = () => D.tabela('pedidos').filter((p) => p.status === 'pendente' || p.status === 'em_rota');
const descricaoPedido = (p) => `${p.quantidade} ${produto(p.produto_id).nome}` + (p.agendado_para ? ` · para ${new Date(p.agendado_para + 'T12:00').toLocaleDateString('pt-BR')}` : '');

// =====================================================================
// Escolher cliente (folha com busca)
// =====================================================================
export function escolherCliente(aoEscolher) {
  const busca = entrada({ type: 'search', placeholder: 'Nome, bairro ou telefone' });
  const lista = h('div', { class: 'lista' });
  const mostrar = () => {
    const t = normalizar(busca.value).trim(), dig = t.replace(/\D/g, '');
    const cs = D.tabela('clientes').filter((c) => c.ativo !== false &&
      (!t || normalizar(`${c.nome} ${c.bairro} ${c.endereco}`).includes(t) || (dig && String(c.telefone).replace(/\D/g, '').includes(dig))))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).slice(0, 30);
    limpar(lista, cs.map((c) => h('button', { class: 'item', onclick: () => { f.fechar(); aoEscolher(c); } },
      h('div', { class: 'item-texto' }, h('strong', {}, c.nome), h('span', {}, [c.bairro, c.endereco].filter(Boolean).join(' · '))))));
  };
  busca.addEventListener('input', mostrar);
  const f = folha('Escolher cliente', [h('div', { class: 'busca' }, icone('busca'), busca), lista]);
  mostrar();
  setTimeout(() => busca.focus(), 50);
}

// =====================================================================
// PEDIDOS (admin e atendente)
// =====================================================================
export function telaPedidos(el, ctx) {
  let filtro = 'abertos';
  const lista = h('div', { class: 'lista' });
  const esc = escolha([['abertos', 'Abertos'], ['hoje', 'Entregues hoje'], ['cancelado', 'Cancelados']], filtro, (v) => { filtro = v; desenhar(); }, { classe: 'tres' });
  el.append(
    ctx.perfil.papel === 'atendente' ? h('h1', {}, 'Pedidos') : null,
    h('button', { class: 'btn primario grande', onclick: () => formPedido(ctx) }, icone('mais'), 'Novo pedido'),
    esc.el, lista);
  const desenhar = () => {
    const hoje = D.inicioDoDia();
    const ps = D.tabela('pedidos').filter((p) => filtro === 'abertos' ? (p.status === 'pendente' || p.status === 'em_rota')
      : filtro === 'hoje' ? (p.status === 'entregue' && (p.atualizado_em || p.criado_em) >= hoje) : p.status === 'cancelado')
      .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)) * (filtro === 'abertos' ? 1 : -1));
    limpar(lista, ps.length ? ps.map((p) => {
      const [txt, cor] = STATUS[p.status];
      const c = cliente(p.cliente_id);
      return h('button', { class: 'item', onclick: () => acoesPedido(p, ctx) },
        h('div', { class: 'item-texto' },
          h('strong', {}, c.nome),
          h('span', {}, [c.bairro, descricaoPedido(p)].filter(Boolean).join(' · ')),
          p.observacao ? h('small', {}, p.observacao) : null,
          h('small', { class: 'quem' }, `${p.entregador_id ? nomePerfil(p.entregador_id) : 'Livre para quem pegar'} · ${minutos(p.criado_em)}`)),
        etiqueta(txt, cor));
    }) : vazio(filtro === 'abertos' ? 'Nenhum pedido aberto.' : 'Nada aqui.'));
  };
  desenhar();
  ctx.ao('dados', (n) => { if (n === 'pedidos' || n === 'clientes') desenhar(); });
}

const entregadores = () => D.tabela('perfis').filter((p) => p.ativo && (p.papel === 'entregador' || p.papel === 'admin'));

export function formPedido(ctx, clienteInicial) {
  let c = clienteInicial || null;
  const nomeCli = h('button', { type: 'button', class: 'entrada escolher', onclick: () => escolherCliente((x) => { c = x; nomeCli.textContent = x.nome; }) }, c ? c.nome : 'Toque para escolher');
  const ps = produtosAtivos();
  let prod = ps[0]?.id;
  const escP = escolha(ps.map((p) => [p.id, p.nome]), prod, (v) => { prod = v; });
  const qtd = contador(1, { min: 1 });
  const quem = selecao([['', 'Livre (quem pegar primeiro)'], ...entregadores().map((p) => [p.id, p.nome || p.email])], '');
  const quando = entrada({ type: 'date' });
  const obs = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Ex.: entregar depois das 14h, troco para 50' });
  const f = folha('Novo pedido', [
    campo('Cliente *', nomeCli), h('span', { class: 'rotulo' }, 'Produto'), escP.el, campo('Quantidade', qtd.el),
    campo('Entregador', quem), campo('Para o dia (opcional)', quando), campo('Observação', obs),
  ], { rodape: [h('button', { class: 'btn primario grande', onclick: async () => {
    if (!c) return toast('Escolha o cliente.', 'erro');
    const dados = { id: uuid(), cliente_id: c.id, produto_id: prod, quantidade: qtd.valor, observacao: obs.value.trim(),
      entregador_id: quem.value || null, status: 'pendente', agendado_para: quando.value || null, criado_por: ctx.perfil.id };
    await D.enfileirar({ tipo: 'insert', alvo: 'pedidos', dados, linhaLocal: { criado_em: new Date().toISOString() },
      descricao: `Pedido: ${c.nome} (${qtd.valor} ${produto(prod).nome})` });
    toast('Pedido criado.'); f.fechar();
  } }, 'Criar pedido')] });
}

function acoesPedido(p, ctx) {
  const c = cliente(p.cliente_id);
  const aberto = p.status === 'pendente' || p.status === 'em_rota';
  const quem = selecao([['', 'Livre (quem pegar primeiro)'], ...entregadores().map((x) => [x.id, x.nome || x.email])], p.entregador_id || '');
  const f = folha(c.nome, [
    h('p', {}, descricaoPedido(p)), p.observacao ? h('p', { class: 'obs' }, p.observacao) : null,
    h('p', { class: 'suave pequeno' }, `Criado por ${nomePerfil(p.criado_por)} em ${dataHora(p.criado_em)}` + (p.atualizado_em ? ` · alterado por ${nomePerfil(p.atualizado_por)} em ${dataHora(p.atualizado_em)}` : '')),
    aberto ? campo('Entregador', quem) : null,
    h('div', { class: 'botoes-lado' },
      c.telefone ? h('a', { class: 'btn verde', href: linkWhats(c.telefone), target: '_blank', rel: 'noopener' }, icone('whats'), 'WhatsApp') : null,
      h('button', { class: 'btn secundario', onclick: () => { f.fechar(); detalheCliente(p.cliente_id, ctx); } }, 'Cliente')),
  ], { rodape: aberto ? [
    h('button', { class: 'btn perigo', onclick: async () => {
      if (!(await confirmar(`Cancelar o pedido de ${c.nome}?`, { sim: 'Cancelar pedido', perigo: true }))) return;
      await D.enfileirar({ tipo: 'update', alvo: 'pedidos', dados: { status: 'cancelado' }, filtro: { id: p.id }, descricao: 'Cancelar pedido: ' + c.nome });
      f.fechar();
    } }, 'Cancelar'),
    h('button', { class: 'btn primario', onclick: async () => {
      const novo = quem.value || null;
      if (novo !== (p.entregador_id || null)) await D.enfileirar({ tipo: 'update', alvo: 'pedidos', dados: { entregador_id: novo, status: novo ? p.status : 'pendente' }, filtro: { id: p.id }, descricao: 'Atribuir pedido: ' + c.nome });
      toast('Salvo.'); f.fechar();
    } }, 'Salvar'),
  ] : null });
}

// ---------------------------------------------------------------------
// Entregador: pedidos no topo da tela Entregar
// ---------------------------------------------------------------------
ganchos.topoEntregar = (ctx) => {
  const eu = ctx.perfil.id;
  const meus = abertos().filter((p) => p.entregador_id === eu);
  const livres = abertos().filter((p) => !p.entregador_id && p.status === 'pendente');
  if (!meus.length && !livres.length) return null;
  const item = (p, meu) => {
    const c = cliente(p.cliente_id);
    return h('div', { class: 'item pedido' },
      h('div', { class: 'item-texto' }, h('strong', {}, c.nome),
        h('span', {}, [c.bairro, descricaoPedido(p)].filter(Boolean).join(' · ')),
        p.observacao ? h('small', {}, p.observacao) : null),
      meu ? h('div', { class: 'botoes-col' },
        h('button', { class: 'btn primario pequeno-btn', onclick: () => prepararPedido(p) }, 'Entregar'),
        h('button', { class: 'btn-texto', onclick: async () => {
          await D.enfileirar({ tipo: 'rpc', alvo: 'mudar_status_pedido', dados: { p_pedido_id: p.id, p_status: 'pendente' },
            efeitos: [{ tipo: 'update', alvo: 'pedidos', dados: { entregador_id: null, status: 'pendente' }, filtro: { id: p.id } }], descricao: 'Soltar pedido: ' + c.nome });
        } }, 'Soltar'))
        : h('button', { class: 'btn secundario pequeno-btn', onclick: async () => {
          await D.enfileirar({ tipo: 'rpc', alvo: 'pegar_pedido', dados: { p_pedido_id: p.id },
            efeitos: [{ tipo: 'update', alvo: 'pedidos', dados: { entregador_id: eu, status: 'em_rota' }, filtro: { id: p.id } }], descricao: 'Pegar pedido: ' + c.nome });
          toast('Pedido é seu.');
        } }, 'Pegar'));
  };
  return h('div', { class: 'cartao pedidos-topo' },
    meus.length ? [h('span', { class: 'passo' }, `Seus pedidos (${meus.length})`), h('div', { class: 'lista' }, meus.slice(0, 6).map((p) => item(p, true)))] : null,
    livres.length ? [h('span', { class: 'passo' }, `Livres para pegar (${livres.length})`), h('div', { class: 'lista' }, livres.slice(0, 6).map((p) => item(p, false)))] : null);
};

// Aviso quando chega pedido novo para o entregador (tempo real)
export function iniciarAvisos(perfil) {
  if (perfil.papel !== 'entregador') return;
  let conhecidos = null;
  D.ao('dados', (n) => {
    if (n !== 'pedidos') return;
    const relevantes = abertos().filter((p) => p.entregador_id === perfil.id || !p.entregador_id);
    const ids = new Set(relevantes.map((p) => p.id));
    if (conhecidos) {
      const novos = relevantes.filter((p) => !conhecidos.has(p.id) && p.criado_por !== perfil.id);
      if (novos.length) {
        toast(novos.length === 1 ? `Novo pedido: ${cliente(novos[0].cliente_id).nome}` : `${novos.length} pedidos novos`);
        if (navigator.vibrate) navigator.vibrate(200);
      }
    }
    conhecidos = ids;
  });
}

// =====================================================================
// PROVÁVEIS PEDIDOS
// =====================================================================
export function telaProvaveis(el, ctx) {
  let todos = false;
  const lista = h('div', { class: 'lista' });
  const esc = escolha([['prox', 'Próximos dias'], ['todos', 'Todos recorrentes']], 'prox', (v) => { todos = v === 'todos'; desenhar(); });
  const podeCriar = ['admin', 'atendente'].includes(ctx.perfil.papel);
  el.append(h('p', { class: 'suave' }, 'Calculado pelo intervalo médio entre as compras de cada cliente.'), esc.el, lista);
  const desenhar = () => {
    const cfg = D.config();
    const limite = new Date(); limite.setHours(23, 59, 59, 999); limite.setDate(limite.getDate() + Number(cfg.dias_aviso_recorrente ?? 2));
    const comPedido = new Set(abertos().map((p) => p.cliente_id));
    const rs = D.tabela('recorrentes').filter((r) => todos || (new Date(r.proxima_prevista) <= limite && !comPedido.has(r.cliente_id)))
      .sort((a, b) => String(a.proxima_prevista).localeCompare(String(b.proxima_prevista)));
    limpar(lista, rs.length ? rs.map((r) => {
      const rel = diasRelativo(r.proxima_prevista);
      const atrasado = new Date(r.proxima_prevista) < new Date(D.inicioDoDia());
      const msg = (cfg.msg_oferta || '').replaceAll('{nome}', (r.nome || '').trim()).replaceAll('{negocio}', cfg.nome_negocio || '');
      return h('div', { class: 'item provavel' },
        h('div', { class: 'item-texto' },
          h('strong', {}, r.nome),
          h('div', {}, etiqueta(atrasado ? 'Atrasado' : 'Previsto ' + rel, atrasado ? 'vermelho' : 'amarelo')),
          h('span', {}, `Compra a cada ~${String(r.intervalo_medio_dias).replace('.', ',')} dias · última ${diasRelativo(r.ultima)}`),
          h('small', {}, r.bairro || ''),
          h('div', { class: 'botoes-lado' },
            r.telefone ? h('a', { class: 'btn verde pequeno-btn', href: linkWhats(r.telefone, msg), target: '_blank', rel: 'noopener' }, icone('whats'), 'Oferecer') : null,
            podeCriar ? h('button', { class: 'btn secundario pequeno-btn', onclick: () => formPedido(ctx, cliente(r.cliente_id)) }, 'Criar pedido') : null)));
    }) : vazio(todos ? 'Ainda não há clientes com 2 ou mais compras.' : 'Ninguém previsto para os próximos dias.'));
  };
  desenhar();
  ctx.ao('dados', (n) => { if (n === 'recorrentes' || n === 'pedidos') desenhar(); });
}

// =====================================================================
// RELATÓRIOS (admin)
// =====================================================================
// Data completa para planilha: 05/11/2026 22:55
const dataCsv = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');

export function telaRelatorios(el, ctx) {
  let periodo = 'hoje';
  const de = entrada({ type: 'date' }), ate = entrada({ type: 'date' });
  const datas = h('div', { class: 'linha-datas', hidden: true }, campo('De', de), campo('Até', ate));
  const esc = escolha([['hoje', 'Hoje'], ['semana', '7 dias'], ['mes', 'Este mês'], ['outro', 'Escolher']], periodo, (v) => { periodo = v; carregar(); });
  const corpo = h('div');
  el.append(h('h1', {}, 'Relatórios'), esc.el, datas, corpo);
  [de, ate].forEach((x) => x.addEventListener('change', carregar));
  let dados = null;

  function intervalo() {
    const ini = new Date(); ini.setHours(0, 0, 0, 0);
    const fim = new Date(ini); fim.setDate(fim.getDate() + 1);
    if (periodo === 'semana') ini.setDate(ini.getDate() - 6);
    if (periodo === 'mes') ini.setDate(1);
    if (periodo === 'outro') {
      if (!de.value || !ate.value) return null;
      const a = new Date(de.value + 'T00:00'), b = new Date(ate.value + 'T00:00'); b.setDate(b.getDate() + 1);
      return [a, b];
    }
    return [ini, fim];
  }

  async function carregar() {
    datas.hidden = periodo !== 'outro';
    const iv = intervalo();
    if (!iv) return limpar(corpo, h('p', { class: 'suave' }, 'Escolha as duas datas.'));
    limpar(corpo, h('p', { class: 'suave' }, 'Carregando…'));
    const [a, b] = iv.map((d) => d.toISOString());
    const tudo = async (fn) => {
      const linhas = [];
      for (let i = 0; ; i += 1000) {
        const r = await D.direto(fn().range(i, i + 999));
        if (r.erro) throw r;
        linhas.push(...r.data);
        if (r.data.length < 1000) return linhas;
      }
    };
    try {
      const [vendas, pagamentos, movs, turnos] = await Promise.all([
        tudo(() => D.sb.from('v_vendas').select('*').gte('ocorrido_em', a).lt('ocorrido_em', b).order('ocorrido_em')),
        tudo(() => D.sb.from('pagamentos').select('*').gte('ocorrido_em', a).lt('ocorrido_em', b).order('ocorrido_em')),
        tudo(() => D.sb.from('movimentacoes').select('*').gte('ocorrido_em', a).lt('ocorrido_em', b).order('ocorrido_em')),
        tudo(() => D.sb.from('v_resumo_turno').select('*').gte('iniciado_em', a).lt('iniciado_em', b).order('iniciado_em')),
      ]);
      dados = { vendas, pagamentos, movs, turnos, iv };
      desenhar();
    } catch (e) {
      limpar(corpo, vazio(e.rede ? 'Os relatórios precisam de internet.' : (e.erro || String(e))));
    }
  }

  function agrupar(linhas, chave, campos) {
    const m = new Map();
    for (const l of linhas) {
      const k = typeof chave === 'function' ? chave(l) : l[chave];
      const g = m.get(k) || Object.fromEntries(campos.map((c) => [c, 0]));
      for (const c of campos) g[c] += c === 'entregas' ? 0 : Number(l[c === 'valor' ? 'valor' : c] || 0);
      (g._ids ||= new Set()).add(l.entrega_id);
      m.set(k, g);
    }
    return [...m.entries()].map(([k, g]) => ({ chave: k, ...g, entregas: g._ids.size }));
  }

  function desenhar() {
    const { vendas, pagamentos, movs, turnos } = dados;
    const total = vendas.reduce((s, v) => s + Number(v.valor), 0);
    const nEntregas = new Set(vendas.filter((v) => !v.eh_estorno).map((v) => v.entrega_id)).size;
    const porProduto = agrupar(vendas, 'produto', ['quantidade', 'valor']).sort((x, y) => y.valor - x.valor);
    const porEntregador = agrupar(vendas, 'entregador', ['quantidade', 'valor']).sort((x, y) => y.valor - x.valor);
    const porForma = Object.keys(FORMAS).map((f) => ({ f, valor: vendas.filter((v) => v.forma_pagamento === f).reduce((s, v) => s + Number(v.valor), 0) }));
    const recebido = pagamentos.filter((p) => p.tipo !== 'ajuste').reduce((s, p) => s + Number(p.valor), 0);
    const recebidoFiado = pagamentos.filter((p) => p.tipo === 'fiado').reduce((s, p) => s + Number(p.valor), 0);
    const vendidoFiado = porForma.find((x) => x.f === 'fiado').valor;
    const aReceber = D.tabela('fiado').filter((f) => Number(f.saldo) > 0.009).reduce((s, f) => s + Number(f.saldo), 0);
    const movPorTipo = {};
    for (const m of movs) {
      const k = `${m.tipo}|${m.produto_id}`;
      movPorTipo[k] ||= { tipo: m.tipo, produto: produto(m.produto_id).nome, cheios: 0, vazios: 0 };
      movPorTipo[k].cheios += m.tipo === 'ajuste' ? (m.dep_cheios + m.ent_cheios) : m.qtd_cheios;
      movPorTipo[k].vazios += m.tipo === 'ajuste' ? (m.dep_vazios + m.ent_vazios) : m.qtd_vazios;
    }
    const divergentes = turnos.filter((t) => t.divergencia_produto || (t.dinheiro_contado !== null && Math.abs(Number(t.diferenca_dinheiro)) > 0.009));
    const maxP = Math.max(1, ...porProduto.map((x) => x.valor)), maxE = Math.max(1, ...porEntregador.map((x) => x.valor)), maxF = Math.max(1, ...porForma.map((x) => x.valor));

    limpar(corpo,
      h('div', { class: 'grade-numeros' },
        h('div', { class: 'numero' }, h('span', {}, 'Vendido'), h('strong', {}, brl(total)), h('small', {}, `${nEntregas} entrega(s)`)),
        h('div', { class: 'numero' }, h('span', {}, 'Recebido'), h('strong', {}, brl(recebido)), h('small', {}, `inclui ${brl(recebidoFiado)} de fiado`)),
        h('div', { class: 'numero' }, h('span', {}, 'Vendido fiado'), h('strong', {}, brl(vendidoFiado)), h('small', {}, 'no período')),
        h('div', { class: 'numero' }, h('span', {}, 'A receber hoje'), h('strong', {}, brl(aReceber)), h('small', {}, 'fiado total em aberto'))),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por produto'),
        porProduto.length ? porProduto.map((x) => barra(`${x.chave} · ${num(x.quantidade)} un.`, x.valor, maxP)) : h('p', { class: 'suave' }, 'Sem vendas.')),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por entregador'),
        porEntregador.length ? porEntregador.map((x) => barra(`${x.chave} · ${x.entregas} entrega(s)`, x.valor, maxE)) : h('p', { class: 'suave' }, 'Sem vendas.')),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por forma de pagamento'),
        porForma.map((x) => barra(FORMAS[x.f], x.valor, maxF, x.f === 'fiado' ? 'vermelho' : ''))),
      h('div', { class: 'cartao' }, h('h2', {}, 'Movimentação de estoque'),
        Object.values(movPorTipo).length ? h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Tipo'), h('th', {}, 'Cheios'), h('th', {}, 'Vazios'))),
          h('tbody', {}, Object.values(movPorTipo).map((m) => h('tr', {}, h('td', {}, `${TIPOS[m.tipo]} · ${m.produto}`), h('td', {}, num(m.cheios)), h('td', {}, num(m.vazios)))))))
          : h('p', { class: 'suave' }, 'Sem movimentação.')),
      h('div', { class: 'cartao' + (divergentes.length ? ' com-dif' : '') }, h('h2', {}, `Divergências (${divergentes.length})`),
        divergentes.length ? divergentes.map((t) => h('p', {}, h('strong', {}, t.entregador), ` · ${new Date(t.iniciado_em).toLocaleDateString('pt-BR')}: `,
          [t.divergencia_produto ? 'produto não bateu' : null, Math.abs(Number(t.diferenca_dinheiro)) > 0.009 ? `dinheiro ${brl(t.diferenca_dinheiro)}` : null].filter(Boolean).join(' e '))) :
          h('p', { class: 'suave' }, 'Nenhuma no período.')),
      h('div', { class: 'cartao' }, h('h2', {}, 'Exportar (CSV para Excel)'),
        h('div', { class: 'botoes-col-cheio' },
          h('button', { class: 'btn secundario', onclick: csvVendas }, 'Vendas (item a item)'),
          h('button', { class: 'btn secundario', onclick: csvPagamentos }, 'Pagamentos recebidos'),
          h('button', { class: 'btn secundario', onclick: csvMovs }, 'Movimentações de estoque'),
          h('button', { class: 'btn secundario', onclick: csvFiado }, 'Fiado em aberto (hoje)'))),
      h('div', { class: 'cartao' }, h('h2', {}, 'Entregas do período'),
        h('p', { class: 'suave pequeno' }, 'Para corrigir uma entrega lançada errada, toque nela e estorne. O estorno cria um lançamento inverso com o motivo.'),
        h('div', { class: 'lista' }, listaEntregas(vendas))));
  }

  function listaEntregas(vendas) {
    const porEntrega = new Map();
    for (const v of vendas) {
      const e = porEntrega.get(v.entrega_id) || { ...v, itens: [], total: 0 };
      e.itens.push(`${v.quantidade} ${v.produto}`); e.total += Number(v.valor);
      porEntrega.set(v.entrega_id, e);
    }
    // entregas que já têm um estorno no período
    const estornadas = new Set(vendas.filter((v) => v.estorno_de).map((v) => v.estorno_de));
    const es = [...porEntrega.values()].sort((a, b) => String(b.ocorrido_em).localeCompare(String(a.ocorrido_em)));
    return es.slice(0, 200).map((e) => {
      const travada = e.eh_estorno || estornadas.has(e.entrega_id);
      return h('button', { class: 'item compacto entrega-rel' + (travada ? ' inativo' : ''), onclick: () => !travada && estornar(e) },
        h('div', { class: 'item-texto' },
          h('div', { class: 'linha-topo' }, h('strong', {}, e.cliente || 'Avulsa'), h('strong', {}, brl(e.total))),
          h('span', {}, `${dataHora(e.ocorrido_em)} · ${e.entregador} · ${e.itens.join(', ')}`),
          h('div', {}, e.eh_estorno ? etiqueta('Estorno', 'cinza') : estornadas.has(e.entrega_id) ? etiqueta('Estornada', 'cinza')
            : etiqueta(FORMAS[e.forma_pagamento], e.forma_pagamento === 'fiado' ? 'vermelho' : 'verde'))));
    });
  }

  function estornar(e) {
    const motivo = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Ex.: lançada no cliente errado' });
    const f = folha('Estornar entrega', [
      h('p', {}, `${e.cliente || 'Avulsa'} · ${brl(e.total)} ${FORMAS[e.forma_pagamento]} · ${dataHora(e.ocorrido_em)} · ${e.entregador}`),
      h('p', { class: 'suave pequeno' }, 'Desfaz o efeito no estoque, no fiado e no caixa com um lançamento inverso. A entrega original continua no histórico.'),
      campo('Motivo *', motivo),
    ], { rodape: [h('button', { class: 'btn perigo grande', onclick: async () => {
      if (!motivo.value.trim()) return toast('Informe o motivo.', 'erro');
      const r = await D.direto(D.sb.rpc('estornar_entrega', { p_op: uuid(), p_entrega_id: e.entrega_id, p_motivo: motivo.value.trim() }));
      if (r.erro) return toast(r.rede ? 'Precisa de internet.' : r.erro, 'erro');
      toast('Entrega estornada.'); f.fechar(); carregar();
      D.baixarVarias(['fiado', 'carga', 'vasilhames', 'vasilhames_total', 'resumos', 'vendas_hoje', 'entregas_recentes']);
    } }, 'Estornar')] });
  }

  const sufixo = () => dados.iv.map((d) => d.toISOString().slice(0, 10)).join('_a_');
  function csvVendas() {
    baixarCsv(`vendas_${sufixo()}.csv`, [
      [(v) => dataCsv(v.ocorrido_em), 'Data'], ['entregador', 'Entregador'], ['cliente', 'Cliente'], ['bairro', 'Bairro'],
      ['produto', 'Produto'], ['quantidade', 'Quantidade'], ['preco_unitario', 'Preço unitário'], ['valor', 'Valor'],
      [(v) => FORMAS[v.forma_pagamento], 'Pagamento'], ['vazios_recebidos', 'Vazios recebidos'], [(v) => v.eh_estorno ? 'sim' : '', 'Estorno'],
    ], dados.vendas);
  }
  function csvPagamentos() {
    const tipos = { na_entrega: 'Na entrega', fiado: 'Pagamento de fiado', ajuste: 'Ajuste' };
    baixarCsv(`pagamentos_${sufixo()}.csv`, [
      [(p) => dataCsv(p.ocorrido_em), 'Data'], [(p) => tipos[p.tipo], 'Tipo'], [(p) => FORMAS[p.forma] || '', 'Forma'],
      ['valor', 'Valor'], [(p) => p.cliente_id ? cliente(p.cliente_id).nome : '', 'Cliente'], [(p) => nomePerfil(p.recebido_por), 'Recebido por'], ['motivo', 'Motivo'],
    ], dados.pagamentos);
  }
  function csvMovs() {
    baixarCsv(`estoque_${sufixo()}.csv`, [
      [(m) => dataCsv(m.ocorrido_em), 'Data'], [(m) => TIPOS[m.tipo], 'Tipo'], [(m) => produto(m.produto_id).nome, 'Produto'],
      ['dep_cheios', 'Depósito cheios'], ['dep_vazios', 'Depósito vazios'], ['ent_cheios', 'Entregador cheios'], ['ent_vazios', 'Entregador vazios'],
      ['cli_vasilhames', 'Vasilhames cliente'], [(m) => m.entregador_id ? nomePerfil(m.entregador_id) : '', 'Entregador'],
      [(m) => nomePerfil(m.criado_por), 'Registrado por'], ['fornecedor', 'Fornecedor'], ['custo_unitario', 'Custo unitário'], ['motivo', 'Motivo'],
    ], dados.movs);
  }
  function csvFiado() {
    baixarCsv(`fiado_${new Date().toISOString().slice(0, 10)}.csv`, [
      ['nome', 'Cliente'], ['telefone', 'Telefone'], ['bairro', 'Bairro'], ['saldo', 'Deve'],
      [(f) => f.desde ? new Date(f.desde).toLocaleDateString('pt-BR') : '', 'Desde'], ['dias', 'Dias'],
    ], D.tabela('fiado').filter((f) => Number(f.saldo) > 0.009).sort((x, y) => String(x.desde).localeCompare(String(y.desde))));
  }

  carregar();
}
