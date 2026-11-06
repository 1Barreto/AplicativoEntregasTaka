// Cadastros: clientes, produtos, equipe, configurações, sincronização.
import * as D from './dados.js';
import {
  h, limpar, icone, toast, folha, confirmar, campo, entrada, selecao, chave,
  brl, lerValor, valorParaCampo, normalizar, uuid, linkWhats, linkMapa, vazio, etiqueta, dataHora,
} from './ui.js';

const PAPEIS = { admin: 'Admin', entregador: 'Entregador', estoquista: 'Estoquista', atendente: 'Atendente' };

// =====================================================================
// CLIENTES
// =====================================================================
export function telaClientes(el, ctx) {
  let termo = sessionStorage.getItem('busca-clientes') || '';
  const busca = entrada({ type: 'search', placeholder: 'Buscar cliente', value: termo, 'aria-label': 'Buscar cliente', enterkeyhint: 'search' });
  const lista = h('div', { class: 'lista' });
  const contagem = h('p', { class: 'suave pequeno' });
  busca.addEventListener('input', () => { termo = busca.value; sessionStorage.setItem('busca-clientes', termo); desenhar(); });

  el.append(
    h('div', { class: 'barra-busca' }, h('div', { class: 'busca' }, icone('busca'), busca),
      h('button', { class: 'btn primario', onclick: () => formCliente(ctx) }, icone('mais'), 'Novo')),
    contagem, lista);

  function desenhar() {
    const t = normalizar(termo).trim();
    const todos = D.tabela('clientes').filter((c) => c.ativo || ctx.eAdmin);
    const achados = !t ? todos : todos.filter((c) =>
      normalizar(`${c.nome} ${c.bairro} ${c.endereco}`).includes(t) || (t.replace(/\D/g, '') && String(c.telefone).replace(/\D/g, '').includes(t.replace(/\D/g, ''))));
    achados.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const mostrar = achados.slice(0, 80);
    contagem.textContent = achados.length > mostrar.length
      ? `Mostrando ${mostrar.length} de ${achados.length}. Refine a busca.`
      : `${achados.length} cliente(s)`;
    limpar(lista, mostrar.length ? mostrar.map((c) =>
      h('button', { class: 'item' + (c.ativo ? '' : ' inativo'), onclick: () => detalheCliente(c.id, ctx) },
        h('div', { class: 'item-texto' },
          h('strong', {}, c.nome),
          h('span', {}, [c.bairro, c.endereco].filter(Boolean).join(' · ') || 'Sem endereço'),
          c.observacoes ? h('small', {}, c.observacoes) : null),
        !c.ativo ? etiqueta('Inativo') : null,
        icone('seta', 'seta'))) : vazio(t ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.',
      h('button', { class: 'btn primario', onclick: () => formCliente(ctx, { nome: termo }) }, 'Cadastrar cliente')));
  }
  desenhar();
  ctx.ao('dados', (n) => { if (n === 'clientes') desenhar(); });
}

// Outras telas acrescentam blocos ao detalhe do cliente (fiado, vasilhames...)
export const extrasCliente = [];

