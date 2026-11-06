// Registrar entrega, fiado (a receber) e vasilhames.
import * as D from './dados.js';
import { digitando,
  h, limpar, icone, toast, folha, confirmar, campo, entrada, contador, escolha,
  brl, lerValor, valorParaCampo, normalizar, uuid, linkWhats, vazio, etiqueta, dataHora, num,
} from './ui.js';
import { nomePerfil, formCliente, detalheCliente, extrasCliente } from './cadastros.js';
import { produtosAtivos, cargaDe, turnoAberto } from './estoque.js';

export const FORMAS = { pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão', fiado: 'Fiado' };
const produto = (id) => D.tabela('produtos').find((p) => p.id === id) || { nome: '?' };
const cliente = (id) => D.tabela('clientes').find((c) => c.id === id);
export const precoPara = (clienteId, produtoId) => {
  const esp = clienteId && D.tabela('precos_cliente').find((x) => x.cliente_id === clienteId && x.produto_id === produtoId);
  return Number(esp ? esp.preco : produto(produtoId).preco_padrao || 0);
};
export const fiadoDe = (clienteId) => D.tabela('fiado').find((f) => f.cliente_id === clienteId && Number(f.saldo) > 0.009);
export const vasilhamesDe = (clienteId) => D.tabela('vasilhames').filter((v) => v.cliente_id === clienteId && Number(v.saldo));
const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
// Outros módulos podem pôr blocos no topo da tela Entregar (ex.: pedidos)
export const ganchos = { topoEntregar: null };

// Mensagem de cobrança com os dados do negócio
export function mensagemCobranca(c, valor) {
  const cfg = D.config();
  return (cfg.msg_cobranca || '')
    .replaceAll('{nome}', (c.nome || '').trim())
    .replaceAll('{valor}', brl(valor))
    .replaceAll('{pix}', cfg.chave_pix || '(peça a chave Pix)')
    .replaceAll('{negocio}', cfg.nome_negocio || '');
}

// =====================================================================
// ENTREGAR
// =====================================================================
// Rascunho guardado enquanto o entregador troca de aba
let rascunho = novoRascunho();
function novoRascunho() { return { clienteId: null, itens: {}, forma: null, pedidoId: null, vaziosMexidos: {} }; }
function recentes() { try { return JSON.parse(localStorage.getItem('taka-recentes') || '[]'); } catch { return []; } }
function guardarRecente(id) {
  try { localStorage.setItem('taka-recentes', JSON.stringify([id, ...recentes().filter((x) => x !== id)].slice(0, 8))); } catch { /* sem espaço */ }
}

// Chamado pelos pedidos: já deixa cliente, produto e quantidade escolhidos
export function prepararPedido(p) {
  rascunho = novoRascunho();
  rascunho.clienteId = p.cliente_id;
  rascunho.pedidoId = p.id;
  const prod = p.produto_id || produtosAtivos()[0]?.id;
  if (prod) rascunho.itens[prod] = { qtd: p.quantidade || 1, vazios: produto(prod).retornavel ? (p.quantidade || 1) : 0 };
  location.hash = '#/entregar';
  window.dispatchEvent(new Event('taka-rascunho'));
}

export function telaEntregar(el, ctx) {
  const eu = ctx.perfil.id;
  let termo = '';
  const corpo = h('div');
  el.append(corpo);

  const garantirProduto = () => {
    if (!Object.keys(rascunho.itens).length) {
      const carga = cargaDe(eu);
      const p = produtosAtivos().find((x) => carga.some((c) => c.produto_id === x.id && c.cheios > 0)) || produtosAtivos()[0];
      if (p) rascunho.itens[p.id] = { qtd: 1, vazios: p.retornavel ? 1 : 0 };
    }
  };

  const desenhar = () => {
    const turno = turnoAberto(eu);
    const aberto = turno && !turno.encerrado_em;
    garantirProduto();
    limpar(corpo,
      !aberto ? h('a', { class: 'aviso alerta', href: '#/carga' }, icone('alerta'),
        h('span', {}, turno ? 'Você já fez a devolução. Envie o fechamento em Minha carga para abrir outro turno.' : 'Abra o turno em Minha carga antes de entregar.')) : null,
      ganchos.topoEntregar ? ganchos.topoEntregar(ctx) : null,
      blocoCliente(),
      rascunho.clienteId ? [blocoProdutos(), blocoPagamento(), blocoConfirmar(turno, aberto)] : null,
      blocoHoje());
  };

  // ---------- 1. Cliente ----------
  function blocoCliente() {
    if (rascunho.clienteId) {
      const c = rascunho.clienteId === 'avulso' ? null : cliente(rascunho.clienteId);
      const deve = c && fiadoDe(c.id);
      const vas = c ? vasilhamesDe(c.id) : [];
      const pedido = rascunho.pedidoId && D.tabela('pedidos').find((p) => p.id === rascunho.pedidoId);
      return h('div', { class: 'cartao cliente-escolhido' },
        h('div', { class: 'linha-topo' },
          h('div', {}, h('span', { class: 'passo' }, 'Cliente'), h('h2', {}, c ? c.nome : 'Venda avulsa')),
          h('button', { class: 'btn-texto', onclick: () => { rascunho.clienteId = null; rascunho.pedidoId = null; desenhar(); } }, 'Trocar')),
        c ? h('p', { class: 'suave' }, [c.endereco, c.bairro].filter(Boolean).join(' · ')) : h('p', { class: 'suave' }, 'Sem cadastro: não pode ser fiado.'),
        c && c.observacoes ? h('p', { class: 'obs' }, c.observacoes) : null,
        pedido ? h('p', {}, etiqueta('Pedido', 'azul'), ' ', pedido.observacao || `${pedido.quantidade} ${produto(pedido.produto_id).nome}`) : null,
        h('div', { class: 'etiquetas' },
          deve ? etiqueta(`Deve ${brl(deve.saldo)} · ${deve.dias} dia(s)`, 'vermelho') : null,
          vas.map((v) => etiqueta(`${v.saldo} vasilhame(s) ${v.produto}`, ''))));
    }
    const busca = entrada({ type: 'search', placeholder: 'Nome, bairro ou telefone', value: termo, 'aria-label': 'Buscar cliente', enterkeyhint: 'search' });
    const resultados = h('div', { class: 'lista' });
    const mostrar = () => {
      const t = normalizar(termo).trim();
      const digitos = t.replace(/\D/g, '');
      const ativos = D.tabela('clientes').filter((c) => c.ativo !== false);
      const lista = t
        ? ativos.filter((c) => normalizar(`${c.nome} ${c.bairro} ${c.endereco}`).includes(t) || (digitos && String(c.telefone).replace(/\D/g, '').includes(digitos))).slice(0, 8)
        : recentes().map(cliente).filter(Boolean).slice(0, 5);
      limpar(resultados,
        !t && lista.length ? h('p', { class: 'suave pequeno' }, 'Recentes') : null,
        lista.map((c) => h('button', { class: 'item', onclick: () => escolherCliente(c.id) },
          h('div', { class: 'item-texto' }, h('strong', {}, c.nome), h('span', {}, [c.bairro, c.endereco].filter(Boolean).join(' · '))),
          fiadoDe(c.id) ? etiqueta('Fiado', 'vermelho') : null)),
        t && !lista.length ? h('p', { class: 'suave' }, 'Nenhum cliente com esse nome.') : null);
    };
    busca.addEventListener('input', () => { termo = busca.value; mostrar(); });
    mostrar();
    setTimeout(() => { if (!matchMedia('(pointer: coarse)').matches) busca.focus(); }, 0);
    return h('div', { class: 'cartao' },
      h('span', { class: 'passo' }, '1. Para quem?'),
      h('div', { class: 'busca' }, icone('busca'), busca),
      resultados,
      h('div', { class: 'botoes-lado' },
        h('button', { class: 'btn secundario', onclick: () => formCliente(ctx, { nome: termo }, (c) => escolherCliente(c.id)) }, icone('mais'), 'Novo cliente'),
        h('button', { class: 'btn secundario', onclick: () => escolherCliente('avulso') }, 'Avulsa')));
  }
  function escolherCliente(id) {
    rascunho.clienteId = id; termo = '';
    if (id === 'avulso' && rascunho.forma === 'fiado') rascunho.forma = null;
    desenhar();
  }

  // ---------- 2. Produtos ----------
  function blocoProdutos() {
    const carga = cargaDe(eu);
    const ps = produtosAtivos();
    const cli = rascunho.clienteId === 'avulso' ? null : rascunho.clienteId;
    const linhas = Object.entries(rascunho.itens).map(([pid, it]) => {
      const p = produto(pid);
      const q = contador(it.qtd, { min: 0, rotulo: 'Quantidade ' + p.nome, aoMudar: (n) => {
        it.qtd = n;
        if (p.retornavel && !rascunho.vaziosMexidos[pid] && vz) { it.vazios = n; vz.definir(n); }
        atualizarTotal();
      } });
      const vz = p.retornavel ? contador(it.vazios, { min: 0, rotulo: 'Vazios ' + p.nome, aoMudar: (n) => { it.vazios = n; rascunho.vaziosMexidos[pid] = true; } }) : null;
      const comigo = carga.find((c) => c.produto_id === pid);
      return h('div', { class: 'linha-produto' },
        h('div', { class: 'linha-produto-topo' }, h('strong', {}, p.nome),
          h('small', {}, `${brl(precoPara(cli, pid))} · com você: ${num(comigo ? comigo.cheios : 0)}`)),
        h('div', { class: 'linha-dupla' },
          h('div', {}, h('span', { class: 'rotulo' }, 'Quantidade'), q.el),
          vz ? h('div', {}, h('span', { class: 'rotulo' }, 'Vazios recebidos'), vz.el) : null));
    });
    const outros = ps.filter((p) => !rascunho.itens[p.id]);
    return h('div', { class: 'cartao' },
      h('span', { class: 'passo' }, '2. O quê?'),
      ps.length > 1 ? h('div', { class: 'chips' }, ps.map((p) => h('button', {
        type: 'button', class: 'chip' + (rascunho.itens[p.id] ? ' marcado' : ''),
        onclick: () => {
          if (rascunho.itens[p.id]) { if (Object.keys(rascunho.itens).length > 1) delete rascunho.itens[p.id]; }
          else rascunho.itens[p.id] = { qtd: 1, vazios: p.retornavel ? 1 : 0 };
          desenhar();
        } }, p.nome))) : null,
      linhas,
      outros.length && ps.length > 1 ? h('p', { class: 'suave pequeno' }, 'Toque nos nomes acima para somar ou tirar produtos.') : null);
  }

  // ---------- 3. Pagamento ----------
  let elTotal;
  function total() {
    const cli = rascunho.clienteId === 'avulso' ? null : rascunho.clienteId;
    return Object.entries(rascunho.itens).reduce((s, [pid, it]) => s + it.qtd * precoPara(cli, pid), 0);
  }
  function atualizarTotal() { if (elTotal) elTotal.textContent = brl(total()); }
  function blocoPagamento() {
    elTotal = h('strong', { class: 'total-valor' }, brl(total()));
    const esc = escolha(Object.entries(FORMAS).map(([k, t]) => [k, t, k === 'fiado' && rascunho.clienteId === 'avulso']),
      rascunho.forma, (v) => { rascunho.forma = v; });
    return h('div', { class: 'cartao' },
      h('div', { class: 'total' }, h('span', { class: 'passo' }, '3. Pagamento'), elTotal),
      esc.el);
  }

  // ---------- Confirmar ----------
  function blocoConfirmar(turno, aberto) {
    return h('button', { class: 'btn verde grande confirmar', disabled: !aberto, onclick: () => confirmarEntrega(turno) }, icone('check'), 'Confirmar entrega');
  }
  async function confirmarEntrega(turno) {
    const itens = Object.entries(rascunho.itens).map(([pid, it]) => ({ produto_id: pid, quantidade: it.qtd, vazios: produto(pid).retornavel ? it.vazios : 0 }))
      .filter((i) => i.quantidade > 0 || i.vazios > 0);
    if (!itens.length) return toast('Informe a quantidade.', 'erro');
    if (!rascunho.forma) return toast('Escolha a forma de pagamento.', 'erro');
    const carga = cargaDe(eu);
    const falta = itens.find((i) => i.quantidade > (carga.find((c) => c.produto_id === i.produto_id)?.cheios || 0));
    if (falta && !(await confirmar(`Sua carga mostra só ${carga.find((c) => c.produto_id === falta.produto_id)?.cheios || 0} de ${produto(falta.produto_id).nome}. Registrar mesmo assim?`))) return;

    const cli = rascunho.clienteId === 'avulso' ? null : rascunho.clienteId;
    const c = cli && cliente(cli);
    const valor = Math.round(total() * 100) / 100;
    const id = uuid();
    const agora = new Date().toISOString();
    const forma = rascunho.forma;
    const efeitos = [
      { tipo: 'insert', alvo: 'entregas_recentes', dados: { id, cliente_id: cli, entregador_id: eu, turno_id: turno.id, pedido_id: rascunho.pedidoId, forma_pagamento: forma, valor_total: valor, ocorrido_em: agora, estorno_de: null } },
      { tipo: 'somar', alvo: 'resumos', chaves: ['turno_id'], dados: { turno_id: turno.id, total_vendido: valor, ...(forma === 'fiado' ? { vendido_fiado: valor } : { ['recebido_' + forma]: valor }) }, linhaLocal: { entregador_id: eu, status: 'aberto' } },
    ];
    for (const i of itens) {
      const p = produto(i.produto_id);
      efeitos.push({ tipo: 'somar', alvo: 'carga', chaves: ['entregador_id', 'produto_id'], dados: { entregador_id: eu, produto_id: i.produto_id, cheios: -i.quantidade, vazios: p.retornavel ? i.vazios : 0 }, linhaLocal: { produto: p.nome } });
      if (p.retornavel) {
        efeitos.push({ tipo: 'somar', alvo: 'vasilhames_total', chaves: ['produto_id'], dados: { produto_id: i.produto_id, com_entregadores: i.vazios - i.quantidade, na_rua: i.quantidade - i.vazios } });
        if (cli) efeitos.push({ tipo: 'somar', alvo: 'vasilhames', chaves: ['cliente_id', 'produto_id'], dados: { cliente_id: cli, produto_id: i.produto_id, saldo: i.quantidade - i.vazios }, linhaLocal: { cliente: c?.nome, bairro: c?.bairro, produto: p.nome } });
      }
    }
    if (forma === 'fiado') efeitos.push({ tipo: 'somar', alvo: 'fiado', chaves: ['cliente_id'], dados: { cliente_id: cli, saldo: valor }, linhaLocal: { nome: c?.nome, telefone: c?.telefone, bairro: c?.bairro, endereco: c?.endereco, desde: agora, dias: 0 } });
    if (rascunho.pedidoId) efeitos.push({ tipo: 'update', alvo: 'pedidos', dados: { status: 'entregue' }, filtro: { id: rascunho.pedidoId } });

    await D.enfileirar({
      tipo: 'rpc', alvo: 'registrar_entrega', efeitos,
      dados: { p_op: '', p_entrega: { id, cliente_id: cli, turno_id: turno.id, pedido_id: rascunho.pedidoId, forma_pagamento: forma, ocorrido_em: agora, itens } },
      descricao: `Entrega ${c ? c.nome : 'avulsa'}: ${itens.map((i) => `${i.quantidade} ${produto(i.produto_id).nome}`).join(', ')} · ${brl(valor)} ${FORMAS[forma]}`,
    });
    if (cli) guardarRecente(cli);
    toast(`Entregue: ${brl(valor)} ${FORMAS[forma]}${c ? ' · ' + c.nome : ''}`);
    rascunho = novoRascunho();
    desenhar();
    window.scrollTo(0, 0);
  }

  // ---------- Entregas de hoje ----------
  function blocoHoje() {
    const hoje = D.inicioDoDia();
    const minhas = D.tabela('entregas_recentes').filter((e) => e.entregador_id === eu && e.ocorrido_em >= hoje && !e.estorno_de)
      .sort((a, b) => String(b.ocorrido_em).localeCompare(String(a.ocorrido_em)));
    if (!minhas.length) return null;
    const soma = minhas.reduce((s, e) => s + Number(e.valor_total), 0);
    return [h('h2', { class: 'titulo-secao' }, `Hoje: ${minhas.length} entrega(s) · ${brl(soma)}`),
      h('div', { class: 'lista' }, minhas.slice(0, 20).map((e) => h('div', { class: 'item compacto' },
        h('div', { class: 'item-texto' }, h('strong', {}, e.cliente_id ? (cliente(e.cliente_id)?.nome || 'Cliente') : 'Avulsa'), h('span', {}, hora(e.ocorrido_em))),
        h('strong', {}, brl(e.valor_total)), etiqueta(FORMAS[e.forma_pagamento], e.forma_pagamento === 'fiado' ? 'vermelho' : 'verde'))))];
  }

  desenhar();
  ctx.ao('dados', (n) => {
    if (['turnos', 'carga', 'produtos', 'fiado', 'vasilhames', 'pedidos', 'entregas_recentes'].includes(n) && !document.querySelector('.folha') && !digitando(el)) desenhar();
  });
  const aoRascunho = () => desenhar();
  window.addEventListener('taka-rascunho', aoRascunho);
  return () => window.removeEventListener('taka-rascunho', aoRascunho);
}

// =====================================================================
// FIADO
// =====================================================================
export function telaFiado(el, ctx) {
  let termo = '';
  const busca = entrada({ type: 'search', placeholder: 'Buscar cliente', 'aria-label': 'Buscar no fiado' });
  const topo = h('div');
  const lista = h('div', { class: 'lista' });
  busca.addEventListener('input', () => { termo = busca.value; desenhar(); });
  el.append(h('h1', {}, 'Fiado'), topo, h('div', { class: 'busca' }, icone('busca'), busca), lista);
  const desenhar = () => {
    const todos = D.tabela('fiado').filter((f) => Number(f.saldo) > 0.009)
      .sort((a, b) => String(a.desde).localeCompare(String(b.desde)));
    const t = normalizar(termo).trim();
    const achados = t ? todos.filter((f) => normalizar(`${f.nome} ${f.bairro}`).includes(t)) : todos;
    const soma = todos.reduce((s, f) => s + Number(f.saldo), 0);
    limpar(topo, h('div', { class: 'cartao resumo-fiado' },
      h('span', {}, 'A receber'), h('strong', {}, brl(soma)), h('span', { class: 'suave' }, `${todos.length} cliente(s) · mais antigo primeiro`)));
    limpar(lista, achados.length ? achados.map((f) => h('button', { class: 'item', onclick: () => folhaFiado(f.cliente_id, ctx) },
      h('div', { class: 'item-texto' }, h('strong', {}, f.nome), h('span', {}, [f.bairro, `há ${f.dias} dia(s)`].filter(Boolean).join(' · '))),
      h('strong', { class: 'valor-devido' + (f.dias >= 30 ? ' antigo' : '') }, brl(f.saldo)))) :
      vazio(t ? 'Ninguém com esse nome no fiado.' : 'Ninguém devendo. 🎉'));
  };
  desenhar();
  ctx.ao('dados', (n) => { if (n === 'fiado') desenhar(); });
}

export function folhaFiado(clienteId, ctx) {
  const f = D.tabela('fiado').find((x) => x.cliente_id === clienteId);
  const c = cliente(clienteId) || { id: clienteId, nome: f?.nome, telefone: f?.telefone };
  const saldo = f ? Number(f.saldo) : 0;
  const painel = folha(c.nome, [
    h('div', { class: 'resumo-fiado' }, h('span', {}, 'Deve'), h('strong', {}, brl(saldo)),
      f && f.desde ? h('span', { class: 'suave' }, `desde ${new Date(f.desde).toLocaleDateString('pt-BR')} · ${Number(f.dias) ? `há ${f.dias} dia(s)` : 'hoje'}`) : null),
    h('div', { class: 'botoes-col-cheio' },
      c.telefone && saldo > 0 ? h('a', { class: 'btn verde grande', href: linkWhats(c.telefone, mensagemCobranca(c, saldo)), target: '_blank', rel: 'noopener' }, icone('whats'), 'Cobrar no WhatsApp') : null,
      !c.telefone ? h('p', { class: 'suave' }, 'Cliente sem telefone cadastrado.') : null,
      h('button', { class: 'btn primario grande', onclick: () => { painel.fechar(); formPagamento(c, saldo, ctx); } }, icone('moeda'), 'Receber pagamento'),
      ctx.eAdmin ? h('button', { class: 'btn secundario', onclick: () => { painel.fechar(); formAjusteFiado(c); } }, 'Ajustar saldo (admin)') : null),
  ]);
}

function formPagamento(c, saldo, ctx) {
  const valor = entrada({ inputmode: 'decimal', value: valorParaCampo(saldo), 'aria-label': 'Valor recebido' });
  let forma = null;
  const esc = escolha([['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['cartao', 'Cartão']], null, (v) => { forma = v; }, { classe: 'tres' });
  const f = folha('Receber de ' + c.nome, [
    campo('Valor recebido (R$)', valor, saldo ? `Deve ${brl(saldo)}. Pode receber só uma parte.` : null),
    h('span', { class: 'rotulo' }, 'Como pagou?'), esc.el,
    h('p', { class: 'suave pequeno' }, 'Fica registrado que você recebeu.'),
  ], { rodape: [h('button', { class: 'btn verde grande', onclick: async () => {
    const v = lerValor(valor.value);
    if (!v || Number.isNaN(v) || v <= 0) return toast('Valor inválido.', 'erro');
    if (!forma) return toast('Escolha como pagou.', 'erro');
    if (v > saldo + 0.009 && !(await confirmar(`O valor é maior que a dívida (${brl(saldo)}). A diferença fica como crédito. Continuar?`))) return;
    const turno = turnoAberto(ctx.perfil.id);
    const t = turno && !turno.encerrado_em ? turno.id : null;
    const efeitos = [{ tipo: 'somar', alvo: 'fiado', chaves: ['cliente_id'], dados: { cliente_id: c.id, saldo: -v } }];
    if (t) efeitos.push({ tipo: 'somar', alvo: 'resumos', chaves: ['turno_id'], dados: { turno_id: t, ['recebido_' + forma]: v, recebido_de_fiado_antigo: v } });
    await D.enfileirar({ tipo: 'rpc', alvo: 'receber_pagamento', efeitos,
      dados: { p_op: '', p_cliente_id: c.id, p_valor: v, p_forma: forma, p_turno_id: t, p_quando: new Date().toISOString() },
      descricao: `Pagamento de fiado: ${c.nome} ${brl(v)} (${FORMAS[forma]})` });
    toast(`Recebido ${brl(v)} de ${c.nome}.`); f.fechar();
  } }, 'Confirmar pagamento')] });
}

function formAjusteFiado(c) {
  const valor = entrada({ inputmode: 'decimal', placeholder: '0,00' });
  let sentido = 'divida';
  const esc = escolha([['divida', 'Lançar dívida'], ['abater', 'Abater dívida']], sentido, (v) => { sentido = v; });
  const motivo = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Ex.: saldo do caderno antigo, desconto combinado' });
  const f = folha('Ajustar fiado de ' + c.nome, [
    esc.el, campo('Valor (R$)', valor), campo('Motivo *', motivo),
    h('p', { class: 'suave pequeno' }, 'Use "Lançar dívida" para o saldo que o cliente já devia antes do app.'),
  ], { rodape: [h('button', { class: 'btn primario grande', onclick: async () => {
    const v = lerValor(valor.value);
    if (!v || Number.isNaN(v) || v <= 0) return toast('Valor inválido.', 'erro');
    if (!motivo.value.trim()) return toast('Informe o motivo.', 'erro');
    const assinado = sentido === 'divida' ? -v : v;
    await D.enfileirar({ tipo: 'rpc', alvo: 'ajustar_fiado',
      dados: { p_op: '', p_cliente_id: c.id, p_valor: assinado, p_motivo: motivo.value.trim() },
      efeitos: [{ tipo: 'somar', alvo: 'fiado', chaves: ['cliente_id'], dados: { cliente_id: c.id, saldo: -assinado }, linhaLocal: { nome: c.nome, telefone: c.telefone, bairro: c.bairro, desde: new Date().toISOString(), dias: 0 } }],
      descricao: `Ajuste de fiado: ${c.nome} ${sentido === 'divida' ? '+' : '−'}${brl(v)}` });
    toast('Ajuste registrado.'); f.fechar();
  } }, 'Registrar')] });
}

// =====================================================================
// VASILHAMES
// =====================================================================
export function telaVasilhames(el, ctx) {
  let termo = '';
  const busca = entrada({ type: 'search', placeholder: 'Buscar cliente', 'aria-label': 'Buscar vasilhames' });
  const totais = h('div'), lista = h('div', { class: 'lista' });
  busca.addEventListener('input', () => { termo = busca.value; desenhar(); });
  el.append(totais, h('h2', { class: 'titulo-secao' }, 'Emprestados por cliente'), h('div', { class: 'busca' }, icone('busca'), busca), lista);
  const desenhar = () => {
    const tot = D.tabela('vasilhames_total');
    limpar(totais, tot.length ? h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela cartao-tabela compacta' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Produto'), h('th', {}, 'Depósito'), h('th', {}, 'Entreg.'), h('th', {}, 'Clientes'), h('th', {}, 'Total'))),
      h('tbody', {}, tot.map((t) => h('tr', {}, h('td', {}, t.nome), h('td', {}, num(t.no_deposito)), h('td', {}, num(t.com_entregadores)), h('td', {}, h('strong', {}, num(t.na_rua))), h('td', {}, num(t.no_deposito + t.com_entregadores + t.na_rua)))))))
      : vazio('Sem produtos retornáveis.'));
    const porCliente = {};
    for (const v of D.tabela('vasilhames')) if (Number(v.saldo)) (porCliente[v.cliente_id] ||= []).push(v);
    const t = normalizar(termo).trim();
    const itens = Object.entries(porCliente)
      .map(([id, vs]) => ({ id, vs, nome: vs[0].cliente || cliente(id)?.nome || '?', bairro: vs[0].bairro || cliente(id)?.bairro || '', soma: vs.reduce((s, v) => s + Number(v.saldo), 0) }))
      .filter((x) => !t || normalizar(`${x.nome} ${x.bairro}`).includes(t))
      .sort((a, b) => b.soma - a.soma);
    limpar(lista, itens.length ? itens.slice(0, 100).map((x) => h('button', { class: 'item', onclick: () => detalheCliente(x.id, ctx) },
      h('div', { class: 'item-texto' }, h('strong', {}, x.nome), h('span', {}, x.vs.map((v) => `${v.saldo} ${v.produto}`).join(' · ')), x.bairro ? h('small', {}, x.bairro) : null),
      icone('seta', 'seta'))) : vazio('Nenhum vasilhame emprestado.'));
  };
  desenhar();
  ctx.ao('dados', (n) => { if (n === 'vasilhames' || n === 'vasilhames_total') desenhar(); });
}

