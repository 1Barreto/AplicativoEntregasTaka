// Início do app: login, perfil, navegação por abas e telas.
import * as D from './dados.js';
import { h, limpar, icone, toast, folha, campo, entrada, emBreve, etiqueta } from './ui.js';
import * as C from './cadastros.js';

const raiz = document.getElementById('app');

// ---------------------------------------------------------------------
// Abas por perfil
// ---------------------------------------------------------------------
const ABAS = {
  entregador: [['entregar', 'Entregar', 'caminhao'], ['carga', 'Minha carga', 'caixa'], ['fiado', 'Fiado', 'moeda'], ['clientes', 'Clientes', 'pessoas'], ['mais', 'Mais', 'menu']],
  admin: [['painel', 'Painel', 'grafico'], ['estoque', 'Estoque', 'caixa'], ['equipe', 'Equipe', 'pessoas'], ['relatorios', 'Relatórios', 'doc'], ['mais', 'Mais', 'menu']],
  estoquista: [['estoque', 'Estoque', 'caixa'], ['conferir', 'Conferir', 'check'], ['clientes', 'Clientes', 'pessoas'], ['mais', 'Mais', 'menu']],
  atendente: [['pedidos', 'Pedidos', 'lista'], ['clientes', 'Clientes', 'pessoas'], ['fiado', 'Fiado', 'moeda'], ['mais', 'Mais', 'menu']],
};
export const PAPEIS = { admin: 'Admin', entregador: 'Entregador', estoquista: 'Estoquista', atendente: 'Atendente' };

// Telas: cada uma recebe (elemento, contexto) e pode devolver uma função de limpeza
const TELAS = {
  entregar: (el) => el.append(emBreve('Registrar entrega', 3)),
  carga: (el) => el.append(emBreve('Minha carga', 2, 'Retirada no início do turno e devolução no fim chegam na etapa 2.')),
  fiado: (el) => el.append(emBreve('Fiado', 3)),
  painel: C.telaPainel,
  estoque: (el) => el.append(emBreve('Estoque', 2)),
  conferir: (el) => el.append(emBreve('Conferir retiradas e devoluções', 2)),
  relatorios: (el) => el.append(emBreve('Relatórios', 5)),
  pedidos: (el) => el.append(emBreve('Pedidos', 5)),
  clientes: C.telaClientes,
  equipe: C.telaEquipe,
  produtos: C.telaProdutos,
  config: C.telaConfig,
  sinc: C.telaSinc,
  instalar: C.telaInstalar,
  mais: telaMais,
};
const TITULOS = { produtos: 'Produtos', config: 'Configurações', sinc: 'Sincronização', instalar: 'Instalar no celular', clientes: 'Clientes' };

// ---------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------
async function iniciar() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
  }
  if (!D.configurado) return telaNaoConfigurado();

  // Link de convite ou de recuperação de senha (o Supabase coloca no endereço)
  const dadosLink = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  const tipoLink = dadosLink.get('type');
  const erroLink = dadosLink.get('error_description');

  const { data } = await D.sb.auth.getSession();
  if (location.hash.includes('access_token') || erroLink) history.replaceState(null, '', location.pathname + location.search);
  if (erroLink) toast('Link inválido ou expirado. Peça um novo convite.', 'erro');
  const sessao = data.session;
  if (!sessao) return telaLogin();
  if (tipoLink === 'invite' || tipoLink === 'recovery' || tipoLink === 'signup') return telaDefinirSenha(sessao.user, tipoLink);
  entrarNoApp(sessao.user);
}

async function entrarNoApp(user) {
  limpar(raiz, h('div', { class: 'carregando' }, 'Carregando…'));
  const perfil = await D.carregarPerfil(user);
  if (!perfil) return telaSemPerfil();
  if (!perfil.ativo) return telaAguardando(perfil);
  await D.iniciarSessao(perfil);
  montarLayout();
  if (!location.hash.startsWith('#/')) location.hash = '#/' + ABAS[perfil.papel][0][0];
  rotear();
}

// ---------------------------------------------------------------------
// Telas fora do app (login etc.)
// ---------------------------------------------------------------------
function capa(...filhos) {
  limpar(raiz, h('div', { class: 'capa' },
    h('div', { class: 'marca' }, icone('gota', 'marca-ico'), h('span', {}, 'Taka Entregas')),
    ...filhos));
}

