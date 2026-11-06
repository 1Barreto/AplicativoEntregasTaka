// Fechamento de caixa por entregador e painel do dia (admin).
import * as D from './dados.js';
import { entregasValidas,
  h, limpar, icone, toast, folha, campo, entrada, brl, lerValor, vazio, etiqueta, num, dataHora,
} from './ui.js';
import { lucroDe, temCustos, metaDiaria, contasVencendo } from './financeiro.js';
import { nomePerfil } from './cadastros.js';
import { produtosAtivos, saldo, ganchosCarga, turnoAberto } from './estoque.js';
import { FORMAS } from './entregas.js';

const STATUS = { aberto: ['Aberto', 'azul'], enviado: ['Aguardando confirmação', 'amarelo'], confirmado: ['Confirmado', 'verde'] };
const hora = (d) => d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
export const resumoDe = (turnoId) => D.tabela('resumos').find((r) => r.turno_id === turnoId) || { turno_id: turnoId };
const n = (v) => Number(v || 0);
const temDiferenca = (r) => r.divergencia_produto || (r.dinheiro_contado !== null && r.dinheiro_contado !== undefined && Math.abs(n(r.diferenca_dinheiro)) > 0.009);

function tabelaValores(r, comContado = true) {
  const linha = (rotulo, valor, cls = '') => h('tr', { class: cls }, h('td', {}, rotulo), h('td', {}, valor));
  const contado = r.dinheiro_contado !== null && r.dinheiro_contado !== undefined;
  return h('table', { class: 'tabela valores' }, h('tbody', {},
    linha('Total vendido', brl(r.total_vendido)),
    linha('Dinheiro (esperado)', brl(r.recebido_dinheiro)),
    linha('Pix', brl(r.recebido_pix)),
    linha('Cartão', brl(r.recebido_cartao)),
    linha('Ficou fiado', brl(r.vendido_fiado)),
    n(r.recebido_de_fiado_antigo) ? linha('Recebido de fiado antigo (já somado acima)', brl(r.recebido_de_fiado_antigo), 'suave') : null,
    comContado && contado ? linha('Dinheiro contado', brl(r.dinheiro_contado)) : null,
    comContado && contado ? linha('Diferença no dinheiro', brl(r.diferenca_dinheiro), Math.abs(n(r.diferenca_dinheiro)) > 0.009 ? 'dif' : 'ok') : null));
}

// =====================================================================
// Entregador: enviar o fechamento (aparece em Minha carga após a devolução)
// =====================================================================
ganchosCarga.fechamento = (turno, ctx) => {
  const r = resumoDe(turno.id);
  const contado = entrada({ inputmode: 'decimal', placeholder: '0,00', 'aria-label': 'Dinheiro em mãos' });
  const dif = h('p', { class: 'dif-ao-vivo' });
  const obs = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Observação (opcional)' });
  contado.addEventListener('input', () => {
    const v = lerValor(contado.value);
    if (v === null || Number.isNaN(v)) { dif.textContent = ''; dif.className = 'dif-ao-vivo'; return; }
    const d = Math.round((v - n(r.recebido_dinheiro)) * 100) / 100;
    dif.textContent = Math.abs(d) < 0.01 ? 'Bateu com o esperado.' : d > 0 ? `Sobrando ${brl(d)}` : `Faltando ${brl(-d)}`;
    dif.className = 'dif-ao-vivo ' + (Math.abs(d) < 0.01 ? 'ok' : 'erro');
  });
  return h('div', { class: 'cartao destaque' },
    h('h2', {}, 'Fechamento de caixa'),
    tabelaValores(r, false),
    campo('Quanto você tem em DINHEIRO?', contado), dif,
    campo('Observação', obs),
    h('button', { class: 'btn primario grande', onclick: async () => {
      const v = lerValor(contado.value);
      if (v === null || Number.isNaN(v) || v < 0) return toast('Informe o dinheiro em mãos (pode ser 0).', 'erro');
      const agora = new Date().toISOString();
      await D.enfileirar({ tipo: 'rpc', alvo: 'enviar_fechamento',
        dados: { p_turno_id: turno.id, p_dinheiro_contado: v, p_obs: obs.value.trim() || null },
        efeitos: [
          { tipo: 'update', alvo: 'turnos', dados: { status: 'enviado', dinheiro_contado: v, enviado_em: agora }, filtro: { id: turno.id } },
          { tipo: 'update', alvo: 'resumos', dados: { status: 'enviado', dinheiro_contado: v, enviado_em: agora, diferenca_dinheiro: Math.round((v - n(r.recebido_dinheiro)) * 100) / 100 }, filtro: { turno_id: turno.id } },
        ],
        descricao: `Fechamento enviado: ${brl(v)} em dinheiro` });
      toast('Fechamento enviado para o admin.');
    } }, 'Enviar fechamento'));
};