export function detalheCliente(id, ctx) {
  const c = D.tabela('clientes').find((x) => x.id === id);
  if (!c) return;
  const corpo = h('div', { class: 'detalhe' },
    h('div', { class: 'detalhe-info' },
      c.telefone ? h('p', {}, icone('telefone'), c.telefone) : null,
      h('p', {}, icone('caixa'), [c.endereco, c.bairro].filter(Boolean).join(' — ') || 'Sem endereço'),
      c.observacoes ? h('p', { class: 'obs' }, c.observacoes) : null),
    h('div', { class: 'botoes-lado tres-botoes' },
      c.telefone ? h('a', { class: 'btn verde', href: linkWhats(c.telefone), target: '_blank', rel: 'noopener' }, icone('whats'), 'WhatsApp') : null,
      c.telefone ? h('a', { class: 'btn secundario', href: 'tel:' + c.telefone.replace(/[^\d+]/g, '') }, icone('telefone'), 'Ligar') : null,
      linkMapa(c, D.config().cidade) ? h('a', { class: 'btn secundario', href: linkMapa(c, D.config().cidade), target: '_blank', rel: 'noopener' }, icone('mapa'), 'Mapa') : null),
    extrasCliente.map((fn) => fn(c, ctx)),
    ctx.eAdmin ? precosEspeciais(c) : null,
    h('p', { class: 'suave pequeno' }, `Cadastrado em ${dataHora(c.criado_em) || 'agora'} por ${nomePerfil(c.criado_por)}`
      + (c.atualizado_em ? ` · alterado em ${dataHora(c.atualizado_em)} por ${nomePerfil(c.atualizado_por)}` : '')));
  const f = folha(c.nome, corpo, { rodape: [
    h('button', { class: 'btn secundario', onclick: () => { f.fechar(); formCliente(ctx, c); } }, icone('editar'), 'Editar'),
  ] });
  return f;
}

export function nomePerfil(id) {
  const p = D.tabela('perfis').find((x) => x.id === id);
  return p ? (p.nome || p.email) : (id === D.estado.perfil?.id ? 'você' : '—');
}

function precosEspeciais(c) {
  const produtos = D.tabela('produtos').filter((p) => p.ativo);
  const atuais = D.tabela('precos_cliente').filter((x) => x.cliente_id === c.id);
  const campos = produtos.map((p) => {
    const atual = atuais.find((x) => x.produto_id === p.id);
    const inp = entrada({ inputmode: 'decimal', placeholder: valorParaCampo(p.preco_padrao), value: atual ? valorParaCampo(atual.preco) : '', 'aria-label': 'Preço especial ' + p.nome });
    return { p, atual, inp };
  });
  const salvar = async () => {
    let n = 0;
    for (const { p, atual, inp } of campos) {
      const v = lerValor(inp.value);
      if (Number.isNaN(v)) return toast(`Preço inválido em ${p.nome}`, 'erro');
      const filtro = { cliente_id: c.id, produto_id: p.id };
      if (v === null && atual) { await D.enfileirar({ tipo: 'delete', alvo: 'precos_cliente', filtro }); n++; }
      else if (v !== null && atual && Number(atual.preco) !== v) { await D.enfileirar({ tipo: 'update', alvo: 'precos_cliente', dados: { preco: v }, filtro }); n++; }
      else if (v !== null && !atual) { await D.enfileirar({ tipo: 'insert', alvo: 'precos_cliente', dados: { ...filtro, preco: v }, chaves: ['cliente_id', 'produto_id'] }); n++; }
    }
    toast(n ? 'Preços salvos.' : 'Nada mudou.');
  };
  return h('div', { class: 'secao' },
    h('h3', {}, 'Preço especial'),
    h('p', { class: 'suave pequeno' }, 'Deixe em branco para usar o preço padrão.'),
    produtos.length ? campos.map(({ p, inp }) => h('div', { class: 'linha-preco' },
      h('span', {}, p.nome, h('small', {}, 'padrão ' + brl(p.preco_padrao))), inp)) : h('p', {}, 'Cadastre produtos primeiro.'),
    produtos.length ? h('button', { class: 'btn secundario', onclick: salvar }, 'Salvar preços') : null);
}

