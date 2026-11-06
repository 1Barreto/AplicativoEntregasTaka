// Loja online: página pública onde o próprio cliente faz o pedido.
// Não precisa de login: fala com o banco só por 3 funções públicas
// (loja_dados, loja_conhece, loja_pedido), que conferem tudo no servidor.
import { h, limpar, icone, campo, entrada, contador, brl, linkWhats, toast } from './ui.js';

const raiz = document.getElementById('loja');
const cfg = window.TAKA_CONFIG || {};
const sb = window.supabase && cfg.SUPABASE_URL
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const guardado = (() => { try { return JSON.parse(localStorage.getItem('taka-loja') || '{}'); } catch { return {}; } })();
const guardar = (x) => { try { localStorage.setItem('taka-loja', JSON.stringify({ ...guardado, ...x })); } catch { /* ok */ } };
const digitos = (t) => String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');

function moldura(loja, ...filhos) {
  document.title = loja && loja.nome ? `${loja.nome} · Peça sua água` : 'Peça sua água';
  limpar(raiz,
    h('header', { class: 'loja-topo' },
      h('div', { class: 'loja-marca' }, h('span', { class: 'marca-selo' }, icone('gota', 'marca-ico')),
        h('div', {}, h('strong', {}, loja?.nome || 'Água mineral'), h('span', {}, 'Peça pelo celular, pague na entrega'))),
      h('div', { class: 'ondas', 'aria-hidden': 'true' })),
    h('main', { class: 'loja-corpo' }, ...filhos),
    h('footer', { class: 'loja-rodape' }, 'Pedido feito com Taka Entregas'));
}

const botaoZap = (loja, texto = 'Falar no WhatsApp', msg = '', cls = 'verde') => loja?.whatsapp
  ? h('a', { class: 'btn grande ' + cls, href: linkWhats(loja.whatsapp, msg), target: '_blank', rel: 'noopener' }, icone('whats'), texto) : null;

async function iniciar() {
  if (!sb) return moldura(null, h('div', { class: 'cartao' }, h('p', {}, 'Loja indisponível no momento.')));
  const { data: loja, error } = await sb.rpc('loja_dados');
  if (error || !loja) {
    return moldura(null, h('div', { class: 'cartao' }, h('h2', {}, 'Não deu para abrir a loja'),
      h('p', {}, 'Verifique a internet e tente de novo.'),
      h('button', { class: 'btn primario grande', onclick: () => location.reload() }, 'Tentar de novo')));
  }
  if (!loja.aberta || !loja.produtos.length) {
    return moldura(loja, h('div', { class: 'cartao centro' }, h('h2', {}, 'Loja fechada no momento'),
      h('p', { class: 'suave' }, 'Os pedidos pelo site estão pausados. Fale com a gente direto:'), botaoZap(loja, 'Pedir pelo WhatsApp')));
  }
  formulario(loja);
}