// Quando não há turno aberto, mostra como ficou o último
ganchosCarga.ultimoTurno = (ctx) => {
  const ultimo = D.tabela('turnos').filter((t) => t.entregador_id === ctx.perfil.id && t.status !== 'aberto')
    .sort((a, b) => String(b.iniciado_em).localeCompare(String(a.iniciado_em)))[0];
  if (!ultimo) return null;
  const [txt, cor] = STATUS[ultimo.status];
  return h('a', { class: 'item', href: '#/fechamentos' },
    h('div', { class: 'item-texto' }, h('strong', {}, 'Último fechamento'), h('span', {}, `${new Date(ultimo.iniciado_em).toLocaleDateString('pt-BR')} · ${brl(resumoDe(ultimo.id).total_vendido)} vendido`),
      h('div', {}, etiqueta(txt, cor))),
    icone('seta', 'seta'));
};

// =====================================================================
// FECHAMENTOS (entregador vê os seus; admin vê e confirma todos)
// =====================================================================
export function telaFechamentos(el, ctx) {
  const lista = h('div');
  el.append(lista);
  const desenhar = () => {
    const rs = D.tabela('resumos').slice().sort((a, b) => String(b.iniciado_em).localeCompare(String(a.iniciado_em)));
    const pendentes = rs.filter((r) => r.status === 'enviado');
    const outros = rs.filter((r) => r.status !== 'enviado');
    limpar(lista,
      ctx.eAdmin ? h('h2', { class: 'titulo-secao' + (pendentes.length ? ' alerta' : '') }, `Para confirmar (${pendentes.length})`) : null,
      ctx.eAdmin && !pendentes.length ? h('p', { class: 'suave' }, 'Nenhum fechamento esperando.') : null,
      (ctx.eAdmin ? pendentes : []).map((r) => cartao(r)),
      h('h2', { class: 'titulo-secao' }, ctx.eAdmin ? 'Últimos 30 dias' : 'Meus fechamentos'),
      (ctx.eAdmin ? outros : rs).map((r) => cartao(r)),
      !rs.length ? vazio('Nenhum turno nos últimos 30 dias.') : null);
  };
  const cartao = (r) => {
    const [txt, cor] = STATUS[r.status] || ['?', ''];
    return h('div', { class: 'cartao turno' + (temDiferenca(r) ? ' com-dif' : '') },
      h('div', { class: 'turno-topo' }, h('strong', {}, ctx.eAdmin ? r.entregador : new Date(r.iniciado_em).toLocaleDateString('pt-BR')), etiqueta(txt, cor)),
      h('p', { class: 'suave pequeno' }, `${new Date(r.iniciado_em).toLocaleDateString('pt-BR')} · ${hora(r.iniciado_em)}${r.encerrado_em ? ' às ' + hora(r.encerrado_em) : ''}`),
      tabelaValores(r),
      r.divergencia_produto ? h('a', { class: 'aviso alerta', href: '#/conferir' }, icone('alerta'), h('span', {}, 'Diferença de produto na devolução')) : null,
      r.obs_entregador ? h('p', { class: 'obs' }, 'Entregador: ' + r.obs_entregador) : null,
      r.obs_admin ? h('p', { class: 'obs' }, 'Admin: ' + r.obs_admin) : null,
      r.status === 'confirmado' ? h('p', { class: 'suave pequeno' }, `Confirmado por ${nomePerfil(r.confirmado_por)} em ${dataHora(r.confirmado_em)}`) : null,
      ctx.eAdmin && r.status === 'enviado' ? h('button', { class: 'btn verde grande', onclick: () => confirmar(r) }, icone('check'), 'Conferir e confirmar') : null);
  };
  const confirmar = (r) => {
    const obs = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Ex.: faltaram R$ 5, descontado do vale' });
    const f = folha('Confirmar fechamento — ' + r.entregador, [
      tabelaValores(r),
      temDiferenca(r) ? h('p', { class: 'aviso alerta' }, icone('alerta'), h('span', {}, 'Há diferença. Ela fica registrada junto com a confirmação.')) : h('p', { class: 'aviso ok' }, icone('check'), h('span', {}, 'Dinheiro e produtos bateram.')),
      campo('Observação', obs),
    ], { rodape: [h('button', { class: 'btn verde grande', onclick: async () => {
      const res = await D.direto(D.sb.rpc('confirmar_fechamento', { p_turno_id: r.turno_id, p_obs: obs.value.trim() || null }));
      if (res.erro) return toast(res.rede ? 'Precisa de internet para confirmar.' : res.erro, 'erro');
      toast('Fechamento confirmado.'); f.fechar(); D.baixarVarias(['turnos', 'resumos']);
    } }, 'Confirmar')] });
  };
  desenhar();
  ctx.ao('dados', (x) => { if (x === 'resumos' || x === 'perfis') desenhar(); });
}