export function formCliente(ctx, c = {}, aoSalvar) {
  const novo = !c.id;
  const nome = entrada({ value: c.nome || '', autocapitalize: 'words', placeholder: 'Ex.: Dona Maria' });
  const tel = entrada({ value: c.telefone || '', type: 'tel', inputmode: 'tel', placeholder: '(11) 91234-5678' });
  const end = entrada({ value: c.endereco || '', placeholder: 'Rua e número' });
  const bairros = [...new Set(D.tabela('clientes').map((x) => x.bairro).filter(Boolean))].sort();
  const bairro = entrada({ value: c.bairro || '', list: 'lista-bairros', placeholder: 'Bairro' });
  const obs = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Ex.: portão azul, deixar com o porteiro' }, c.observacoes || '');
  const ativo = chave('Cliente ativo', c.ativo !== false);
  const f = folha(novo ? 'Novo cliente' : 'Editar cliente', [
    campo('Nome *', nome), campo('Telefone / WhatsApp', tel), campo('Endereço', end),
    campo('Bairro', bairro), h('datalist', { id: 'lista-bairros' }, bairros.map((b) => h('option', { value: b }))),
    campo('Observações', obs),
    !novo && ctx.eAdmin ? ativo.el : null,
  ], { rodape: [h('button', { class: 'btn primario grande', onclick: async () => {
    const dados = {
      nome: nome.value.trim(), telefone: tel.value.trim(), endereco: end.value.trim(),
      bairro: bairro.value.trim(), observacoes: obs.value.trim(),
    };
    if (!dados.nome) return toast('Informe o nome do cliente.', 'erro');
    if (novo) {
      const linha = { id: uuid(), ...dados, criado_por: ctx.perfil.id };
      await D.enfileirar({ tipo: 'insert', alvo: 'clientes', dados: linha, linhaLocal: { ativo: true, criado_em: new Date().toISOString() }, descricao: 'Novo cliente: ' + dados.nome });
      toast('Cliente cadastrado.');
      f.fechar();
      aoSalvar && aoSalvar(linha);
    } else {
      if (!ctx.eAdmin) delete dados.ativo; else dados.ativo = ativo.input.checked;
      await D.enfileirar({ tipo: 'update', alvo: 'clientes', dados, filtro: { id: c.id }, descricao: 'Alterar cliente: ' + dados.nome });
      toast('Cliente atualizado.');
      f.fechar();
      aoSalvar && aoSalvar({ ...c, ...dados });
    }
  } }, 'Salvar')] });
}

// =====================================================================
// PRODUTOS (admin)
// =====================================================================
export function telaProdutos(el, ctx) {
  const lista = h('div', { class: 'lista' });
  el.append(h('button', { class: 'btn primario grande', onclick: () => formProduto() }, icone('mais'), 'Novo produto'), lista);
  const desenhar = () => {
    const ps = D.tabela('produtos');
    limpar(lista, ps.length ? ps.map((p) =>
      h('button', { class: 'item' + (p.ativo ? '' : ' inativo'), onclick: () => formProduto(p) },
        h('div', { class: 'item-texto' },
          h('strong', {}, p.nome),
          h('span', {}, brl(p.preco_padrao) + ' · alerta abaixo de ' + p.estoque_minimo)),
        p.retornavel ? etiqueta('Retornável', 'azul') : etiqueta('Descartável'),
        !p.ativo ? etiqueta('Inativo') : null)) :
      vazio('Nenhum produto ainda. Comece pelo galão de 20L.'));
  };
  desenhar();
  ctx.ao('dados', (n) => { if (n === 'produtos') desenhar(); });
}

