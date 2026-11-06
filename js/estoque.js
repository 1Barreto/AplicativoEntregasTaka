// Estoque do depósito, carga do entregador (retirada/devolução) e conferência de turnos.
import * as D from './dados.js';
import { digitando,
  h, limpar, icone, toast, folha, confirmar, campo, entrada, selecao, contador,
  brl, lerValor, uuid, vazio, etiqueta, dataHora, num,
} from './ui.js';
import { nomePerfil } from './cadastros.js';

// Outros módulos completam a tela Minha carga (fechamento de caixa)
export const ganchosCarga = { fechamento: null, ultimoTurno: null };

export const TIPOS = {
  entrada: 'Entrada do fornecedor', saida_vazios: 'Vazios ao fornecedor', retirada: 'Retirada',
  devolucao: 'Devolução', venda: 'Venda', ajuste: 'Ajuste',
};

// ---------------------------------------------------------------------
// Consultas locais
// ---------------------------------------------------------------------
export const produtosAtivos = () => D.tabela('produtos').filter((p) => p.ativo)
  .sort((a, b) => (a.ordem - b.ordem) || a.nome.localeCompare(b.nome, 'pt-BR'));
const produto = (id) => D.tabela('produtos').find((p) => p.id === id) || { nome: '?' };
export const saldo = (produtoId) => D.tabela('saldo_deposito').find((s) => s.produto_id === produtoId) || { cheios: 0, vazios: 0 };
const ordemProduto = (id) => { const p = D.tabela('produtos').find((x) => x.id === id); return p ? p.ordem * 1000 + 0 : 1e9; };
export const cargaDe = (entregadorId) => D.tabela('carga')
  .filter((c) => c.entregador_id === entregadorId && (Number(c.cheios) || Number(c.vazios)))
  .sort((a, b) => ordemProduto(a.produto_id) - ordemProduto(b.produto_id));
export const turnoAberto = (entregadorId) => D.tabela('turnos')
  .filter((t) => t.entregador_id === entregadorId && t.status === 'aberto')
  .sort((a, b) => String(b.iniciado_em).localeCompare(String(a.iniciado_em)))[0];
const hora = (d) => d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
const plural = (n, um, varios) => `${num(n)} ${Math.abs(n) === 1 ? um : varios}`;

// Efeitos locais (aparecem na tela antes do servidor confirmar)
const efDeposito = (produtoId, cheios, vazios) => ({ tipo: 'somar', alvo: 'saldo_deposito', chaves: ['produto_id'], dados: { produto_id: produtoId, cheios, vazios } });
const efCarga = (entregadorId, produtoId, cheios, vazios) => ({
  tipo: 'somar', alvo: 'carga', chaves: ['entregador_id', 'produto_id'],
  dados: { entregador_id: entregadorId, produto_id: produtoId, cheios, vazios },
  linhaLocal: { produto: produto(produtoId).nome, entregador: nomePerfil(entregadorId) },
});