export function avisoFechamentos() {
  const p = D.tabela('resumos').filter((r) => r.status === 'enviado').length;
  return p ? h('a', { class: 'aviso alerta', href: '#/fechamentos' }, icone('moeda'), h('span', {}, `${p} fechamento(s) de caixa para confirmar`)) :
    h('a', { class: 'item-menu', href: '#/fechamentos' }, icone('moeda'), h('span', {}, 'Fechamentos de caixa'), icone('seta', 'seta'));
}

// =====================================================================
// PAINEL DO ADMIN — visão do dia
// =====================================================================
export function telaPainel(el, ctx) {
  const desenhar = () => {
    const vendas = D.tabela('vendas_hoje');
    const entregasIds = entregasValidas(vendas);
    const total = vendas.reduce((s, v) => s + n(v.valor), 0);
    const porForma = Object.fromEntries(Object.keys(FORMAS).map((f) => [f, vendas.filter((v) => v.forma_pagamento === f).reduce((s, v) => s + n(v.valor), 0)]));
    const unidades = vendas.reduce((s, v) => s + n(v.quantidade), 0);
    const fiadoTotal = D.tabela('fiado').filter((f) => n(f.saldo) > 0.009).reduce((s, f) => s + n(f.saldo), 0);
    const naRua = D.tabela('vasilhames_total').reduce((s, v) => s + n(v.na_rua), 0);
    const pendentes = D.tabela('resumos').filter((r) => r.status === 'enviado');
    const limite = Date.now() - 2 * 864e5;
    const divergencias = D.tabela('resumos').filter((r) => new Date(r.iniciado_em) > limite && temDiferenca(r));
    const baixos = produtosAtivos().filter((p) => saldo(p.id).cheios <= p.estoque_minimo);
    const aguardando = D.tabela('perfis').filter((p) => !p.ativo && !p.atualizado_em);
    const pedidosAbertos = D.tabela('pedidos').filter((p) => p.status === 'pendente' && !p.entregador_id).length;
    const max = Math.max(1, ...Object.values(porForma));

    // carga e situação de cada entregador
    const entregadores = D.tabela('perfis').filter((p) => p.ativo && p.papel === 'entregador');
    const porEntregador = entregadores.map((p) => {
      const turno = D.tabela('turnos').find((t) => t.entregador_id === p.id && t.status === 'aberto');
      const carga = D.tabela('carga').filter((c) => c.entregador_id === p.id && (n(c.cheios) || n(c.vazios)));
      const vendeu = vendas.filter((v) => v.entregador_id === p.id).reduce((s, v) => s + n(v.valor), 0);
      return { p, turno, carga, vendeu };
    });

    const { lucro } = lucroDe(vendas);
    const meta = metaDiaria();
    const vencendo = contasVencendo();
    const resumo = { total, entregas: entregasIds.size, unidades, porForma, lucro: temCustos() ? lucro : null, meta, fiadoTotal };

    limpar(el,
      h('div', { class: 'destaque-dia' },
        h('div', { class: 'destaque-topo' },
          h('span', {}, 'Hoje, ' + new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })),
          h('a', { class: 'destaque-btn', href: linkResumo(resumo), target: '_blank', rel: 'noopener', 'aria-label': 'Mandar resumo do dia no WhatsApp' }, icone('compartilhar'), h('span', {}, 'Resumo'))),
        h('span', { class: 'destaque-rotulo' }, 'Vendido hoje'),
        h('strong', { class: 'destaque-valor' }, brl(total).replace(/\u00a0/g, ' ')),
        h('div', { class: 'destaque-linha' },
          h('span', {}, `${entregasIds.size} entrega(s)`), h('span', {}, `${num(unidades)} unidade(s)`),
          temCustos() ? h('span', {}, 'Lucro bruto ', h('b', {}, brl(lucro))) : h('a', { href: '#/custos' }, 'Ver lucro ›')),
        meta ? h('div', { class: 'meta' },
          h('div', { class: 'meta-topo' }, h('span', {}, icone('alvo'), ' Meta do dia'), h('b', {}, `${num(unidades)} de ${num(meta.dia)}`)),
          h('div', { class: 'meta-trilho' }, h('div', { class: 'meta-cheia' + (unidades >= meta.dia ? ' batida' : ''), style: { width: Math.min(100, (unidades / meta.dia) * 100) + '%' } })),
          h('small', {}, unidades >= meta.dia ? 'Meta batida! Daqui pra frente o dia já pagou as contas.' : `Faltam ${num(meta.dia - unidades)} para cobrir as contas do mês.`)) : null),
      pendentes.length ? h('a', { class: 'aviso alerta', href: '#/fechamentos' }, icone('moeda'), h('span', {}, `${pendentes.length} fechamento(s) para confirmar`)) : null,
      divergencias.length ? h('a', { class: 'aviso alerta', href: '#/fechamentos' }, icone('alerta'), h('span', {}, `${divergencias.length} turno(s) com diferença nos últimos 2 dias`)) : null,
      vencendo.length ? h('a', { class: 'aviso alerta', href: '#/financeiro' }, icone('carteira'), h('span', {}, `${vencendo.length} conta(s) vencendo ou vencida(s): ${brl(vencendo.reduce((s, d) => s + n(d.valor), 0))}`)) : null,
      baixos.length ? h('a', { class: 'aviso alerta', href: '#/estoque' }, icone('caixa'), h('span', {}, 'Estoque baixo: ' + baixos.map((p) => `${p.nome} (${saldo(p.id).cheios})`).join(', '))) : null,
      aguardando.length ? h('a', { class: 'aviso alerta', href: '#/equipe' }, icone('pessoas'), h('span', {}, `${aguardando.length} pessoa(s) aguardando liberação`)) : null,
      pedidosAbertos ? h('a', { class: 'aviso info', href: '#/pedidos' }, icone('lista'), h('span', {}, `${pedidosAbertos} pedido(s) sem entregador`)) : null,
      primeirosPassos(),
      h('div', { class: 'grade-numeros' },
        numero('Fiado a receber', brl(fiadoTotal), 'total em aberto', '#/fiado', 'moeda'),
        numero('Vasilhames na rua', num(naRua), 'com clientes', '#/vasilhames', 'gota'),
        numero('Pedidos abertos', num(D.tabela('pedidos').filter((p) => p.status === 'pendente' || p.status === 'em_rota').length), pedidosAbertos ? `${pedidosAbertos} sem entregador` : 'todos com entregador', '#/pedidos', 'lista'),
        numero('Contas do mês', brl(D.tabela('despesas').filter((d) => !d.pago_em).reduce((s, d) => s + n(d.valor), 0)), 'a pagar', '#/financeiro', 'carteira')),
      h('div', { class: 'colunas' },
      h('div', { class: 'cartao' }, h('h2', {}, 'Por forma de pagamento'),
        Object.entries(FORMAS).map(([k, t]) => barra(t, porForma[k], max, k === 'fiado' ? 'vermelho' : ''))),
      h('div', { class: 'cartao' }, h('h2', {}, 'Estoque no depósito'),
        h('div', { class: 'lista-compacta' }, produtosAtivos().map((p) => {
          const s = saldo(p.id);
          return h('div', { class: 'linha-compacta' + (s.cheios <= p.estoque_minimo ? ' alerta' : '') },
            h('span', {}, p.nome), h('strong', {}, `${num(s.cheios)} cheios`), p.retornavel ? h('span', { class: 'suave' }, `${num(s.vazios)} vazios`) : h('span'));
        }))),
      h('div', { class: 'cartao' }, h('h2', {}, 'Entregadores'),
        porEntregador.length ? porEntregador.map(({ p, turno, carga, vendeu }) => h('div', { class: 'entregador-linha' },
          h('div', { class: 'turno-topo' }, h('strong', {}, p.nome || p.email),
            turno ? (turno.encerrado_em ? etiqueta('Devolveu', 'amarelo') : etiqueta('Na rua', 'azul')) : etiqueta('Sem turno')),
          h('span', { class: 'suave' }, `Vendeu hoje ${brl(vendeu)}` + (carga.some((c) => c.cheios > 0) ? ' · carga: ' + carga.filter((c) => c.cheios > 0).map((c) => `${num(c.cheios)} ${c.produto}`).join(', ') : '')))) :
          h('p', { class: 'suave' }, 'Nenhum entregador ativo.'))));
  };
  desenhar();
  ctx.ao('dados', (x) => { if (['vendas_hoje', 'fiado', 'vasilhames_total', 'resumos', 'turnos', 'carga', 'saldo_deposito', 'perfis', 'pedidos', 'produtos', 'custos', 'despesas', 'configuracoes', 'clientes'].includes(x)) desenhar(); });
}
function numero(rotulo, valor, sub, href, ico) {
  return h('a', { class: 'numero', href }, h('span', {}, ico ? icone(ico) : null, rotulo), h('strong', {}, String(valor).replace(/\u00a0/g, ' ')), h('small', {}, sub));
}