function formProduto(p = {}) {
  const novo = !p.id;
  const nome = entrada({ value: p.nome || '', placeholder: 'Ex.: Galão 20L' });
  const preco = entrada({ value: valorParaCampo(p.preco_padrao), inputmode: 'decimal', placeholder: '0,00' });
  const minimo = entrada({ value: p.estoque_minimo ?? 10, type: 'number', inputmode: 'numeric', min: 0 });
  const ordem = entrada({ value: p.ordem ?? D.tabela('produtos').length, type: 'number', inputmode: 'numeric' });
  const retornavel = chave('Tem vasilhame retornável', p.retornavel !== false);
  const ativo = chave('Produto ativo (aparece nas telas)', p.ativo !== false);
  const f = folha(novo ? 'Novo produto' : 'Editar produto', [
    campo('Nome *', nome), campo('Preço padrão (R$) *', preco),
    retornavel.el,
    campo('Alerta de estoque baixo', minimo, 'Avisa quando os cheios no depósito ficarem neste número ou abaixo.'),
    campo('Ordem na tela', ordem, 'Menor número aparece primeiro.'),
    novo ? null : ativo.el,
  ], { rodape: [h('button', { class: 'btn primario grande', onclick: async () => {
    const v = lerValor(preco.value);
    const dados = {
      nome: nome.value.trim(), preco_padrao: v, retornavel: retornavel.input.checked,
      estoque_minimo: parseInt(minimo.value, 10) || 0, ordem: parseInt(ordem.value, 10) || 0,
      ativo: novo ? true : ativo.input.checked,
    };
    if (!dados.nome) return toast('Informe o nome.', 'erro');
    if (v === null || Number.isNaN(v) || v < 0) return toast('Preço inválido.', 'erro');
    const r = await D.direto(novo ? D.sb.from('produtos').insert(dados) : D.sb.from('produtos').update(dados).eq('id', p.id));
    if (r.erro) return toast(r.rede ? 'Precisa de internet para salvar produtos.' : r.erro, 'erro');
    toast('Produto salvo.'); f.fechar(); D.baixar('produtos');
  } }, 'Salvar')] });
}

// =====================================================================
// EQUIPE (admin)
// =====================================================================
export function telaEquipe(el, ctx) {
  let convites = [];
  const conteudo = h('div');
  el.append(h('h1', {}, 'Equipe'), conteudo);
  const carregarConvites = async () => {
    const r = await D.direto(D.sb.from('convites').select('*').order('criado_em', { ascending: false }));
    if (!r.erro) convites = r.data; desenhar();
  };
  const desenhar = () => {
    const perfis = D.tabela('perfis');
    const emails = new Set(perfis.map((p) => p.email));
    const aguardando = perfis.filter((p) => !p.ativo && !p.atualizado_em);
    const ativos = perfis.filter((p) => p.ativo);
    const desativados = perfis.filter((p) => !p.ativo && p.atualizado_em);
    const pendentes = convites.filter((c) => !emails.has(c.email));
    const pessoa = (p) => h('button', { class: 'item', onclick: () => formPerfil(p, ctx) },
      h('div', { class: 'item-texto' }, h('strong', {}, p.nome || '(sem nome)'), h('span', {}, p.email)),
      etiqueta(PAPEIS[p.papel], p.ativo ? 'azul' : ''), icone('seta', 'seta'));
    limpar(conteudo,
      h('button', { class: 'btn primario grande', onclick: () => formConvite(perfis, carregarConvites) }, icone('mais'), 'Cadastrar pessoa'),
      aguardando.length ? [h('h2', { class: 'titulo-secao alerta' }, 'Aguardando liberação'),
        h('p', { class: 'suave pequeno' }, 'Contas criadas sem convite. Libere só quem você conhece.'),
        h('div', { class: 'lista' }, aguardando.map(pessoa))] : null,
      h('h2', { class: 'titulo-secao' }, `Ativos (${ativos.length})`),
      h('div', { class: 'lista' }, ativos.map(pessoa)),
      pendentes.length ? [h('h2', { class: 'titulo-secao' }, 'Cadastros sem acesso ainda'),
        h('div', { class: 'lista' }, pendentes.map((c) => h('div', { class: 'item' },
          h('div', { class: 'item-texto' }, h('strong', {}, c.nome || c.email), h('span', {}, c.email + ' · ' + PAPEIS[c.papel])),
          h('button', { class: 'btn-texto', onclick: () => formConvite(perfis, carregarConvites, c) }, 'Criar acesso'),
          h('button', { class: 'btn-texto perigo', onclick: async () => {
            if (!(await confirmar(`Cancelar o convite de ${c.email}?`, { sim: 'Cancelar convite', perigo: true }))) return;
            const r = await D.direto(D.sb.from('convites').delete().eq('email', c.email));
            if (r.erro) return toast(r.erro, 'erro');
            carregarConvites();
          } }, 'Cancelar'))))] : null,
      desativados.length ? [h('h2', { class: 'titulo-secao' }, 'Desativados'), h('div', { class: 'lista' }, desativados.map(pessoa))] : null);
  };
  desenhar();
  carregarConvites();
  ctx.ao('dados', (n) => { if (n === 'perfis') desenhar(); });
}

