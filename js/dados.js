// Camada de dados: Supabase, cache local (IndexedDB), fila offline e tempo real.
//
// Regra de ouro: toda gravação vai para a FILA com um id gerado no celular.
// A fila é enviada em ordem quando há internet. Se a mesma operação chegar
// duas vezes ao banco, ele reconhece o id e ignora a cópia.

import { uuid } from './ui.js';

const cfg = window.TAKA_CONFIG || {};
export const configurado = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/SEU-PROJETO|COLE_AQUI/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY));
export const sb = configurado && window.supabase
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// ---------------------------------------------------------------------
// Eventos simples: D.ao('dados', fn) / D.ao('fila', fn) / D.ao('conexao', fn)
// ---------------------------------------------------------------------
const alvo = new EventTarget();
export function ao(evento, fn) {
  const f = (e) => fn(e.detail);
  alvo.addEventListener(evento, f);
  return () => alvo.removeEventListener(evento, f);
}
function emitir(evento, detalhe) { alvo.dispatchEvent(new CustomEvent(evento, { detail: detalhe })); }

// ---------------------------------------------------------------------
// IndexedDB (chave/valor)
// ---------------------------------------------------------------------
let dbp;
function idb() {
  if (!dbp) dbp = new Promise((ok, erro) => {
    const r = indexedDB.open('taka', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
  return dbp;
}
async function idbOp(modo, fn) {
  const db = await idb();
  return new Promise((ok, erro) => {
    const tx = db.transaction('kv', modo);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => ok(req && req.result);
    tx.onerror = () => erro(tx.error);
  });
}
const lerLocal = (k) => idbOp('readonly', (s) => s.get(k)).catch(() => undefined);
const gravarLocal = (k, v) => idbOp('readwrite', (s) => s.put(v, k)).catch((e) => console.warn('cache', e));

// ---------------------------------------------------------------------
// Estado em memória
// ---------------------------------------------------------------------
export const estado = {
  perfil: null,
  tabelas: {},          // nome -> linhas
  fila: [],
  online: navigator.onLine,
  ultimaSinc: null,
};
const chave = (k) => `${estado.perfil ? estado.perfil.id : 'anon'}:${k}`;
export const tabela = (nome) => estado.tabelas[nome] || [];
export const config = () => tabela('configuracoes')[0] || { nome_negocio: 'Taka Entregas', chave_pix: '' };

// Consultas de cada tabela guardada no celular
const CONSULTAS = {
  configuracoes: () => sb.from('configuracoes').select('*'),
  perfis: () => sb.from('perfis').select('*').order('nome'),
  produtos: () => sb.from('produtos').select('*').order('ordem').order('nome'),
  clientes: () => sb.from('clientes').select('*').order('nome'),
  precos_cliente: () => sb.from('precos_cliente').select('*'),
  saldo_deposito: () => sb.from('v_saldo_deposito').select('*').order('ordem').order('nome'),
  carga: () => sb.from('v_carga_entregador').select('*'),          // o entregador só recebe a dele (RLS)
  turnos: () => sb.from('turnos').select('*')
    .gte('iniciado_em', diasAtras(30)).order('iniciado_em', { ascending: false }),
  resumos: () => sb.from('v_resumo_turno').select('*').gte('iniciado_em', diasAtras(30)),
  entregas_recentes: () => sb.from('entregas').select('*').gte('ocorrido_em', diasAtras(2)).order('ocorrido_em', { ascending: false }),
  vendas_hoje: () => sb.from('v_vendas').select('*').gte('ocorrido_em', inicioDoDia()),
  fiado: () => sb.from('v_fiado').select('*'),
  vasilhames: () => sb.from('v_vasilhames_cliente').select('*'),
  vasilhames_total: () => sb.from('v_vasilhames_total').select('*'),
  pedidos: () => sb.from('pedidos').select('*').gte('criado_em', diasAtras(30)).order('criado_em', { ascending: false }),
  recorrentes: () => sb.from('v_recorrentes').select('*'),
  // Só o admin recebe linhas destas duas (RLS). Antes de rodar supabase/melhorias-1.sql ficam vazias.
  custos: () => sb.from('custos_produto').select('*'),
  despesas: () => sb.from('despesas').select('*').gte('vencimento', diasAtras(400).slice(0, 10)).order('vencimento'),
};
function diasAtras(n) { return new Date(Date.now() - n * 864e5).toISOString(); }
export function inicioDoDia(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString(); }
// Qual tabela do servidor atualiza qual cache (tempo real)
const DEPENDENCIAS = {
  configuracoes: ['configuracoes'], perfis: ['perfis'], produtos: ['produtos', 'saldo_deposito'],
  clientes: ['clientes', 'fiado', 'recorrentes', 'vasilhames'], precos_cliente: ['precos_cliente'],
  movimentacoes: ['saldo_deposito', 'carga', 'vasilhames', 'vasilhames_total'],
  turnos: ['turnos', 'resumos'],
  entregas: ['entregas_recentes', 'vendas_hoje', 'fiado', 'resumos', 'recorrentes'],
  pagamentos: ['fiado', 'resumos'],
  pedidos: ['pedidos'],
  custos_produto: ['custos'],
  despesas: ['despesas'],
};
export function registrarConsulta(nome, fn, tabelasOrigem = []) {
  CONSULTAS[nome] = fn;
  for (const t of tabelasOrigem) (DEPENDENCIAS[t] ||= []).push(nome);
}

// Busca todas as linhas, de 1000 em 1000 (limite padrão do Supabase)
async function buscarTudo(fn) {
  const todas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await fn().range(de, de + 999);
    if (error) throw error;
    todas.push(...data);
    if (data.length < 1000) return todas;
  }
}

export async function baixar(nome) {
  try {
    const linhas = await buscarTudo(CONSULTAS[nome]);
    estado.tabelas[nome] = aplicarPendentes(nome, linhas);
    gravarLocal(chave('t:' + nome), linhas);
    marcarOnline(true);
  } catch (e) {
    if (ehErroDeRede(e)) marcarOnline(false);
    else console.warn('baixar', nome, e);
    if (!estado.tabelas[nome]) estado.tabelas[nome] = aplicarPendentes(nome, (await lerLocal(chave('t:' + nome))) || []);
  }
  emitir('dados', nome);
  return estado.tabelas[nome];
}
export const baixarVarias = (nomes) => Promise.all(nomes.map(baixar));

// Reaplica sobre os dados do servidor o que ainda está na fila (para a tela não "desfazer")
function aplicarPendentes(nome, linhas) {
  let res = linhas.slice();
  for (const op of estado.fila) {
    if (op.erro) continue;
    for (const ef of op.locais || []) if (ef.alvo === nome) res = ef.fn(res);
  }
  return res;
}

// ---------------------------------------------------------------------
// Fila offline
// ---------------------------------------------------------------------
// Efeitos locais: o que a operação muda na tela antes de o servidor responder.
// { tipo: 'insert'|'update'|'delete'|'somar', alvo, dados, filtro, chaves, linhaLocal }
const EFEITOS = {
  insert: (ef) => (linhas) => linhas.some((l) => mesmaLinha(l, ef.dados, ef.chaves)) ? linhas : [...linhas, { ...ef.dados, ...(ef.linhaLocal || {}) }],
  update: (ef) => (linhas) => linhas.map((l) => casa(l, ef.filtro) ? { ...l, ...ef.dados } : l),
  delete: (ef) => (linhas) => linhas.filter((l) => !casa(l, ef.filtro)),
  // soma números numa linha (ex.: carga do entregador); cria a linha se não existir
  somar: (ef) => (linhas) => {
    const filtro = Object.fromEntries(ef.chaves.map((k) => [k, ef.dados[k]]));
    let achou = false;
    const res = linhas.map((l) => {
      if (!casa(l, filtro)) return l;
      achou = true;
      const n = { ...l };
      for (const [k, v] of Object.entries(ef.dados)) if (!ef.chaves.includes(k)) n[k] = Number(n[k] || 0) + Number(v);
      return n;
    });
    return achou ? res : [...res, { ...(ef.linhaLocal || {}), ...ef.dados }];
  },
};
const casa = (linha, filtro) => Object.entries(filtro || {}).every(([k, v]) => String(linha[k]) === String(v));
const mesmaLinha = (a, b, chaves = ['id']) => chaves.every((k) => a[k] !== undefined && String(a[k]) === String(b[k]));

function prepararOp(op) {
  const efeitos = [...(op.efeitos || [])];
  if (op.tipo !== 'rpc' && op.alvo) efeitos.unshift({ tipo: op.tipo, alvo: op.alvo, dados: op.dados, filtro: op.filtro, chaves: op.chaves, linhaLocal: op.linhaLocal });
  op.locais = efeitos.filter((ef) => EFEITOS[ef.tipo]).map((ef) => ({ alvo: ef.alvo, fn: EFEITOS[ef.tipo](ef) }));
  return op;
}

async function salvarFila() {
  await gravarLocal(chave('fila'), estado.fila.map(({ locais, ...resto }) => resto));
  emitir('fila', estado.fila);
}

// op: { tipo: 'rpc'|'insert'|'update'|'delete', alvo, dados, filtro, chaves, descricao,
//       linhaLocal (campos extras só para mostrar na tela até o servidor responder),
//       efeitos (outras mudanças locais), recarregar (caches a baixar depois de enviar) }
// Em RPC, se dados.p_op existir vazio, recebe o id da operação (é a chave anti-duplicação).
export async function enfileirar(op) {
  op.id = op.id || uuid();
  op.quando = new Date().toISOString();
  if (op.tipo === 'rpc' && op.dados && 'p_op' in op.dados && !op.dados.p_op) op.dados.p_op = op.id;
  prepararOp(op);
  estado.fila.push(op);
  const mudadas = new Set();
  for (const ef of op.locais) {
    if (!estado.tabelas[ef.alvo]) estado.tabelas[ef.alvo] = [];
    estado.tabelas[ef.alvo] = ef.fn(estado.tabelas[ef.alvo]);
    mudadas.add(ef.alvo);
  }
  mudadas.forEach((n) => emitir('dados', n));
  await salvarFila();
  sincronizar();
  return op.id;
}

export function ehErroDeRede(e) {
  if (!e) return false;
  if (e.status === 0 || e.status === 401) return true;
  const m = String(e.message || e);
  return !e.code && /fetch|network|load failed|conex|timeout|abort/i.test(m);
}

const MENSAGENS = {
  '42501': 'Sem permissão para isso.',
  '23505': 'Esse registro já existe.',
  '23503': 'Registro relacionado não encontrado.',
  '23514': 'Algum valor está fora do permitido.',
  'PGRST116': 'Registro não encontrado.',
};
export function traduzirErro(e) {
  if (!e) return '';
  if (ehErroDeRede(e)) return 'Sem conexão com o servidor.';
  if (e.code === 'P0001' || (e.code && e.code.startsWith('P'))) return e.message;
  if (e.message === 'Invalid login credentials') return 'E-mail ou senha incorretos.';
  return MENSAGENS[e.code] || e.message || String(e);
}

async function executar(op) {
  let r;
  try {
    if (op.tipo === 'rpc') r = await sb.rpc(op.alvo, op.dados);
    else if (op.tipo === 'insert') r = await sb.from(op.alvo).insert(op.dados);
    else if (op.tipo === 'update' || op.tipo === 'delete') {
      let q = op.tipo === 'update' ? sb.from(op.alvo).update(op.dados) : sb.from(op.alvo).delete();
      for (const [k, v] of Object.entries(op.filtro || {})) q = q.eq(k, v);
      r = await q;
    }
  } catch (e) { return { rede: true }; }
  if (!r.error) return { ok: true, data: r.data };
  if (ehErroDeRede({ ...r.error, status: r.status })) return { rede: true };
  if (r.error.code === '23505' && op.tipo === 'insert') return { ok: true }; // já tinha chegado
  return { erro: traduzirErro(r.error) };
}

let sincronizando = null;
export function sincronizar() {
  if (!sb || !estado.perfil) return Promise.resolve();
  if (!sincronizando) sincronizando = rodarFila().finally(() => { sincronizando = null; });
  return sincronizando;
}
async function rodarFila() {
  const tocadas = new Set();
  for (const op of [...estado.fila]) {
    if (op.erro) continue;
    const r = await executar(op);
    if (r.rede) { marcarOnline(false); break; }
    marcarOnline(true);
    if (r.ok) {
      estado.fila = estado.fila.filter((x) => x.id !== op.id);
      (op.locais || []).forEach((ef) => tocadas.add(ef.alvo));
      if (op.alvo) tocadas.add(op.alvo);
      (op.recarregar || []).forEach((t) => tocadas.add(t));
    } else {
      op.erro = r.erro;
      (op.locais || []).forEach((ef) => tocadas.add(ef.alvo));
    }
    await salvarFila();
  }
  if (tocadas.size) {
    estado.ultimaSinc = new Date();
    const nomes = new Set();
    for (const t of tocadas) [t, ...(DEPENDENCIAS[t] || [])].forEach((n) => CONSULTAS[n] && nomes.add(n));
    await baixarVarias([...nomes]);
  }
}
export async function tentarDeNovo(id) {
  const op = estado.fila.find((x) => x.id === id);
  if (op) { delete op.erro; await salvarFila(); await sincronizar(); }
}
export async function descartar(id) {
  estado.fila = estado.fila.filter((x) => x.id !== id);
  await salvarFila();
  await baixarVarias(Object.keys(estado.tabelas).filter((n) => CONSULTAS[n]));
}

function marcarOnline(v) {
  if (estado.online !== v) { estado.online = v; emitir('conexao', v); }
}

// Gravação direta (só online), para telas do admin
export async function direto(promessa) {
  try {
    const r = await promessa;
    if (r.error) return { erro: traduzirErro(r.error), rede: ehErroDeRede(r.error) };
    marcarOnline(true);
    return { data: r.data };
  } catch (e) { return { erro: 'Sem conexão com o servidor.', rede: true }; }
}

// ---------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------
export async function carregarPerfil(user) {
  const k = `${user.id}:perfil`;
  try {
    const { data, error } = await sb.from('perfis').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (data) gravarLocal(k, data);
    return data;
  } catch (e) {
    return (await lerLocal(k)) || null;
  }
}

let canal, temporizador;
export async function iniciarSessao(perfil) {
  estado.perfil = perfil;
  estado.fila = ((await lerLocal(chave('fila'))) || []).map(prepararOp);
  // mostra o que estiver no cache na hora, depois atualiza
  for (const nome of Object.keys(CONSULTAS)) {
    const linhas = await lerLocal(chave('t:' + nome));
    if (linhas) estado.tabelas[nome] = aplicarPendentes(nome, linhas);
  }
  emitir('fila', estado.fila);
  baixarVarias(Object.keys(CONSULTAS)).then(() => sincronizar());

  window.addEventListener('online', () => { marcarOnline(true); sincronizar(); });
  window.addEventListener('offline', () => marcarOnline(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
  clearInterval(temporizador);
  temporizador = setInterval(() => { if (estado.fila.some((o) => !o.erro)) sincronizar(); }, 30000);
  ouvirTempoReal();
}

const pendentesTR = new Set();
let trTimer;
function ouvirTempoReal() {
  if (canal) sb.removeChannel(canal);
  canal = sb.channel('taka-mudancas')
    .on('postgres_changes', { event: '*', schema: 'public' }, (p) => {
      (DEPENDENCIAS[p.table] || []).forEach((n) => pendentesTR.add(n));
      clearTimeout(trTimer);
      trTimer = setTimeout(() => { const n = [...pendentesTR]; pendentesTR.clear(); baixarVarias(n); }, 400);
    })
    .subscribe();
}

export async function sair() {
  if (canal) sb.removeChannel(canal);
  clearInterval(temporizador);
  await sb.auth.signOut().catch(() => {});
  estado.perfil = null; estado.tabelas = {}; estado.fila = [];
}