function telaLogin() {
  const email = entrada({ type: 'email', autocomplete: 'username', inputmode: 'email', placeholder: 'seu@email.com', required: true });
  const senha = entrada({ type: 'password', autocomplete: 'current-password', placeholder: 'Sua senha', required: true });
  const ver = h('button', { type: 'button', class: 'btn-texto', onclick: () => { senha.type = senha.type === 'password' ? 'text' : 'password'; ver.textContent = senha.type === 'password' ? 'Mostrar' : 'Esconder'; } }, 'Mostrar');
  const botao = h('button', { class: 'btn primario grande', type: 'submit' }, 'Entrar');
  const form = h('form', { class: 'cartao form', onsubmit: async (e) => {
    e.preventDefault();
    botao.disabled = true; botao.textContent = 'Entrando…';
    const { data, error } = await D.sb.auth.signInWithPassword({ email: email.value.trim(), password: senha.value });
    botao.disabled = false; botao.textContent = 'Entrar';
    if (error) return toast(D.traduzirErro(error), 'erro');
    entrarNoApp(data.user);
  } },
    campo('E-mail', email),
    campo('Senha', h('div', { class: 'linha-entrada' }, senha, ver)),
    botao,
    h('button', { type: 'button', class: 'btn-texto centro', onclick: () => esqueciSenha(email.value) }, 'Esqueci minha senha'));
  capa(form);
}

function esqueciSenha(emailInicial) {
  const email = entrada({ type: 'email', value: emailInicial || '', placeholder: 'seu@email.com' });
  const f = folha('Recuperar senha', [
    h('p', {}, 'Vamos enviar um link para você criar uma nova senha.'),
    campo('E-mail', email),
  ], { rodape: [h('button', { class: 'btn primario', onclick: async () => {
    const { error } = await D.sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
    if (error) return toast(D.traduzirErro(error), 'erro');
    toast('Enviado! Confira seu e-mail.'); f.fechar();
  } }, 'Enviar link')] });
}

function telaDefinirSenha(user, tipo) {
  const s1 = entrada({ type: 'password', autocomplete: 'new-password', placeholder: 'Mínimo 6 caracteres' });
  const s2 = entrada({ type: 'password', autocomplete: 'new-password', placeholder: 'Repita a senha' });
  capa(h('form', { class: 'cartao form', onsubmit: async (e) => {
    e.preventDefault();
    if (s1.value.length < 6) return toast('A senha precisa de pelo menos 6 caracteres.', 'erro');
    if (s1.value !== s2.value) return toast('As senhas não são iguais.', 'erro');
    const { error } = await D.sb.auth.updateUser({ password: s1.value });
    if (error) return toast(D.traduzirErro(error), 'erro');
    toast('Senha salva!');
    entrarNoApp(user);
  } },
    h('h2', {}, tipo === 'recovery' ? 'Crie uma nova senha' : 'Bem-vindo! Crie sua senha'),
    h('p', { class: 'suave' }, user.email),
    campo('Nova senha', s1), campo('Confirme a senha', s2),
    h('button', { class: 'btn primario grande', type: 'submit' }, 'Salvar senha')));
}

function telaAguardando(perfil) {
  capa(h('div', { class: 'cartao' },
    h('h2', {}, 'Conta aguardando liberação'),
    h('p', {}, `Sua conta (${perfil.email}) foi criada, mas ainda não foi liberada. Peça ao administrador para liberar seu acesso na tela Equipe.`),
    h('button', { class: 'btn primario grande', onclick: () => location.reload() }, 'Verificar de novo'),
    h('button', { class: 'btn secundario grande', onclick: async () => { await D.sair(); telaLogin(); } }, 'Sair')));
}

function telaSemPerfil() {
  capa(h('div', { class: 'cartao' },
    h('h2', {}, 'Não foi possível carregar seu perfil'),
    h('p', {}, 'Verifique a internet e tente de novo. Se continuar, fale com o administrador.'),
    h('button', { class: 'btn primario grande', onclick: () => location.reload() }, 'Tentar de novo'),
    h('button', { class: 'btn secundario grande', onclick: async () => { await D.sair(); telaLogin(); } }, 'Sair')));
}

function telaNaoConfigurado() {
  capa(h('div', { class: 'cartao' },
    h('h2', {}, 'Falta configurar o Supabase'),
    h('p', {}, 'Abra o arquivo js/config.js e cole a URL e a chave "anon public" do seu projeto Supabase (Project Settings > API).')));
}

// ---------------------------------------------------------------------
// Layout com barra inferior
// ---------------------------------------------------------------------
let elTela, elTitulo, elSinc, limpeza = [];

