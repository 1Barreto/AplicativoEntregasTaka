// Custo e lucro por galão, meta diária e contas a pagar (admin).
import * as D from './dados.js';
import {
  h, limpar, icone, toast, folha, confirmar, campo, entrada, selecao, chave,
  brl, num, pct, lerValor, valorParaCampo, vazio, etiqueta, data,
} from './ui.js';
import { produtosAtivos } from './estoque.js';

const n = (v) => Number(v || 0);
const hojeIso = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const mesIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const nomeMes = (ym) => new Date(ym + '-15T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const somaMeses = (ym, k) => { const d = new Date(ym + '-15T12:00'); d.setMonth(d.getMonth() + k); return mesIso(d); };

export const CATEGORIAS = {
  fornecedor: 'Compra de água', combustivel: 'Combustível', salarios: 'Salários e comissões', aluguel: 'Aluguel',
  energia: 'Luz, água e internet', manutencao: 'Manutenção', vasilhames: 'Vasilhames', impostos: 'Impostos e taxas', outros: 'Outros',
};

// ---------------------------------------------------------------------
// Custos
// ---------------------------------------------------------------------
export const custoDe = (pid) => { const c = D.tabela('custos').find((x) => x.produto_id === pid); return c ? n(c.custo_unitario) : null; };
export const temCustos = () => D.tabela('custos').length > 0;

// Lucro bruto de linhas de v_vendas (estornos já vêm com quantidade negativa)
export function lucroDe(vendas) {
  let lucro = 0, semCusto = 0;
  for (const v of vendas) {
    const c = custoDe(v.produto_id);
    if (c === null) { semCusto += n(v.quantidade); continue; }
    lucro += n(v.valor) - n(v.quantidade) * c;
  }
  return { lucro: Math.round(lucro * 100) / 100, semCusto };
}

// Produto principal para a meta: o primeiro ativo (ordem) que tem custo
function principal() {
  return produtosAtivos().find((p) => custoDe(p.id) !== null && n(p.preco_padrao) > custoDe(p.id)) || null;
}
// Contas do mês (pelo vencimento), pagas ou não
export function despesasDoMes(ym = mesIso(new Date())) {
  return D.tabela('despesas').filter((d) => String(d.vencimento).startsWith(ym)).reduce((s, d) => s + n(d.valor), 0);
}
// Quantas unidades por dia pagam as contas do mês
export function metaDiaria() {
  const p = principal();
  const contas = despesasDoMes();
  if (!p || !contas) return null;
  const lucroUn = n(p.preco_padrao) - custoDe(p.id);
  const dias = Math.max(1, n(D.config().dias_trabalho_mes) || 26);
  const mes = Math.ceil(contas / lucroUn);
  return { produto: p, lucroUn, contas, mes, dia: Math.ceil(mes / dias), dias };
}

export function contasVencendo() {
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
  const lim = new Date(amanha.getTime() - amanha.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return D.tabela('despesas').filter((d) => !d.pago_em && d.vencimento <= lim);
}

// =====================================================================
// CUSTOS E LUCRO
// =====================================================================
export function telaCustos(el, ctx) {
  const corpo = h('div');
  el.append(h('p', { class: 'suave' }, 'O custo real de cada unidade vai além do preço da nota: frete, quebras e o desgaste do vasilhame também contam.'), corpo);
  const desenhar = () => {
    const ps = produtosAtivos();
    const meta = metaDiaria();
    limpar(corpo,
      ps.length ? ps.map((p) => {
        const c = custoDe(p.id);
        const lucro = c === null ? null : n(p.preco_padrao) - c;
        return h('div', { class: 'cartao produto-lucro' },
          h('div', { class: 'linha-topo' }, h('h2', {}, p.nome), c === null ? etiqueta('Sem custo', 'amarelo') : etiqueta(pct(lucro / n(p.preco_padrao)) + ' de margem', lucro > 0 ? 'verde' : 'vermelho')),
          h('div', { class: 'trio' },
            h('div', {}, h('span', {}, 'Vende por'), h('strong', {}, brl(p.preco_padrao))),
            h('div', {}, h('span', {}, 'Custa'), h('strong', {}, c === null ? '—' : brl(c))),
            h('div', {}, h('span', {}, 'Lucro por un.'), h('strong', { class: lucro > 0 ? 'positivo' : lucro < 0 ? 'negativo' : '' }, lucro === null ? '—' : brl(lucro)))),
          h('div', { class: 'botoes-lado' },
            h('button', { class: 'btn primario', onclick: () => calculadora(p) }, icone('calculadora'), 'Calcular custo'),
            h('button', { class: 'btn secundario', onclick: () => custoDireto(p) }, icone('editar'), 'Digitar')));
      }) : vazio('Cadastre os produtos primeiro.'),
      h('div', { class: 'cartao' },
        h('h2', {}, icone('alvo'), ' Ponto de equilíbrio'),
        meta ? [
          h('p', {}, `As contas de ${nomeMes(mesIso(new Date()))} somam `, h('strong', {}, brl(meta.contas)), '.'),
          h('p', {}, `Com lucro de ${brl(meta.lucroUn)} por ${meta.produto.nome}, você precisa vender `, h('strong', {}, `${num(meta.mes)} unidades no mês`),
            ` para pagar tudo. Isso dá `, h('strong', {}, `${num(meta.dia)} por dia`), ` em ${meta.dias} dias de trabalho.`),
          h('p', { class: 'suave pequeno' }, 'Tudo que passar disso é lucro. A meta aparece no Painel.'),
        ] : h('p', { class: 'suave' }, 'Informe o custo de um produto e lance as contas do mês em Financeiro para ver quantas unidades por dia pagam as despesas.'),
        h('a', { class: 'btn secundario', href: '#/financeiro' }, icone('carteira'), 'Ir para o Financeiro')));
  };
  desenhar();
  ctx.ao('dados', (x) => { if (['custos', 'produtos', 'despesas', 'configuracoes'].includes(x)) desenhar(); });
}

async function salvarCusto(p, valor, detalhe) {
  const r = await D.direto(D.sb.from('custos_produto').upsert({ produto_id: p.id, custo_unitario: valor, detalhe: detalhe || null }));
  if (r.erro) { toast(r.rede ? 'Precisa de internet.' : avisoMigracao(r.erro), 'erro'); return false; }
  toast(`Custo de ${p.nome}: ${brl(valor)}`); D.baixar('custos');
  return true;
}
// Tabela nova ainda não criada no Supabase
export const avisoMigracao = (erro) => /custos_produto|despesas|schema cache|does not exist|não existe/i.test(erro)
  ? 'Falta rodar o arquivo supabase/melhorias-1.sql no Supabase (veja o GUIA).' : erro;

function custoDireto(p) {
  const v = entrada({ inputmode: 'decimal', value: valorParaCampo(custoDe(p.id)), placeholder: '0,00' });
  const f = folha('Custo de ' + p.nome, [campo('Custo por unidade (R$)', v, 'Quanto cada unidade custa para você, já com frete.')],
    { rodape: [h('button', { class: 'btn primario grande', onclick: async () => {
      const x = lerValor(v.value);
      if (x === null || Number.isNaN(x) || x < 0) return toast('Valor inválido.', 'erro');
      if (await salvarCusto(p, x)) f.fechar();
    } }, 'Salvar')] });
}

// Calculadora do custo real por unidade
function calculadora(p) {
  const salvo = D.tabela('custos').find((x) => x.produto_id === p.id)?.detalhe || {};
  const num0 = (k, padrao, props = {}) => entrada({ inputmode: 'decimal', value: salvo[k] ?? padrao, ...props });
  const f = {
    nota: num0('nota', '', { placeholder: 'Ex.: 4,00' }),
    pagas: num0('pagas', '', { placeholder: 'Ex.: 500' }),
    bonus: num0('bonus', '0'),
    frete: num0('frete', '0'),
    perdidas: num0('perdidas', '0'),
    vasPreco: num0('vasPreco', p.retornavel ? '' : '0', { placeholder: 'Ex.: 32,00' }),
    vasAnos: num0('vasAnos', '3'),
    vasGiro: num0('vasGiro', '2'),
    vasPerda: num0('vasPerda', '1'),
    venda: num0('venda', valorParaCampo(p.preco_padrao)),
  };
  const res = h('div', { class: 'calc-resultado' });
  let ultimo = null;
  const ler = (k) => { const v = lerValor(f[k].value); return Number.isFinite(v) ? v : 0; };
  const calcular = () => {
    const pagas = ler('pagas'), bonus = ler('bonus'), perdidas = ler('perdidas');
    const recebidas = pagas + bonus, boas = recebidas - perdidas;
    if (!ler('nota') || !pagas || boas <= 0) { ultimo = null; return limpar(res, h('p', { class: 'suave' }, 'Preencha o preço da nota e as unidades compradas.')); }
    const mercadoria = (ler('nota') * pagas) / recebidas;          // bonificação dilui o preço
    const frete = ler('frete') / boas;
    const vasPreco = p.retornavel ? ler('vasPreco') : 0;
    const desgaste = vasPreco && ler('vasAnos') && ler('vasGiro') ? vasPreco / (ler('vasAnos') * 12 * ler('vasGiro')) : 0;
    const naoVolta = vasPreco * (ler('vasPerda') / 100);
    const vasilhame = desgaste + naoVolta;
    const quebra = perdidas ? (perdidas * (mercadoria + frete + vasPreco)) / boas : 0; // unidade quebrada se perde inteira
    const custo = Math.round((mercadoria + frete + quebra + vasilhame) * 100) / 100;
    const venda = ler('venda');
    ultimo = custo;
    const linha = (t, v) => h('tr', {}, h('td', {}, t), h('td', {}, brl(v)));
    limpar(res,
      h('table', { class: 'tabela valores' }, h('tbody', {},
        linha('Água (preço da nota' + (bonus ? ', com a bonificação' : '') + ')', mercadoria),
        linha('Frete por unidade', frete),
        perdidas ? linha('Quebras e perdas', quebra) : null,
        p.retornavel ? linha('Vasilhame (desgaste + os que não voltam)', vasilhame) : null)),
      h('div', { class: 'calc-total' }, h('span', {}, 'Custo real por unidade'), h('strong', {}, brl(custo))),
      venda ? h('div', { class: 'calc-total ' + (venda > custo ? 'positivo' : 'negativo') },
        h('span', {}, `Lucro vendendo a ${brl(venda)}`), h('strong', {}, `${brl(venda - custo)} (${pct((venda - custo) / venda)})`)) : null,
      ler('nota') ? h('p', { class: 'suave pequeno' }, `O custo real é ${pct(custo / ler('nota') - 1)} maior que o preço da nota.`) : null);
  };
  Object.values(f).forEach((x) => x.addEventListener('input', calcular));
  const painel = folha('Custo de ' + p.nome, [
    h('h3', {}, 'Compra da carga'),
    h('div', { class: 'grade-campos' },
      campo('Preço por unidade na nota (R$)', f.nota), campo('Unidades pagas', f.pagas),
      campo('Unidades de bonificação', f.bonus), campo('Frete da carga inteira (R$)', f.frete),
      campo('Unidades quebradas ou perdidas', f.perdidas)),
    p.retornavel ? [h('h3', {}, 'Vasilhame'),
      h('div', { class: 'grade-campos' },
        campo('Preço do vasilhame novo (R$)', f.vasPreco), campo('Dura quantos anos', f.vasAnos),
        campo('Voltas por mês', f.vasGiro, 'Quantas vezes cada vasilhame sai cheio no mês.'), campo('% que não voltam', f.vasPerda))] : null,
    h('h3', {}, 'Venda'), campo('Preço de venda (R$)', f.venda),
    res,
    h('p', { class: 'suave pequeno' }, 'Gasolina, comissão e maquininha não entram aqui: lance como contas no Financeiro.'),
  ], { rodape: [h('button', { class: 'btn verde grande', onclick: async () => {
    if (ultimo === null) return toast('Preencha os dados da compra.', 'erro');
    const detalhe = Object.fromEntries(Object.entries(f).map(([k, x]) => [k, x.value]));
    if (await salvarCusto(p, ultimo, detalhe)) painel.fechar();
  } }, 'Usar este custo')] });
  calcular();
}

// =====================================================================
// FINANCEIRO: resultado do mês e contas a pagar
// =====================================================================
export function telaFinanceiro(el, ctx) {
  let mes = mesIso(new Date());
  let vendasMes = null, carregando = false;
  const topo = h('div', { class: 'navegar-mes' });
  const resultado = h('div');
  const contas = h('div');
  el.append(h('h1', {}, 'Financeiro'), topo, resultado, contas);

  const carregar = async () => {
    carregando = true; vendasMes = null; desenhar();
    const ini = new Date(mes + '-01T00:00'), fim = new Date(ini); fim.setMonth(fim.getMonth() + 1);
    const linhas = [];
    for (let i = 0; ; i += 1000) {
      const r = await D.direto(D.sb.from('v_vendas').select('produto_id,quantidade,valor').gte('ocorrido_em', ini.toISOString()).lt('ocorrido_em', fim.toISOString()).range(i, i + 999));
      if (r.erro) { carregando = false; vendasMes = { erro: r.rede ? 'O resultado do mês precisa de internet.' : r.erro }; return desenhar(); }
      linhas.push(...r.data);
      if (r.data.length < 1000) break;
    }
    carregando = false; vendasMes = linhas; desenhar();
  };

  const desenhar = () => {
    limpar(topo,
      h('button', { class: 'btn-icone', 'aria-label': 'Mês anterior', onclick: () => { mes = somaMeses(mes, -1); carregar(); } }, '‹'),
      h('strong', {}, nomeMes(mes)),
      h('button', { class: 'btn-icone', 'aria-label': 'Próximo mês', onclick: () => { mes = somaMeses(mes, 1); carregar(); } }, '›'));

    const ds = D.tabela('despesas').filter((d) => String(d.vencimento).startsWith(mes));
    const totalContas = ds.reduce((s, d) => s + n(d.valor), 0);
    const pagas = ds.filter((d) => d.pago_em).reduce((s, d) => s + n(d.valor), 0);

    // Resultado
    if (carregando || !vendasMes) limpar(resultado, h('div', { class: 'cartao' }, h('p', { class: 'suave' }, 'Calculando o mês…')));
    else if (vendasMes.erro) limpar(resultado, h('div', { class: 'cartao' }, h('p', { class: 'suave' }, vendasMes.erro)));
    else {
      const vendido = vendasMes.reduce((s, v) => s + n(v.valor), 0);
      const unidades = vendasMes.reduce((s, v) => s + n(v.quantidade), 0);
      const { lucro: bruto, semCusto } = lucroDe(vendasMes);
      const custo = vendido - bruto - vendasMes.filter((v) => custoDe(v.produto_id) === null).reduce((s, v) => s + n(v.valor), 0);
      const liquido = bruto - totalContas;
      const linha = (t, v, cls = '') => h('tr', { class: cls }, h('td', {}, t), h('td', {}, v));
      limpar(resultado, h('div', { class: 'cartao resultado-mes' },
        h('h2', {}, 'Resultado do mês'),
        h('table', { class: 'tabela valores' }, h('tbody', {},
          linha(`Vendas (${num(unidades)} un.)`, brl(vendido)),
          temCustos() ? linha('(−) Custo dos produtos', brl(-custo)) : null,
          linha('(−) Contas do mês', brl(-totalContas)),
          temCustos() ? linha('= Lucro', brl(liquido), liquido >= 0 ? 'ok' : 'dif') : null)),
        !temCustos() ? h('a', { class: 'aviso info', href: '#/custos' }, icone('calculadora'), h('span', {}, 'Informe o custo dos produtos para ver o lucro de verdade.'))
          : semCusto ? h('p', { class: 'suave pequeno' }, `${num(semCusto)} unidade(s) de produtos sem custo ficaram fora da conta.`) : null));
    }

    // Contas
    const hoje = hojeIso();
    const vencidas = ds.filter((d) => !d.pago_em && d.vencimento < hoje);
    const aPagar = ds.filter((d) => !d.pago_em && d.vencimento >= hoje);
    const quitadas = ds.filter((d) => d.pago_em);
    const anterior = D.tabela('despesas').filter((d) => d.fixa && String(d.vencimento).startsWith(somaMeses(mes, -1)));
    const jaCopiadas = ds.some((d) => d.fixa);
    const porCat = {};
    for (const d of ds) porCat[d.categoria] = (porCat[d.categoria] || 0) + n(d.valor);
    const item = (d) => h('button', { class: 'item conta' + (d.pago_em ? ' paga' : d.vencimento < hoje ? ' vencida' : ''), onclick: () => acoesConta(d) },
      h('div', { class: 'item-texto' },
        h('strong', {}, d.descricao),
        h('span', {}, `${CATEGORIAS[d.categoria] || d.categoria} · ${d.pago_em ? 'paga em ' + data(d.pago_em + 'T12:00') : 'vence ' + data(d.vencimento + 'T12:00')}`),
        d.fixa ? h('small', {}, 'Repete todo mês') : null),
      h('strong', { class: 'valor-conta' }, brl(d.valor)));
    limpar(contas,
      h('div', { class: 'grade-numeros tres' },
        h('div', { class: 'numero' }, h('span', {}, 'Contas do mês'), h('strong', {}, brl(totalContas)), h('small', {}, `${ds.length} lançamento(s)`)),
        h('div', { class: 'numero' }, h('span', {}, 'Já pagas'), h('strong', {}, brl(pagas)), h('small', {}, `${quitadas.length} conta(s)`)),
        h('div', { class: 'numero' + (vencidas.length ? ' alerta' : '') }, h('span', {}, 'Falta pagar'), h('strong', {}, brl(totalContas - pagas)), h('small', {}, vencidas.length ? `${vencidas.length} vencida(s)` : 'nenhuma vencida'))),
      h('button', { class: 'btn primario grande', onclick: () => formConta({ vencimento: mes === mesIso(new Date()) ? hoje : mes + '-10' }) }, icone('mais'), 'Nova conta'),
      anterior.length && !jaCopiadas ? h('button', { class: 'btn secundario grande', onclick: () => copiarFixas(anterior) }, icone('copiar'), `Trazer ${anterior.length} conta(s) fixa(s) do mês passado`) : null,
      vencidas.length ? [h('h2', { class: 'titulo-secao alerta' }, `Vencidas (${vencidas.length})`), h('div', { class: 'lista' }, vencidas.map(item))] : null,
      h('h2', { class: 'titulo-secao' }, `A pagar (${aPagar.length})`),
      aPagar.length ? h('div', { class: 'lista' }, aPagar.map(item)) : h('p', { class: 'suave' }, 'Nada a pagar neste mês.'),
      quitadas.length ? [h('h2', { class: 'titulo-secao' }, `Pagas (${quitadas.length})`), h('div', { class: 'lista' }, quitadas.map(item))] : null,
      Object.keys(porCat).length ? h('div', { class: 'cartao' }, h('h2', {}, 'Para onde vai o dinheiro'),
        Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => barraSimples(CATEGORIAS[k] || k, v, totalContas))) : null);
  };

  const copiarFixas = async (lista) => {
    const linhas = lista.map((d) => {
      const [, , dia] = d.vencimento.split('-');
      const ultimoDia = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
      return { descricao: d.descricao, categoria: d.categoria, valor: d.valor, fixa: true, observacao: d.observacao,
        vencimento: `${mes}-${String(Math.min(Number(dia), ultimoDia)).padStart(2, '0')}` };
    });
    const r = await D.direto(D.sb.from('despesas').insert(linhas));
    if (r.erro) return toast(r.rede ? 'Precisa de internet.' : avisoMigracao(r.erro), 'erro');
    toast(`${linhas.length} conta(s) trazida(s).`); D.baixar('despesas');
  };

  desenhar();
  carregar();
  ctx.ao('dados', (x) => { if (['despesas', 'custos', 'produtos'].includes(x)) desenhar(); });
}

function barraSimples(rotulo, valor, total) {
  return h('div', { class: 'barra' },
    h('div', { class: 'barra-topo' }, h('span', {}, rotulo), h('strong', {}, brl(valor))),
    h('div', { class: 'barra-trilho' }, h('div', { class: 'barra-cheia', style: { width: (total ? (valor / total) * 100 : 0) + '%' } })));
}

function acoesConta(d) {
  const f = folha(d.descricao, [
    h('p', { class: 'texto-grande' }, brl(d.valor)),
    h('p', {}, `${CATEGORIAS[d.categoria] || d.categoria} · vence ${data(d.vencimento + 'T12:00')}`),
    d.pago_em ? h('p', { class: 'aviso ok' }, icone('check'), h('span', {}, 'Paga em ' + data(d.pago_em + 'T12:00'))) : null,
    d.observacao ? h('p', { class: 'obs' }, d.observacao) : null,
    h('div', { class: 'botoes-col-cheio' },
      !d.pago_em ? h('button', { class: 'btn verde grande', onclick: async () => {
        if (await gravar(D.sb.from('despesas').update({ pago_em: hojeIso() }).eq('id', d.id), 'Conta paga.')) f.fechar();
      } }, icone('check'), 'Marcar como paga') :
        h('button', { class: 'btn secundario', onclick: async () => {
          if (await gravar(D.sb.from('despesas').update({ pago_em: null }).eq('id', d.id), 'Voltou para "a pagar".')) f.fechar();
        } }, 'Desfazer pagamento'),
      h('button', { class: 'btn secundario', onclick: () => { f.fechar(); formConta(d); } }, icone('editar'), 'Editar'),
      h('button', { class: 'btn-texto perigo', onclick: async () => {
        if (!(await confirmar(`Excluir a conta "${d.descricao}"?`, { sim: 'Excluir', perigo: true }))) return;
        if (await gravar(D.sb.from('despesas').delete().eq('id', d.id), 'Conta excluída.')) f.fechar();
      } }, 'Excluir conta')),
  ]);
}

async function gravar(promessa, ok) {
  const r = await D.direto(promessa);
  if (r.erro) { toast(r.rede ? 'Precisa de internet.' : avisoMigracao(r.erro), 'erro'); return false; }
  toast(ok); D.baixar('despesas');
  return true;
}

function formConta(d = {}) {
  const nova = !d.id;
  const desc = entrada({ value: d.descricao || '', placeholder: 'Ex.: Aluguel do depósito' });
  const valor = entrada({ inputmode: 'decimal', value: valorParaCampo(d.valor), placeholder: '0,00' });
  const cat = selecao(Object.entries(CATEGORIAS), d.categoria || 'outros');
  const venc = entrada({ type: 'date', value: d.vencimento || hojeIso() });
  const paga = chave('Já está paga', !!d.pago_em);
  const fixa = chave('Repete todo mês (conta fixa)', !!d.fixa);
  const obs = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Opcional' }, d.observacao || '');
  const f = folha(nova ? 'Nova conta' : 'Editar conta', [
    campo('Descrição *', desc), campo('Valor (R$) *', valor), campo('Categoria', cat), campo('Vencimento', venc),
    paga.el, fixa.el, campo('Observação', obs),
  ], { rodape: [h('button', { class: 'btn primario grande', onclick: async () => {
    const v = lerValor(valor.value);
    if (!desc.value.trim()) return toast('Informe a descrição.', 'erro');
    if (!v || Number.isNaN(v) || v <= 0) return toast('Valor inválido.', 'erro');
    if (!venc.value) return toast('Informe o vencimento.', 'erro');
    const dados = { descricao: desc.value.trim(), valor: v, categoria: cat.value, vencimento: venc.value, fixa: fixa.input.checked,
      observacao: obs.value.trim(), pago_em: paga.input.checked ? (d.pago_em || hojeIso()) : null };
    if (await gravar(nova ? D.sb.from('despesas').insert(dados) : D.sb.from('despesas').update(dados).eq('id', d.id), nova ? 'Conta lançada.' : 'Conta salva.')) f.fechar();
  } }, 'Salvar')] });
}