// Bloco no detalhe do cliente: fiado e vasilhames
extrasCliente.push((c, ctx) => {
  const deve = fiadoDe(c.id);
  const vas = vasilhamesDe(c.id);
  const retornaveis = produtosAtivos().filter((p) => p.retornavel);
  return h('div', { class: 'secao' },
    h('h3', {}, 'Fiado e vasilhames'),
    deve ? h('button', { class: 'item', onclick: () => folhaFiado(c.id, ctx) },
      h('div', { class: 'item-texto' }, h('strong', {}, `Deve ${brl(deve.saldo)}`), h('span', {}, `há ${deve.dias} dia(s)`)), icone('seta', 'seta'))
      : h('p', {}, 'Não deve nada.', ctx.eAdmin ? [' ', h('button', { class: 'btn-texto', onclick: () => formAjusteFiado(c) }, 'Lançar saldo antigo')] : null),
    h('p', {}, vas.length ? 'Vasilhames com o cliente: ' + vas.map((v) => `${v.saldo} ${v.produto}`).join(', ') : 'Nenhum vasilhame emprestado.'),
    ctx.eAdmin && retornaveis.length ? h('button', { class: 'btn-texto', onclick: () => formAjusteVasilhame(c, retornaveis) }, 'Ajustar vasilhames') : null);
});

