// Utilitários de interface: criação de elementos, formatação, avisos, folhas e contadores.

// Cria um elemento: h('button', { class: 'btn', onclick: fn }, 'Texto', outroElemento)
export function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  adicionar(el, filhos);
  return el;
}
function adicionar(el, filhos) {
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}
export function limpar(el, ...filhos) { el.replaceChildren(); adicionar(el, filhos); return el; }

// ---------- Formatação ----------
export const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const num = (v) => Number(v || 0).toLocaleString('pt-BR');
export const dataHora = (d) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
export const data = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '';
// "12,50" ou "12.50" -> 12.5
export function lerValor(txt) {
  const s = String(txt ?? '').trim().replace(/\s|R\$/g, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
export const valorParaCampo = (v) => (v === null || v === undefined) ? '' : Number(v).toFixed(2).replace('.', ',');
// Busca sem acento e sem maiúsculas
export const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// ---------- WhatsApp ----------
export function telefoneInternacional(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length <= 11) d = '55' + d;
  return d;
}
export function linkWhats(tel, msg = '') {
  const t = telefoneInternacional(tel);
  return `https://wa.me/${t}${msg ? '?text=' + encodeURIComponent(msg) : ''}`;
}

// ---------- Ícones (SVG fixos) ----------
const ICONES = {
  caminhao: '<path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  caixa: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  moeda: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>',
  pessoas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.5 0 4.2 1.6 4.5 4.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  grafico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  doc: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  lista: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  menos: '<path d="M5 12h14"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  whats: '<path d="M4 20l1.3-4A8 8 0 1 1 8.5 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8c-1-.4-1.8-1.2-2.2-2.2l.8-1-1-2z"/>',
  telefone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  sair: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
  nuvem: '<path d="M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  alerta: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  seta: '<path d="M9 5l7 7-7 7"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  gota: '<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/>',
  fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
  celular: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
};
export function icone(nome, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ico ' + cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONES[nome] || '';
  return s;
}

// ---------- Avisos rápidos ----------
export function toast(msg, tipo = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + tipo }, msg);
  box.replaceChildren(t);
  setTimeout(() => t.classList.add('saindo'), tipo === 'erro' ? 4500 : 2500);
  setTimeout(() => t.remove(), tipo === 'erro' ? 5000 : 3000);
}

// ---------- Folha (painel que sobe de baixo) ----------
export function folha(titulo, conteudo, { rodape, aoFechar } = {}) {
  const fundo = h('div', { class: 'folha-fundo' });
  const painel = h('div', { class: 'folha', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo });
  let fechada = false;
  const fechar = () => {
    if (fechada) return; fechada = true;
    fundo.classList.add('saindo'); setTimeout(() => fundo.remove(), 180);
    if (!document.querySelectorAll('.folha-fundo:not(.saindo)').length) document.body.classList.remove('com-folha');
    aoFechar && aoFechar();
  };
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  painel.append(
    h('div', { class: 'folha-topo' },
      h('h2', {}, titulo),
      h('button', { class: 'btn-icone', 'aria-label': 'Fechar', onclick: fechar }, icone('fechar'))),
    h('div', { class: 'folha-corpo' }, conteudo),
    rodape ? h('div', { class: 'folha-rodape' }, rodape) : null,
  );
  fundo.append(painel);
  document.body.append(fundo);
  document.body.classList.add('com-folha');
  const primeiro = painel.querySelector('input:not([type=checkbox]), select, textarea');
  if (primeiro && !matchMedia('(pointer: coarse)').matches) primeiro.focus();
  return { fechar, painel };
}

export function confirmar(msg, { sim = 'Confirmar', perigo = false } = {}) {
  return new Promise((ok) => {
    let resp = false;
    const f = folha('Confirmar', h('p', { class: 'texto-grande' }, msg), {
      aoFechar: () => ok(resp),
      rodape: [
        h('button', { class: 'btn secundario', onclick: () => f.fechar() }, 'Voltar'),
        h('button', { class: 'btn ' + (perigo ? 'perigo' : 'primario'), onclick: () => { resp = true; f.fechar(); } }, sim),
      ],
    });
  });
}

// ---------- Campos de formulário ----------
export function campo(rotulo, entrada, ajuda) {
  return h('label', { class: 'campo' }, h('span', { class: 'rotulo' }, rotulo), entrada, ajuda ? h('small', {}, ajuda) : null);
}
export function entrada(props = {}) { return h('input', { class: 'entrada', ...props }); }
export function selecao(opcoes, valor, props = {}) {
  return h('select', { class: 'entrada', ...props },
    opcoes.map(([v, t]) => h('option', { value: v, selected: String(v) === String(valor) }, t)));
}
export function chave(rotulo, marcado, props = {}) {
  const inp = h('input', { type: 'checkbox', checked: !!marcado, ...props });
  return { el: h('label', { class: 'chave' }, inp, h('span', { class: 'trilho' }), h('span', {}, rotulo)), input: inp };
}

// Contador grande com − e +
export function contador(valor = 0, { min = 0, max = 999, aoMudar, rotulo } = {}) {
  let v = valor;
  const mostrador = h('output', { class: 'contador-valor' }, String(v));
  const atualizar = (n) => { v = Math.max(min, Math.min(max, n)); mostrador.textContent = String(v); aoMudar && aoMudar(v); };
  const el = h('div', { class: 'contador', role: 'group', 'aria-label': rotulo || 'Quantidade' },
    h('button', { class: 'contador-btn', type: 'button', 'aria-label': 'Diminuir', onclick: () => atualizar(v - 1) }, icone('menos')),
    mostrador,
    h('button', { class: 'contador-btn', type: 'button', 'aria-label': 'Aumentar', onclick: () => atualizar(v + 1) }, icone('mais')));
  return { el, get valor() { return v; }, definir: atualizar };
}

export function vazio(msg, acao) {
  return h('div', { class: 'vazio' }, h('p', {}, msg), acao || null);
}
export function emBreve(titulo, etapa, texto) {
  return h('div', { class: 'cartao em-breve' },
    h('h2', {}, titulo),
    h('p', {}, texto || 'Esta tela chega na etapa ' + etapa + '.'));
}
export function etiqueta(texto, tipo = '') { return h('span', { class: 'etiqueta ' + tipo }, texto); }