// Senha fácil de ditar: 3 letras + 4 números (ex.: taka4821)
function gerarSenha() {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const n = crypto.getRandomValues(new Uint32Array(7));
  return [0, 1, 2].map((i) => letras[n[i] % letras.length]).join('') + [3, 4, 5, 6].map((i) => n[i] % 10).join('');
}

// Cria a conta no Supabase pela função "convidar" (com senha) ou manda o convite por e-mail (sem senha)
async function criarAcesso(email, senha) {
  try {
    const { data, error } = await D.sb.functions.invoke('convidar', {
      body: { email, senha: senha || undefined, redirectTo: location.origin + location.pathname },
    });
    if (!error) return { ok: true, data };
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.erro || msg; } catch { /* sem corpo */ }
    return { erro: msg, semFuncao: /Failed to send|not found|404|fetch/i.test(String(error.message)) };
  } catch (e) { return { erro: 'Sem conexão com o servidor.', semFuncao: true }; }
}

function formConvite(perfis, aoSalvar, inicial = {}) {
  const email = entrada({ type: 'email', inputmode: 'email', placeholder: 'pessoa@email.com', value: inicial.email || '', autocomplete: 'off' });
  const nome = entrada({ placeholder: 'Nome', autocapitalize: 'words', value: inicial.nome || '' });
  const papel = selecao(Object.entries(PAPEIS), inicial.papel || 'entregador');
  const senha = entrada({ type: 'text', autocomplete: 'new-password', placeholder: 'Mínimo 6 caracteres', value: gerarSenha() });
  const novaSenha = h('button', { type: 'button', class: 'btn secundario', onclick: () => { senha.value = gerarSenha(); } }, 'Gerar');
  const porEmail = chave('Prefiro mandar um convite por e-mail (a pessoa cria a senha)', false);
  const blocoSenha = campo('Senha de acesso *', h('div', { class: 'linha-entrada' }, senha, novaSenha), 'A pessoa entra com este e-mail e esta senha. Ela pode trocar depois em "Esqueci minha senha".');
  porEmail.input.addEventListener('change', () => { blocoSenha.hidden = porEmail.input.checked; });
  const botao = h('button', { class: 'btn primario grande', onclick: async () => {
    const e = email.value.trim().toLowerCase();
    const s = porEmail.input.checked ? '' : senha.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(e)) return toast('E-mail inválido.', 'erro');
    if (perfis.some((p) => p.email === e)) return toast('Essa pessoa já tem conta. Edite-a na lista.', 'erro');
    if (!porEmail.input.checked && s.length < 6) return toast('A senha precisa de pelo menos 6 caracteres.', 'erro');
    botao.disabled = true; botao.textContent = 'Criando…';
    const r = await D.direto(D.sb.from('convites').insert({ email: e, nome: nome.value.trim(), papel: papel.value }));
    if (r.erro && !/já existe/.test(r.erro)) { botao.disabled = false; botao.textContent = 'Criar acesso'; return toast(r.rede ? 'Precisa de internet.' : r.erro, 'erro'); }
    const a = await criarAcesso(e, s);
    botao.disabled = false; botao.textContent = 'Criar acesso';
    if (a.erro) {
      if (a.semFuncao) { f.fechar(); aoSalvar(); return instrucoesConvite(e); }
      return toast(a.erro, 'erro');
    }
    f.fechar(); aoSalvar(); D.baixar('perfis');
    if (s) acessoCriado(e, s, nome.value.trim());
    else toast('Convite enviado para ' + e + '.');
  } }, 'Criar acesso');
  const f = folha('Cadastrar pessoa', [
    campo('E-mail *', email), campo('Nome', nome), campo('Função', papel), blocoSenha, porEmail.el,
  ], { rodape: [botao] });
}