function formulario(loja) {
  const qtds = {};
  const totalEl = h('strong', {}, brl(0));
  const atualizar = () => {
    const t = loja.produtos.reduce((s, p) => s + (qtds[p.id] || 0) * Number(p.preco), 0);
    totalEl.textContent = brl(t);
  };
  const produtos = loja.produtos.map((p, i) => {
    qtds[p.id] = i === 0 ? 1 : 0;
    const c = contador(qtds[p.id], { min: 0, max: 20, rotulo: 'Quantidade de ' + p.nome, aoMudar: (n) => { qtds[p.id] = n; atualizar(); } });
    return h('div', { class: 'loja-produto' },
      h('div', { class: 'loja-produto-info' }, icone('gota'), h('div', {}, h('strong', {}, p.nome), h('span', {}, brl(p.preco)))),
      c.el);
  });

  const tel = entrada({ type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '(00) 00000-0000', value: guardado.telefone || '' });
  const nome = entrada({ autocomplete: 'name', autocapitalize: 'words', placeholder: 'Seu nome', value: guardado.nome || '' });
  const end = entrada({ autocomplete: 'street-address', placeholder: 'Rua, número e complemento', value: guardado.endereco || '' });
  const bairro = entrada({ placeholder: 'Bairro', value: guardado.bairro || '' });
  const obs = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Ex.: troco para R$ 50, portão azul, entregar após as 14h' });
  const boasVindas = h('p', { class: 'aviso ok', hidden: true }, icone('check'), h('span', {}, 'Que bom te ver de novo! Já temos seu endereço.'));
  const outroEnd = h('button', { type: 'button', class: 'btn-texto', hidden: true, onclick: () => { blocoEnd.hidden = false; outroEnd.hidden = true; } }, 'Entregar em outro endereço');
  const blocoNome = campo('Nome *', nome);
  const blocoEnd = h('div', { class: 'form' }, campo('Endereço de entrega *', end), campo('Bairro', bairro));
  let conhecido = false, ultimoTel = '';

  const verificar = async () => {
    const d = digitos(tel.value);
    if (d === ultimoTel) return;
    ultimoTel = d;
    if (d.length < 10) { conhecido = false; return mostrar(); }
    const { data } = await sb.rpc('loja_conhece', { p_telefone: d });
    conhecido = !!data;
    mostrar();
  };
  const mostrar = () => {
    boasVindas.hidden = !conhecido;
    blocoNome.hidden = conhecido;
    outroEnd.hidden = !conhecido;
    blocoEnd.hidden = conhecido;
  };
  tel.addEventListener('blur', verificar);
  tel.addEventListener('input', () => { if (digitos(tel.value).length >= 10) verificar(); });

  const enviar = h('button', { class: 'btn verde grande confirmar-loja', type: 'submit' }, icone('check'), 'Fazer pedido');
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    const itens = loja.produtos.filter((p) => qtds[p.id] > 0).map((p) => ({ produto_id: p.id, quantidade: qtds[p.id] }));
    const d = digitos(tel.value);
    if (!itens.length) return toast('Escolha a quantidade.', 'erro');
    if (d.length < 10) return toast('Informe o telefone com DDD.', 'erro');
    if (!conhecido && nome.value.trim().length < 2) return toast('Informe seu nome.', 'erro');
    if (!conhecido && end.value.trim().length < 4) return toast('Informe o endereço de entrega.', 'erro');
    enviar.disabled = true; enviar.lastChild.textContent = 'Enviando…';
    const usarEnd = !conhecido || !blocoEnd.hidden;
    const { data, error } = await sb.rpc('loja_pedido', {
      p_telefone: d, p_nome: nome.value.trim(), p_endereco: usarEnd ? end.value.trim() : '', p_bairro: usarEnd ? bairro.value.trim() : '',
      p_itens: itens, p_obs: obs.value.trim(),
    });
    enviar.disabled = false; enviar.lastChild.textContent = 'Fazer pedido';
    if (error) return toast(error.message && !/fetch|network/i.test(error.message) ? error.message : 'Sem conexão. Tente de novo.', 'erro');
    guardar({ telefone: tel.value.trim(), nome: nome.value.trim() || guardado.nome, endereco: end.value.trim() || guardado.endereco, bairro: bairro.value.trim() || guardado.bairro });
    const resumo = itens.map((i) => `${i.quantidade} ${loja.produtos.find((p) => p.id === i.produto_id).nome}`).join(', ');
    sucesso(loja, resumo, data);
  } },
    h('section', { class: 'cartao' }, h('h2', {}, '1. O que você precisa?'), produtos,
      h('div', { class: 'total' }, h('span', { class: 'suave' }, 'Total estimado'), totalEl)),
    h('section', { class: 'cartao form' }, h('h2', {}, '2. Seus dados'),
      campo('Telefone / WhatsApp *', tel, 'Usamos para reconhecer você e avisar da entrega.'),
      boasVindas, blocoNome, blocoEnd, outroEnd, campo('Observação', obs)),
    h('section', { class: 'cartao' }, h('h2', {}, '3. Pagamento'),
      h('p', {}, 'Você paga na entrega: ', h('strong', {}, 'Pix, dinheiro ou cartão'), '.')),
    enviar,
    botaoZap(loja, 'Prefiro pedir pelo WhatsApp', '', 'secundario'));

  moldura(loja,
    loja.aviso ? h('div', { class: 'loja-aviso' }, icone('alerta'), h('span', {}, loja.aviso)) : null,
    form);
  atualizar();
  if (digitos(tel.value).length >= 10) verificar();
}

function sucesso(loja, resumo, r) {
  moldura(loja, h('div', { class: 'cartao centro loja-sucesso' },
    h('div', { class: 'sucesso-icone' }, icone('check')),
    h('h2', {}, 'Pedido recebido!'),
    h('p', {}, `${resumo}. Já estamos separando e vamos entregar o mais rápido possível.`),
    r && r.cliente_novo ? h('p', { class: 'suave' }, 'Seu cadastro foi feito. No próximo pedido é só informar o telefone.') : null,
    botaoZap(loja, 'Falar com a gente', `Olá! Acabei de fazer um pedido pelo site: ${resumo}.`),
    h('button', { class: 'btn secundario grande', onclick: () => formulario(loja) }, 'Fazer outro pedido')));
  window.scrollTo(0, 0);
}

iniciar();