function montarLayout() {
  const perfil = D.estado.perfil;
  elTitulo = h('div', { class: 'topo-titulo' });
  elSinc = h('button', { class: 'sinc', onclick: () => (location.hash = '#/sinc') });
  elTela = h('main', { id: 'tela' });
  const nav = h('nav', { class: 'abas', 'aria-label': 'Navegação' },
    ABAS[perfil.papel].map(([id, nome, ico]) =>
      h('a', { href: '#/' + id, class: 'aba', 'data-aba': id }, icone(ico), h('span', {}, nome))));
  limpar(raiz, h('header', { class: 'topo' }, elTitulo, elSinc), elTela, nav);
  atualizarTopo();
  D.ao('dados', (n) => { if (n === 'configuracoes') atualizarTopo(); });
  D.ao('fila', atualizarSinc);
  D.ao('conexao', atualizarSinc);
}

function atualizarTopo() { elTitulo.textContent = D.config().nome_negocio || 'Taka Entregas'; atualizarSinc(); }

function atualizarSinc() {
  const pend = D.estado.fila.length;
  const erros = D.estado.fila.filter((o) => o.erro).length;
  const online = D.estado.online;
  elSinc.className = 'sinc ' + (erros ? 'erro' : !online ? 'offline' : pend ? 'pendente' : 'ok');
  limpar(elSinc, h('span', { class: 'bolinha' }),
    erros ? `${erros} com erro` : !online ? (pend ? `Sem internet · ${pend}` : 'Sem internet') : pend ? `Enviando ${pend}` : 'Online');
}

window.addEventListener('hashchange', rotear);

function rotear() {
  if (!elTela || !D.estado.perfil) return;
  const perfil = D.estado.perfil;
  const [rota, ...args] = location.hash.replace(/^#\//, '').split('/');
  const abas = ABAS[perfil.papel].map((a) => a[0]);
  const permitidas = new Set([...abas, 'mais', 'sinc', 'instalar', 'clientes', ...(perfil.papel === 'admin' ? ['produtos', 'config'] : [])]);
  const id = permitidas.has(rota) && TELAS[rota] ? rota : abas[0];

  limpeza.forEach((f) => f && f()); limpeza = [];
  document.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a.dataset.aba === id || (!abas.includes(id) && a.dataset.aba === 'mais')));
  limpar(elTela);
  if (TITULOS[id] && !abas.includes(id)) {
    elTela.append(h('div', { class: 'voltar' },
      h('a', { href: '#/mais', class: 'btn-texto' }, '‹ Mais'),
      h('h1', {}, TITULOS[id])));
  }
  const corpo = h('div', { class: 'tela-corpo' });
  elTela.append(corpo);
  const ctx = {
    perfil, args,
    ao: (ev, fn) => limpeza.push(D.ao(ev, fn)),
    eAdmin: perfil.papel === 'admin',
  };
  try { limpeza.push(TELAS[id](corpo, ctx)); }
  catch (e) { console.error(e); corpo.append(h('div', { class: 'cartao' }, 'Erro ao abrir a tela: ' + e.message)); }
  elTela.scrollTop = 0; window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------
// Mais
// ---------------------------------------------------------------------
function telaMais(el, ctx) {
  const p = ctx.perfil;
  const item = (href, ico, texto, extra) => h('a', { class: 'item-menu', href }, icone(ico), h('span', {}, texto), extra || null, icone('seta', 'seta'));
  const pend = D.estado.fila.length;
  el.append(
    h('div', { class: 'cartao perfil' },
      h('strong', {}, p.nome || p.email), h('span', { class: 'suave' }, p.email), etiqueta(PAPEIS[p.papel], 'azul')),
    h('div', { class: 'menu' },
      ctx.eAdmin ? item('#/clientes', 'pessoas', 'Clientes') : null,
      ctx.eAdmin ? item('#/produtos', 'gota', 'Produtos e preços') : null,
      ctx.eAdmin ? item('#/config', 'config', 'Configurações') : null,
      item('#/sinc', 'nuvem', 'Sincronização', pend ? etiqueta(String(pend), 'amarelo') : null),
      item('#/instalar', 'celular', 'Instalar no celular'),
      h('button', { class: 'item-menu', onclick: async () => {
        if (D.estado.fila.length && !confirm(`Existem ${D.estado.fila.length} registros ainda não enviados. Se sair agora eles ficam guardados neste celular e só serão enviados quando você entrar de novo. Sair mesmo assim?`)) return;
        await D.sair(); location.hash = ''; telaLogin();
      } }, icone('sair'), h('span', {}, 'Sair'))),
  );
}

iniciar();