// Mostra os dados de acesso para mandar à pessoa
function acessoCriado(email, senha, nome) {
  const app = location.origin + location.pathname;
  const msg = `Olá${nome ? ', ' + nome.split(' ')[0] : ''}! Seu acesso ao app de entregas:\n${app}\nE-mail: ${email}\nSenha: ${senha}`;
  folha('Acesso criado', [
    h('p', { class: 'aviso ok' }, icone('check'), h('span', {}, 'Pronto! A pessoa já pode entrar.')),
    h('div', { class: 'copiar' }, h('code', {}, `E-mail: ${email}`, h('br'), `Senha: ${senha}`),
      h('button', { class: 'btn secundario', onclick: () => navigator.clipboard.writeText(msg).then(() => toast('Copiado.')) }, 'Copiar')),
    h('a', { class: 'btn verde grande', href: 'https://wa.me/?text=' + encodeURIComponent(msg), target: '_blank', rel: 'noopener' }, icone('whats'), 'Mandar no WhatsApp'),
    h('p', { class: 'suave pequeno' }, 'Anote ou mande agora: a senha não aparece de novo.'),
  ]);
}

function instrucoesConvite(email) {
  folha('Falta um passo', [
    h('p', {}, 'O cadastro foi salvo, mas não deu para criar o acesso automático agora. Crie pelo Supabase:'),
    h('ol', { class: 'passos' },
      h('li', {}, 'Abra o painel do Supabase do seu projeto.'),
      h('li', {}, 'Vá em Authentication › Users.'),
      h('li', {}, 'Clique em "Add user" › "Send invitation".'),
      h('li', {}, 'Cole o e-mail abaixo e envie.')),
    h('div', { class: 'copiar' }, h('code', {}, email),
      h('button', { class: 'btn secundario', onclick: () => navigator.clipboard.writeText(email).then(() => toast('E-mail copiado.')) }, 'Copiar')),
    h('p', { class: 'suave' }, 'A pessoa recebe um link, cria a senha e já entra com a função escolhida.'),
  ]);
}

function formPerfil(p, ctx) {
  const eu = p.id === ctx.perfil.id;
  const nome = entrada({ value: p.nome || '', autocapitalize: 'words' });
  const papel = selecao(Object.entries(PAPEIS), p.papel, { disabled: eu });
  const ativo = chave('Acesso liberado', p.ativo, { disabled: eu });
  const f = folha(p.nome || p.email, [
    h('p', { class: 'suave' }, p.email),
    campo('Nome', nome), campo('Função', papel), ativo.el,
    eu ? h('p', { class: 'suave pequeno' }, 'Você não pode mudar sua própria função nem se desativar.') : null,
    h('p', { class: 'suave pequeno' }, 'Desativar bloqueia o acesso na hora, mas mantém todo o histórico da pessoa.'),
  ], { rodape: [h('button', { class: 'btn primario grande', onclick: async () => {
    const dados = { nome: nome.value.trim() };
    if (!eu) { dados.papel = papel.value; dados.ativo = ativo.input.checked; }
    const r = await D.direto(D.sb.from('perfis').update(dados).eq('id', p.id));
    if (r.erro) return toast(r.rede ? 'Precisa de internet.' : r.erro, 'erro');
    toast('Salvo.'); f.fechar(); D.baixar('perfis');
  } }, 'Salvar')] });
}

// =====================================================================
// CONFIGURAÇÕES (admin)
// =====================================================================
export function enderecoLoja() {
  return new URL('loja.html', location.href.split('#')[0]).href;
}