function formAjusteVasilhame(c, retornaveis) {
  let prod = retornaveis[0].id;
  const escP = escolha(retornaveis.map((p) => [p.id, p.nome]), prod, (v) => { prod = v; });
  let sentido = '+';
  const escS = escolha([['+', 'Cliente tem mais'], ['-', 'Cliente tem menos']], sentido, (v) => { sentido = v; });
  const qtd = contador(1, { min: 1 });
  const motivo = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Ex.: saldo inicial, cliente comprou o vasilhame' });
  const f = folha('Vasilhames de ' + c.nome, [escP.el, escS.el, campo('Quantidade', qtd.el), campo('Motivo *', motivo)], { rodape: [
    h('button', { class: 'btn primario grande', onclick: async () => {
      if (!motivo.value.trim()) return toast('Informe o motivo.', 'erro');
      const n = qtd.valor * (sentido === '-' ? -1 : 1);
      await D.enfileirar({ tipo: 'rpc', alvo: 'ajustar_estoque',
        dados: { p_op: '', p_produto_id: prod, p_motivo: motivo.value.trim(), p_cli_vasilhames: n, p_cliente_id: c.id },
        efeitos: [
          { tipo: 'somar', alvo: 'vasilhames', chaves: ['cliente_id', 'produto_id'], dados: { cliente_id: c.id, produto_id: prod, saldo: n }, linhaLocal: { cliente: c.nome, bairro: c.bairro, produto: produto(prod).nome } },
          { tipo: 'somar', alvo: 'vasilhames_total', chaves: ['produto_id'], dados: { produto_id: prod, na_rua: n } },
        ],
        descricao: `Ajuste de vasilhame: ${c.nome} ${n > 0 ? '+' : ''}${n} ${produto(prod).nome}` });
      toast('Ajuste registrado.'); f.fechar();
    } }, 'Registrar')] });
}
