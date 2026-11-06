// Cria a conta de alguém que o admin cadastrou em Equipe.
// Com senha: a conta já nasce pronta e a pessoa entra com e-mail e essa senha.
// Sem senha: manda o e-mail de convite do Supabase para a pessoa criar a dela.
// Só o admin ativo pode chamar, e só para um e-mail que já está na tabela convites
// (o perfil nasce ativo com a função escolhida pelo gatilho ao_criar_usuario).
// Já publicada no projeto do Taka (Edge Functions › convidar).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resp = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return resp({ erro: 'Método não permitido' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u, error: eu } = await admin.auth.getUser(token);
    if (eu || !u?.user) return resp({ erro: 'Faça login de novo.' }, 401);
    const { data: perfil } = await admin.from('perfis').select('papel, ativo').eq('id', u.user.id).maybeSingle();
    if (!perfil || !perfil.ativo || perfil.papel !== 'admin') return resp({ erro: 'Só o admin pode cadastrar a equipe.' }, 403);

    const { email, senha, redirectTo } = await req.json();
    const e = String(email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) return resp({ erro: 'E-mail inválido.' }, 400);
    const { data: convite } = await admin.from('convites').select('email, nome').eq('email', e).maybeSingle();
    if (!convite) return resp({ erro: 'Salve o cadastro antes.' }, 400);

    let error;
    if (senha) {
      if (String(senha).length < 6) return resp({ erro: 'A senha precisa de pelo menos 6 caracteres.' }, 400);
      ({ error } = await admin.auth.admin.createUser({ email: e, password: String(senha), email_confirm: true, user_metadata: { nome: convite.nome } }));
    } else {
      const destino = typeof redirectTo === 'string' && /^https:\/\//.test(redirectTo) ? redirectTo : undefined;
      ({ error } = await admin.auth.admin.inviteUserByEmail(e, destino ? { redirectTo: destino } : undefined));
    }
    if (error) {
      const ja = /already|registered|exists/i.test(error.message);
      return resp({ erro: ja ? 'Esse e-mail já tem conta. Peça para a pessoa entrar ou usar "Esqueci minha senha".' : error.message, ja }, 400);
    }
    return resp({ ok: true });
  } catch (err) {
    return resp({ erro: String((err as Error)?.message || err) }, 500);
  }
});