export function telaConfig(el) {
  const c = D.config();
  const nome = entrada({ value: c.nome_negocio || '' });
  const cidade = entrada({ value: c.cidade || '', placeholder: 'Ex.: Juazeiro - BA' });
  const pix = entrada({ value: c.chave_pix || '', placeholder: 'CPF, CNPJ, e-mail, telefone ou chave aleatória' });
  const recebedor = entrada({ value: c.nome_recebedor_pix || '', placeholder: 'Nome que aparece no Pix' });
  const cobranca = h('textarea', { class: 'entrada', rows: 4 }, c.msg_cobranca || '');
  const oferta = h('textarea', { class: 'entrada', rows: 3 }, c.msg_oferta || '');
  const dias = entrada({ type: 'number', inputmode: 'numeric', min: 0, value: c.dias_aviso_recorrente ?? 2 });
  const diasTrab = entrada({ type: 'number', inputmode: 'numeric', min: 1, max: 31, value: c.dias_trabalho_mes ?? 26 });
  const lojaAtiva = chave('Loja online ligada (clientes podem pedir pelo link)', !!c.loja_ativa);
  const lojaAviso = h('textarea', { class: 'entrada', rows: 2, placeholder: 'Ex.: Promoção da semana: 2 galões por R$ 26' }, c.loja_aviso || '');
  const lojaZap = entrada({ value: c.loja_whatsapp || '', type: 'tel', inputmode: 'tel', placeholder: '(74) 98888-7777' });
  const link = enderecoLoja();
  const msgLoja = `Agora você pode pedir sua água pelo celular, a qualquer hora: ${link}`;

  const salvar = async () => {
    const r = await D.direto(D.sb.from('configuracoes').update({
      nome_negocio: nome.value.trim() || 'Minha Distribuidora', chave_pix: pix.value.trim(),
      nome_recebedor_pix: recebedor.value.trim(), msg_cobranca: cobranca.value, msg_oferta: oferta.value,
      dias_aviso_recorrente: parseInt(dias.value, 10) || 0,
    }).eq('id', 1));
    if (r.erro) return toast(r.rede ? 'Precisa de internet.' : r.erro, 'erro');
    // campos novos (precisam do supabase/melhorias-1.sql)
    const r2 = await D.direto(D.sb.from('configuracoes').update({
      cidade: cidade.value.trim(), dias_trabalho_mes: Math.min(31, Math.max(1, parseInt(diasTrab.value, 10) || 26)),
      loja_ativa: lojaAtiva.input.checked, loja_aviso: lojaAviso.value.trim(), loja_whatsapp: lojaZap.value.trim(),
    }).eq('id', 1));
    if (r2.erro) toast('Salvo, menos loja/cidade/meta: falta rodar o supabase/melhorias-1.sql (veja o GUIA).', 'erro');
    else toast('Configurações salvas.');
    D.baixar('configuracoes');
  };

  el.append(
    h('div', { class: 'cartao form' },
      h('h2', {}, 'Negócio'),
      campo('Nome do negócio', nome),
      campo('Cidade', cidade, 'Usada para abrir o endereço dos clientes no mapa.'),
      campo('Chave Pix', pix), campo('Nome do recebedor Pix', recebedor),
      campo('Dias de trabalho no mês', diasTrab, 'Usado para calcular a meta diária de vendas.')),
    h('div', { class: 'cartao form loja-config' },
      h('h2', {}, icone('loja'), ' Loja online'),
      h('p', { class: 'suave' }, 'Um link para o cliente pedir sozinho, sem instalar nada. Ele é reconhecido pelo telefone e o pedido cai direto em Pedidos.'),
      lojaAtiva.el,
      campo('Recado ou promoção na loja', lojaAviso),
      campo('WhatsApp do negócio', lojaZap, 'Aparece na loja como "falar com a gente".'),
      h('div', { class: 'copiar' }, h('code', {}, link),
        h('button', { class: 'btn secundario', onclick: () => navigator.clipboard.writeText(link).then(() => toast('Link copiado.')) }, 'Copiar')),
      h('div', { class: 'botoes-lado' },
        h('a', { class: 'btn verde', href: 'https://wa.me/?text=' + encodeURIComponent(msgLoja), target: '_blank', rel: 'noopener' }, icone('whats'), 'Divulgar'),
        h('a', { class: 'btn secundario', href: link, target: '_blank', rel: 'noopener' }, 'Ver a loja'))),
    h('div', { class: 'cartao form' },
      h('h2', {}, 'Mensagens'),
      campo('Mensagem de cobrança (fiado)', cobranca, 'Use {nome}, {valor}, {pix} e {negocio}.'),
      campo('Mensagem de oferta (prováveis pedidos)', oferta, 'Use {nome} e {negocio}.'),
      campo('Avisar prováveis pedidos com quantos dias de antecedência', dias)),
    h('button', { class: 'btn primario grande', onclick: salvar }, 'Salvar configurações'));
}