function agoraCampo() {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// =====================================================================
// ESTOQUE (admin e estoquista)
// =====================================================================
export function telaEstoque(el, ctx) {
  const desenhar = () => {
    const ps = produtosAtivos();
    const baixos = ps.filter((p) => saldo(p.id).cheios <= p.estoque_minimo);
    const porEntregador = {};
    for (const c of D.tabela('carga')) if (Number(c.cheios) || Number(c.vazios)) (porEntregador[c.entregador_id] ||= []).push(c);
    limpar(el,
      h('h1', {}, 'Estoque do depósito'),
      baixos.map((p) => h('div', { class: 'aviso alerta' }, icone('alerta'),
        h('span', {}, `Estoque baixo: ${p.nome} com ${plural(saldo(p.id).cheios, 'cheio', 'cheios')} (alerta em ${p.estoque_minimo})`))),
      ps.length ? h('div', { class: 'grade-estoque' }, ps.map((p) => {
        const s = saldo(p.id);
        const baixo = s.cheios <= p.estoque_minimo;
        return h('div', { class: 'cartao-estoque' + (baixo ? ' baixo' : '') },
          h('strong', { class: 'nome' }, p.nome),
          h('div', { class: 'qtd' }, h('b', {}, num(s.cheios)), h('span', {}, 'cheios')),
          p.retornavel ? h('div', { class: 'qtd vazios' }, h('b', {}, num(s.vazios)), h('span', {}, 'vazios')) : null);
      })) : vazio('Cadastre produtos primeiro (Mais › Produtos).'),
      h('div', { class: 'botoes-lado' },
        h('button', { class: 'btn primario', onclick: () => formDeposito('entrada') }, icone('mais'), 'Entrada'),
        h('button', { class: 'btn secundario', onclick: () => formDeposito('saida_vazios') }, 'Vazios ao fornecedor')),
      ctx.eAdmin ? h('button', { class: 'btn secundario grande', onclick: () => formAjuste() }, icone('editar'), 'Ajuste de estoque') : null,
      h('h2', { class: 'titulo-secao' }, 'Com os entregadores agora'),
      Object.keys(porEntregador).length ? h('div', { class: 'lista' }, Object.entries(porEntregador).map(([id, linhas]) =>
        h('div', { class: 'item' }, h('div', { class: 'item-texto' },
          h('strong', {}, nomePerfil(id)),
          linhas.map((c) => h('span', {}, `${produto(c.produto_id).nome}: ${plural(c.cheios, 'cheio', 'cheios')}` + (Number(c.vazios) ? ` · ${plural(c.vazios, 'vazio', 'vazios')}` : ''))))))) :
        h('p', { class: 'suave' }, 'Nenhum entregador com carga.'),
      h('div', { class: 'menu' },
        h('a', { class: 'item-menu', href: '#/conferir' }, icone('check'), h('span', {}, 'Conferir turnos'), icone('seta', 'seta')),
        h('a', { class: 'item-menu', href: '#/historico' }, icone('lista'), h('span', {}, 'Histórico de movimentações'), icone('seta', 'seta'))));
  };
  desenhar();
  ctx.ao('dados', (n) => { if (['saldo_deposito', 'carga', 'produtos', 'perfis'].includes(n)) desenhar(); });
}

function formDeposito(tipo) {
  const entrada_ = tipo === 'entrada';
  const ps = produtosAtivos().filter((p) => entrada_ || p.retornavel);
  const fornecedor = entrada({ placeholder: 'Nome do fornecedor (opcional)' });
  const quando = entrada({ type: 'datetime-local', value: agoraCampo(), max: agoraCampo() });
  const linhas = ps.map((p) => {
    const s = saldo(p.id);
    const c = contador(0, { rotulo: p.nome });
    const custo = entrada_ ? entrada({ inputmode: 'decimal', placeholder: 'Custo un. (R$)', 'aria-label': 'Custo unitário ' + p.nome }) : null;
    return { p, c, custo, el: h('div', { class: 'linha-produto' },
      h('div', { class: 'linha-produto-topo' }, h('strong', {}, p.nome),
        h('small', {}, entrada_ ? `no depósito: ${num(s.cheios)} cheios` : `no depósito: ${num(s.vazios)} vazios`)),
      h('div', { class: 'linha-produto-acoes' }, c.el, custo)) };
  });
  const f = folha(entrada_ ? 'Entrada do fornecedor' : 'Vazios ao fornecedor', [
    entrada_ ? null : h('p', { class: 'suave' }, 'Vasilhames vazios que saem do depósito e voltam para o fornecedor na troca.'),
    ...linhas.map((l) => l.el),
    campo('Fornecedor', fornecedor),
    campo('Data e hora', quando),
  ], { rodape: [h('button', { class: 'btn primario grande', onclick: async () => {
    const itens = [];
    for (const l of linhas) {
      if (!l.c.valor) continue;
      const custo = l.custo ? lerValor(l.custo.value) : null;
      if (Number.isNaN(custo)) return toast('Custo inválido em ' + l.p.nome, 'erro');
      itens.push({ produto_id: l.p.id, qtd: l.c.valor, custo });
    }
    if (!itens.length) return toast('Informe pelo menos uma quantidade.', 'erro');
    if (!entrada_) {
      const passou = itens.find((i) => i.qtd > saldo(i.produto_id).vazios);
      if (passou && !(await confirmar(`O depósito mostra só ${saldo(passou.produto_id).vazios} vazios de ${produto(passou.produto_id).nome}. Registrar mesmo assim?`))) return;
    }
    await D.enfileirar({
      tipo: 'rpc', alvo: 'registrar_mov_deposito',
      dados: { p_op: '', p_tipo: tipo, p_itens: itens, p_fornecedor: fornecedor.value.trim() || null, p_quando: new Date(quando.value).toISOString() },
      efeitos: itens.map((i) => entrada_ ? efDeposito(i.produto_id, i.qtd, 0) : efDeposito(i.produto_id, 0, -i.qtd)),
      descricao: `${TIPOS[tipo]}: ` + itens.map((i) => `${i.qtd} ${produto(i.produto_id).nome}`).join(', '),
    });
    toast('Registrado.'); f.fechar();
  } }, 'Registrar')] });
}

function formAjuste() {
  const ps = produtosAtivos();
  const entregadores = D.tabela('perfis').filter((p) => p.ativo && ['entregador', 'admin'].includes(p.papel));
  const lugares = [['dep:cheios', 'Depósito — cheios'], ['dep:vazios', 'Depósito — vazios'],
    ...entregadores.flatMap((p) => [[`ent:${p.id}:cheios`, `${p.nome || p.email} — cheios`], [`ent:${p.id}:vazios`, `${p.nome || p.email} — vazios`]])];
  const prod = selecao(ps.map((p) => [p.id, p.nome]), ps[0]?.id);
  const lugar = selecao(lugares, 'dep:cheios');
  const sentido = selecao([['+', 'Somar (+)'], ['-', 'Tirar (−)']], '-');
  const qtd = contador(1, { min: 1 });
  const motivo = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Ex.: galão quebrado, contagem física, saldo inicial' });
  const f = folha('Ajuste de estoque', [
    h('p', { class: 'suave pequeno' }, 'O ajuste não apaga nada: fica no histórico com seu nome e o motivo.'),
    campo('Produto', prod), campo('Onde', lugar), campo('Somar ou tirar', sentido),
    campo('Quantidade', qtd.el), campo('Motivo *', motivo),
  ], { rodape: [h('button', { class: 'btn primario grande', onclick: async () => {
    if (!motivo.value.trim()) return toast('Informe o motivo.', 'erro');
    const n = qtd.valor * (sentido.value === '-' ? -1 : 1);
    const [onde, a, b] = lugar.value.split(':');
    const dados = { p_op: '', p_produto_id: prod.value, p_motivo: motivo.value.trim() };
    let efeito;
    if (onde === 'dep') {
      dados[a === 'cheios' ? 'p_dep_cheios' : 'p_dep_vazios'] = n;
      efeito = efDeposito(prod.value, a === 'cheios' ? n : 0, a === 'vazios' ? n : 0);
    } else {
      dados.p_entregador_id = a;
      dados[b === 'cheios' ? 'p_ent_cheios' : 'p_ent_vazios'] = n;
      efeito = efCarga(a, prod.value, b === 'cheios' ? n : 0, b === 'vazios' ? n : 0);
    }
    await D.enfileirar({ tipo: 'rpc', alvo: 'ajustar_estoque', dados, efeitos: [efeito],
      descricao: `Ajuste: ${n > 0 ? '+' : ''}${n} ${produto(prod.value).nome} (${lugares.find((l) => l[0] === lugar.value)[1]})` });
    toast('Ajuste registrado.'); f.fechar();
  } }, 'Registrar ajuste')] });
}

// =====================================================================
// HISTÓRICO DE MOVIMENTAÇÕES
// =====================================================================
export function telaHistorico(el, ctx) {
  const periodo = selecao([['hoje', 'Hoje'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['mes', 'Este mês'], ['outro', 'Escolher datas']], '7');
  const de = entrada({ type: 'date' }), ate = entrada({ type: 'date' });
  const datas = h('div', { class: 'linha-datas', hidden: true }, campo('De', de), campo('Até', ate));
  const prod = selecao([['', 'Todos os produtos'], ...D.tabela('produtos').map((p) => [p.id, p.nome])], '');
  const tipo = selecao([['', 'Todos os tipos'], ...Object.entries(TIPOS)], '');
  const quem = selecao([['', 'Todas as pessoas'], ...D.tabela('perfis').map((p) => [p.id, p.nome || p.email])], '');
  const lista = h('div', { class: 'lista' });
  const resumo = h('p', { class: 'suave pequeno' });
  el.append(h('div', { class: 'filtros' }, periodo, datas, prod, tipo, quem), resumo, lista);

  const intervalo = () => {
    const ini = new Date(); ini.setHours(0, 0, 0, 0);
    const fim = new Date(ini); fim.setDate(fim.getDate() + 1);
    const p = periodo.value;
    if (p === '7' || p === '30') ini.setDate(ini.getDate() - (Number(p) - 1));
    if (p === 'mes') ini.setDate(1);
    if (p === 'outro') {
      if (!de.value || !ate.value) return null;
      const a = new Date(de.value + 'T00:00'), b = new Date(ate.value + 'T00:00'); b.setDate(b.getDate() + 1);
      return [a, b];
    }
    return [ini, fim];
  };
  const buscar = async () => {
    datas.hidden = periodo.value !== 'outro';
    const iv = intervalo();
    if (!iv) return;
    limpar(lista, h('p', { class: 'suave' }, 'Carregando…'));
    let q = D.sb.from('movimentacoes').select('*')
      .gte('ocorrido_em', iv[0].toISOString()).lt('ocorrido_em', iv[1].toISOString())
      .order('ocorrido_em', { ascending: false }).limit(300);
    if (prod.value) q = q.eq('produto_id', prod.value);
    if (tipo.value) q = q.eq('tipo', tipo.value);
    if (quem.value) q = q.eq('criado_por', quem.value);
    const r = await D.direto(q);
    if (r.erro) return limpar(lista, vazio(r.rede ? 'O histórico precisa de internet.' : r.erro));
    resumo.textContent = r.data.length === 300 ? 'Mostrando as 300 mais recentes. Use os filtros para refinar.' : `${r.data.length} movimentação(ões)`;
    limpar(lista, r.data.length ? r.data.map(linhaMov) : vazio('Nada no período.'));
  };
  [periodo, de, ate, prod, tipo, quem].forEach((x) => x.addEventListener('change', buscar));
  buscar();
}

function linhaMov(m) {
  const partes = [];
  const fmt = (n, a, b) => `${n > 0 ? '+' : ''}${plural(n, a, b)}`;
  if (m.dep_cheios) partes.push(`Depósito ${fmt(m.dep_cheios, 'cheio', 'cheios')}`);
  if (m.dep_vazios) partes.push(`Depósito ${fmt(m.dep_vazios, 'vazio', 'vazios')}`);
  if (m.ent_cheios) partes.push(`${nomePerfil(m.entregador_id)} ${fmt(m.ent_cheios, 'cheio', 'cheios')}`);
  if (m.ent_vazios) partes.push(`${nomePerfil(m.entregador_id)} ${fmt(m.ent_vazios, 'vazio', 'vazios')}`);
  if (m.cli_vasilhames) partes.push(`Cliente ${fmt(m.cli_vasilhames, 'vasilhame', 'vasilhames')}`);
  const extras = [m.fornecedor, m.custo_unitario ? 'custo ' + brl(m.custo_unitario) + '/un' : null, m.motivo].filter(Boolean).join(' · ');
  return h('div', { class: 'item mov tipo-' + m.tipo },
    h('div', { class: 'item-texto' },
      h('strong', {}, `${TIPOS[m.tipo]} · ${produto(m.produto_id).nome}`),
      h('span', {}, partes.join(' · ') || '—'),
      extras ? h('small', {}, extras) : null,
      h('small', { class: 'quem' }, `${dataHora(m.ocorrido_em)} · por ${nomePerfil(m.criado_por)}`)));
}

// =====================================================================
// MINHA CARGA (entregador)
// =====================================================================
export function telaCarga(el, ctx) {
  const eu = ctx.perfil.id;
  const desenhar = () => {
    const turno = turnoAberto(eu);
    const carga = cargaDe(eu);
    const cartoes = () => carga.length ? h('div', { class: 'grade-estoque' }, carga.map((c) =>
      h('div', { class: 'cartao-estoque' },
        h('strong', { class: 'nome' }, produto(c.produto_id).nome),
        h('div', { class: 'qtd' }, h('b', {}, num(c.cheios)), h('span', {}, 'cheios')),
        Number(c.vazios) ? h('div', { class: 'qtd vazios' }, h('b', {}, num(c.vazios)), h('span', {}, 'vazios')) : null))) :
      h('p', { class: 'suave' }, 'Nada com você agora.');

    if (!turno) {
      return limpar(el,
        h('h1', {}, 'Minha carga'),
        h('div', { class: 'cartao destaque' },
          h('h2', {}, 'Nenhum turno aberto'),
          h('p', {}, 'Para começar, registre quantos galões cheios você está pegando no depósito.'),
          h('button', { class: 'btn primario grande', onclick: () => formRetirada(ctx, null) }, icone('caixa'), 'Iniciar turno')),
        ganchosCarga.ultimoTurno ? ganchosCarga.ultimoTurno(ctx) : null,
        carga.length ? [h('h2', { class: 'titulo-secao alerta' }, 'Ficou com você do turno anterior'), cartoes()] : null);
    }
    if (!turno.encerrado_em) {
      return limpar(el,
        h('h1', {}, 'Minha carga'),
        h('p', { class: 'suave' }, `Turno aberto desde ${hora(turno.iniciado_em)} de ${new Date(turno.iniciado_em).toLocaleDateString('pt-BR')}`),
        cartoes(),
        h('button', { class: 'btn secundario grande', onclick: () => formRetirada(ctx, turno) }, icone('mais'), 'Pegar mais no depósito'),
        h('button', { class: 'btn primario grande', onclick: () => formDevolucao(ctx, turno) }, icone('check'), 'Devolver e encerrar turno'));
    }
    // devolução já feita: mostra a conferência
    const difs = carga.flatMap((c) => {
      const p = produto(c.produto_id).nome, r = [];
      if (Number(c.cheios) > 0) r.push(`Faltou devolver ${plural(c.cheios, 'cheio', 'cheios')} de ${p}`);
      if (Number(c.cheios) < 0) r.push(`Devolveu ${plural(-c.cheios, 'cheio', 'cheios')} de ${p} a mais`);
      if (Number(c.vazios) > 0) r.push(`Faltou devolver ${plural(c.vazios, 'vazio', 'vazios')} de ${p}`);
      if (Number(c.vazios) < 0) r.push(`Devolveu ${plural(-c.vazios, 'vazio', 'vazios')} de ${p} a mais`);
      return r;
    });
    limpar(el,
      h('h1', {}, 'Minha carga'),
      h('div', { class: 'cartao' },
        h('h2', {}, 'Devolução registrada'),
        h('p', { class: 'suave' }, `Turno de ${hora(turno.iniciado_em)} a ${hora(turno.encerrado_em)}`),
        difs.length
          ? h('div', { class: 'aviso alerta col' }, h('strong', {}, 'A conferência não bateu:'), difs.map((d) => h('span', {}, d)),
              h('small', {}, 'O admin vai ver essa diferença. Se esqueceu algo, registre de novo abaixo.'))
          : h('div', { class: 'aviso ok' }, icone('check'), h('span', {}, 'Conferência OK: tudo bateu.'))),
      ganchosCarga.fechamento ? ganchosCarga.fechamento(turno, ctx) : null,
      h('button', { class: 'btn secundario grande', onclick: () => formDevolucao(ctx, turno) }, 'Devolver mais itens'));
  };
  desenhar();
  ctx.ao('dados', (n) => { if (['turnos', 'carga', 'produtos', 'saldo_deposito', 'resumos'].includes(n) && !digitando(el)) desenhar(); });
}

function formRetirada(ctx, turno) {
  const eu = ctx.perfil.id;
  const linhas = produtosAtivos().map((p) => {
    const s = saldo(p.id);
    const c = contador(0, { rotulo: p.nome });
    return { p, c, el: h('div', { class: 'linha-produto' },
      h('div', { class: 'linha-produto-topo' }, h('strong', {}, p.nome), h('small', {}, `no depósito: ${num(s.cheios)}`)),
      h('div', { class: 'linha-produto-acoes' }, c.el)) };
  });
  const f = folha(turno ? 'Pegar mais no depósito' : 'Iniciar turno', [
    h('p', { class: 'suave' }, 'Quantos galões CHEIOS você está levando?'),
    ...linhas.map((l) => l.el),
  ], { rodape: [h('button', { class: 'btn primario grande', onclick: async () => {
    const itens = linhas.filter((l) => l.c.valor > 0).map((l) => ({ produto_id: l.p.id, qtd: l.c.valor }));
    if (turno && !itens.length) return toast('Informe a quantidade.', 'erro');
    if (!turno && !itens.length && !(await confirmar('Iniciar o turno sem levar nenhum produto?'))) return;
    const agora = new Date().toISOString();
    const efeitos = itens.flatMap((i) => [efCarga(eu, i.produto_id, i.qtd, 0), efDeposito(i.produto_id, -i.qtd, 0)]);
    const desc = itens.map((i) => `${i.qtd} ${produto(i.produto_id).nome}`).join(', ');
    if (turno) {
      await D.enfileirar({ tipo: 'rpc', alvo: 'registrar_retirada', efeitos,
        dados: { p_op: '', p_turno_id: turno.id, p_itens: itens, p_quando: agora }, descricao: 'Retirada: ' + desc });
    } else {
      const id = uuid();
      efeitos.unshift({ tipo: 'insert', alvo: 'turnos', dados: { id, entregador_id: eu, iniciado_em: agora, status: 'aberto', encerrado_em: null } });
      await D.enfileirar({ tipo: 'rpc', alvo: 'iniciar_turno', efeitos,
        dados: { p_op: '', p_turno_id: id, p_itens: itens, p_quando: agora }, descricao: 'Início do turno' + (desc ? ': ' + desc : '') });
    }
    toast(turno ? 'Retirada registrada.' : 'Turno iniciado. Boas entregas!'); f.fechar();
  } }, 'Confirmar')] });
}

function formDevolucao(ctx, turno) {
  const eu = ctx.perfil.id;
  const carga = cargaDe(eu);
  const ps = produtosAtivos().filter((p) => carga.some((c) => c.produto_id === p.id) || p.retornavel);
  const linhas = ps.map((p) => {
    const c = carga.find((x) => x.produto_id === p.id) || { cheios: 0, vazios: 0 };
    const cheios = contador(0, { rotulo: 'Cheios ' + p.nome });
    const vazios = p.retornavel ? contador(0, { rotulo: 'Vazios ' + p.nome }) : null;
    return { p, cheios, vazios, el: h('div', { class: 'linha-produto' },
      h('div', { class: 'linha-produto-topo' }, h('strong', {}, p.nome),
        h('small', {}, `o app espera: ${num(c.cheios)} cheios` + (p.retornavel ? ` · ${num(c.vazios)} vazios` : ''))),
      h('div', { class: 'linha-dupla' },
        h('div', {}, h('span', { class: 'rotulo' }, 'Cheios que voltaram'), cheios.el),
        vazios ? h('div', {}, h('span', { class: 'rotulo' }, 'Vazios recolhidos'), vazios.el) : null)) };
  });
  const f = folha(turno.encerrado_em ? 'Devolver mais itens' : 'Devolução do turno', [
    h('p', { class: 'suave' }, 'Conte o que está entregando no depósito agora.'),
    ...linhas.map((l) => l.el),
  ], { rodape: [h('button', { class: 'btn primario grande', onclick: async () => {
    const itens = linhas.map((l) => ({ produto_id: l.p.id, cheios: l.cheios.valor, vazios: l.vazios ? l.vazios.valor : 0 }))
      .filter((i) => i.cheios || i.vazios);
    if (!itens.length && !(await confirmar('Encerrar o turno sem devolver nada?'))) return;
    const agora = new Date().toISOString();
    await D.enfileirar({
      tipo: 'rpc', alvo: 'registrar_devolucao',
      dados: { p_op: '', p_turno_id: turno.id, p_itens: itens, p_quando: agora },
      efeitos: [
        { tipo: 'update', alvo: 'turnos', dados: { encerrado_em: agora }, filtro: { id: turno.id } },
        ...itens.flatMap((i) => [efCarga(eu, i.produto_id, -i.cheios, -i.vazios), efDeposito(i.produto_id, i.cheios, i.vazios)]),
      ],
      descricao: 'Devolução: ' + (itens.map((i) => `${i.cheios} cheios e ${i.vazios} vazios de ${produto(i.produto_id).nome}`).join(', ') || 'nada'),
    });
    toast('Devolução registrada.'); f.fechar();
  } }, 'Confirmar devolução')] });
}

// =====================================================================
// CONFERIR TURNOS (estoquista e admin)
// =====================================================================
export function telaConferir(el, ctx) {
  const lista = h('div');
  el.append(...(ctx.perfil.papel === 'estoquista' ? [h('h1', {}, 'Conferir turnos')] : []),
    h('p', { class: 'suave' }, 'Turnos abertos e dos últimos 2 dias. Diferença diferente de zero aparece em vermelho.'), lista);
  const carregar = async () => {
    const limite = Date.now() - 2 * 864e5;
    const turnos = D.tabela('turnos').filter((t) => t.status !== 'confirmado' || new Date(t.iniciado_em) > limite)
      .sort((a, b) => String(b.iniciado_em).localeCompare(String(a.iniciado_em)));
    if (!turnos.length) return limpar(lista, vazio('Nenhum turno recente.'));
    const ids = turnos.map((t) => t.id);
    const [conf, confs] = await Promise.all([
      D.direto(D.sb.from('v_conferencia_turno').select('*').in('turno_id', ids)),
      D.direto(D.sb.from('conferencias').select('*').in('turno_id', ids).order('conferido_em')),
    ]);
    if (conf.erro) return limpar(lista, vazio(conf.rede ? 'A conferência precisa de internet.' : conf.erro));
    limpar(lista, turnos.map((t) => cartaoTurno(t, conf.data.filter((c) => c.turno_id === t.id), (confs.data || []).filter((c) => c.turno_id === t.id), carregar)));
  };
  carregar();
  ctx.ao('dados', (n) => { if (n === 'turnos' || n === 'carga') carregar(); });
}

function cartaoTurno(t, linhas, confs, recarregar) {
  const encerrado = !!t.encerrado_em;
  const temDif = encerrado && linhas.some((l) => l.diferenca_cheios || l.diferenca_vazios);
  const celulaDif = (n) => h('td', { class: encerrado && n ? 'dif' : '' }, encerrado ? (n > 0 ? '+' : '') + n : '—');
  const status = !encerrado ? etiqueta('Na rua', 'azul') : temDif ? etiqueta('Diferença', 'vermelho') : etiqueta('Bateu', 'verde');
  return h('div', { class: 'cartao turno' + (temDif ? ' com-dif' : '') },
    h('div', { class: 'turno-topo' }, h('strong', {}, nomePerfil(t.entregador_id)), status),
    h('p', { class: 'suave pequeno' }, `${new Date(t.iniciado_em).toLocaleDateString('pt-BR')} · saiu ${hora(t.iniciado_em)}` + (encerrado ? ` · voltou ${hora(t.encerrado_em)}` : '')),
    linhas.length ? h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Cheios'), h('th', {}, 'Saiu'), h('th', {}, 'Entregou'), h('th', {}, 'Voltou'), h('th', {}, 'Falta'))),
      h('tbody', {}, linhas.map((l) => h('tr', {},
        h('td', {}, l.produto), h('td', {}, num(l.retirado)), h('td', {}, num(l.entregue)), h('td', {}, num(l.devolvido_cheios)),
        celulaDif(l.diferenca_cheios)))))) : h('p', {}, 'Sem movimentação.'),
    linhas.filter((l) => l.vazios_recebidos || l.vazios_devolvidos || l.diferenca_vazios).map((l) =>
      h('p', { class: 'vazios-turno' + (encerrado && l.diferenca_vazios ? ' dif' : '') },
        `Vazios ${l.produto}: recolheu ${num(l.vazios_recebidos)}, devolveu ${num(l.vazios_devolvidos)}` + (encerrado && l.diferenca_vazios ? ` (falta ${l.diferenca_vazios})` : ''))),
    encerrado && temDif ? h('p', { class: 'suave pequeno' }, 'Falta positiva = não voltou para o depósito; negativa = voltou a mais.') : null,
    confs.map((c) => h('p', { class: 'conferido ' + (c.ok ? 'ok' : 'nao') },
      `${c.etapa === 'retirada' ? 'Retirada' : 'Devolução'} conferida por ${nomePerfil(c.conferido_por)} às ${hora(c.conferido_em)}: ${c.ok ? 'bateu' : 'diferença'}` + (c.observacao ? ` — ${c.observacao}` : ''))),
    h('button', { class: 'btn secundario', onclick: () => formConferencia(t, encerrado ? 'devolucao' : 'retirada', recarregar) },
      icone('check'), encerrado ? 'Conferir devolução' : 'Conferir retirada'));
}

function formConferencia(t, etapa, recarregar) {
  const obs = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Ex.: voltou 1 galão a menos, estava trincado' });
  const enviar = async (ok) => {
    if (!ok && !obs.value.trim()) return toast('Descreva a diferença.', 'erro');
    const r = await D.direto(D.sb.rpc('conferir_turno', { p_turno_id: t.id, p_etapa: etapa, p_ok: ok, p_obs: obs.value.trim() }));
    if (r.erro) return toast(r.rede ? 'Precisa de internet.' : r.erro, 'erro');
    toast('Conferência registrada.'); f.fechar(); recarregar();
  };
  const f = folha(`Conferir ${etapa === 'retirada' ? 'retirada' : 'devolução'} — ${nomePerfil(t.entregador_id)}`, [
    h('p', {}, 'Contou os galões no depósito? Confirme se bateu com o que o entregador registrou.'),
    campo('Observação', obs),
  ], { rodape: [
    h('button', { class: 'btn perigo', onclick: () => enviar(false) }, 'Teve diferença'),
    h('button', { class: 'btn verde', onclick: () => enviar(true) }, 'Bateu'),
  ] });
}