// Texto do resumo do dia para mandar no WhatsApp (o dono escolhe para quem)
function linkResumo(r) {
  const cfg = D.config();
  const linhas = [
    `*Resumo de hoje · ${cfg.nome_negocio || 'Taka'}*`,
    new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }),
    '',
    `Vendido: ${brl(r.total)} (${r.entregas} entregas, ${num(r.unidades)} un.)`,
    ...Object.entries(FORMAS).filter(([k]) => r.porForma[k]).map(([k, t]) => `• ${t}: ${brl(r.porForma[k])}`),
    r.lucro !== null ? `Lucro bruto: ${brl(r.lucro)}` : null,
    r.meta ? `Meta do dia: ${num(r.unidades)} de ${num(r.meta.dia)}${r.unidades >= r.meta.dia ? ' ✅' : ''}` : null,
    `Fiado a receber (total): ${brl(r.fiadoTotal)}`,
  ].filter((x) => x !== null);
  return 'https://wa.me/?text=' + encodeURIComponent(linhas.join('\n').replace(/\u00a0/g, ' '));
}

// Lista de primeiros passos até o app estar todo configurado
function primeirosPassos() {
  try { if (localStorage.getItem('taka-passos-ok')) return null; } catch { /* sem armazenamento */ }
  const cfg = D.config();
  const passos = [
    ['Cadastrar os produtos e preços', D.tabela('produtos').length > 0, '#/produtos'],
    ['Informar o custo de cada produto', D.tabela('custos').length > 0, '#/custos'],
    ['Cadastrar os clientes', D.tabela('clientes').length > 0, '#/clientes'],
    ['Convidar a equipe', D.tabela('perfis').length > 1, '#/equipe'],
    ['Colocar a chave Pix e ligar a loja online', !!cfg.chave_pix && !!cfg.loja_ativa, '#/config'],
    ['Lançar as contas do mês', D.tabela('despesas').length > 0, '#/financeiro'],
  ];
  const feitos = passos.filter((p) => p[1]).length;
  if (feitos === passos.length) return null;
  const cartao = h('div', { class: 'cartao primeiros-passos' },
    h('div', { class: 'linha-topo' }, h('h2', {}, 'Primeiros passos'), h('span', { class: 'suave pequeno' }, `${feitos} de ${passos.length}`)),
    h('div', { class: 'meta-trilho claro' }, h('div', { class: 'meta-cheia', style: { width: (feitos / passos.length) * 100 + '%' } })),
    h('ol', { class: 'lista-passos' }, passos.map(([t, ok, href]) => h('li', { class: ok ? 'feito' : '' },
      h('a', { href }, h('span', { class: 'marcador' }, ok ? icone('check') : null), h('span', {}, t), ok ? null : icone('seta', 'seta'))))),
    h('button', { class: 'btn-texto', onclick: () => { try { localStorage.setItem('taka-passos-ok', '1'); } catch { /* ok */ } cartao.remove(); } }, 'Esconder'));
  return cartao;
}
export function barra(rotulo, valor, max, cor = '', formatar = brl) {
  return h('div', { class: 'barra' },
    h('div', { class: 'barra-topo' }, h('span', {}, rotulo), h('strong', {}, formatar(valor))),
    h('div', { class: 'barra-trilho' }, h('div', { class: 'barra-cheia ' + cor, style: { width: Math.max(valor > 0 ? 2 : 0, (valor / max) * 100) + '%' } })));
}