// =====================================================================
// SINCRONIZAÇÃO
// =====================================================================
export function telaSinc(el, ctx) {
  const desenhar = () => {
    const fila = D.estado.fila;
    limpar(el,
      h('div', { class: 'cartao' },
        h('p', { class: 'texto-grande' }, D.estado.online ? 'Conectado ao servidor.' : 'Sem conexão. Os registros ficam guardados neste celular.'),
        h('p', {}, fila.length ? `${fila.length} registro(s) esperando envio.` : 'Tudo enviado.'),
        D.estado.ultimaSinc ? h('p', { class: 'suave pequeno' }, 'Último envio: ' + dataHora(D.estado.ultimaSinc)) : null,
        h('button', { class: 'btn primario grande', onclick: async () => { await D.sincronizar(); toast(D.estado.fila.length ? 'Ainda há pendências.' : 'Tudo enviado.'); } }, 'Enviar agora')),
      fila.length ? h('div', { class: 'lista' }, fila.map((op) => h('div', { class: 'item' + (op.erro ? ' com-erro' : '') },
        h('div', { class: 'item-texto' },
          h('strong', {}, op.descricao || `${op.tipo} ${op.alvo}`),
          h('span', {}, dataHora(op.quando)),
          op.erro ? h('small', { class: 'erro-texto' }, 'Recusado: ' + op.erro) : null),
        op.erro ? h('div', { class: 'botoes-col' },
          h('button', { class: 'btn-texto', onclick: () => D.tentarDeNovo(op.id) }, 'Tentar de novo'),
          h('button', { class: 'btn-texto perigo', onclick: async () => {
            if (await confirmar('Descartar este registro? Ele não será enviado.', { sim: 'Descartar', perigo: true })) D.descartar(op.id);
          } }, 'Descartar')) : null))) : null);
  };
  desenhar();
  ctx.ao('fila', desenhar);
  ctx.ao('conexao', desenhar);
}

// =====================================================================
// INSTALAR
// =====================================================================
export function telaInstalar(el) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  el.append(h('div', { class: 'cartao' },
    instalado ? h('p', { class: 'texto-grande' }, 'O app já está instalado neste celular.') : null,
    h('h2', {}, 'iPhone (Safari)'),
    h('ol', { class: 'passos' },
      h('li', {}, 'Abra o endereço do app no Safari.'),
      h('li', {}, 'Toque no botão Compartilhar (quadrado com seta para cima).'),
      h('li', {}, 'Escolha "Adicionar à Tela de Início" e confirme.')),
    h('h2', {}, 'Android (Chrome)'),
    h('ol', { class: 'passos' },
      h('li', {}, 'Abra o endereço do app no Chrome.'),
      h('li', {}, 'Toque nos três pontinhos no canto de cima.'),
      h('li', {}, 'Escolha "Instalar app" ou "Adicionar à tela inicial".')),
    !ios && window.__pedidoInstalacao ? h('button', { class: 'btn primario grande', onclick: () => window.__pedidoInstalacao.prompt() }, 'Instalar agora') : null));
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__pedidoInstalacao = e; });
