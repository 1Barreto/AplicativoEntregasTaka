# Passo a passo: colocar o Taka Entregas no ar

São 6 partes. Leva por volta de 40 minutos na primeira vez, e você só precisa de um computador para as partes 1 a 4.

1. Criar o banco no Supabase
2. Ligar o app ao seu Supabase
3. Publicar no GitHub Pages
4. Entrar como admin e configurar
5. Cadastrar a equipe
6. Instalar nos celulares

No fim tem uma parte sobre lançar o estoque e o fiado que você já tem hoje, e outra com problemas comuns.

---

## 1. Criar o banco no Supabase

1. Entre em [supabase.com](https://supabase.com) e crie uma conta (pode usar a do GitHub).
2. Clique em **New project**.
   - **Name**: `taka`
   - **Database password**: crie uma senha forte e guarde. O app não usa essa senha, mas você vai precisar dela se um dia quiser mexer direto no banco.
   - **Region**: escolha **South America (São Paulo)**.
   - Clique em **Create new project** e espere uns 2 minutos.
3. No menu da esquerda, abra o **SQL Editor** e clique em **New query**.
4. Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) deste repositório, copie **tudo** e cole no editor.
5. Clique em **Run**. Deve aparecer `Success. No rows returned`. Se aparecer erro, copie a mensagem e me mande.

Esse arquivo cria todas as tabelas, as regras de quem pode ver e fazer o quê, e as funções do app. Rode só uma vez, num projeto novo.

### Ajustes de login (Authentication)

Ainda no Supabase, no menu **Authentication**:

1. **Sign In / Providers** (ou **Providers**):
   - Deixe **Email** ligado.
   - Desligue **Allow new users to sign up**. Assim só entra quem você convidar.
   - Pode deixar **Confirm email** ligado.
2. **URL Configuration**:
   - **Site URL**: `https://1barreto.github.io/aplicativoentregastaka/`
   - Em **Redirect URLs**, adicione: `https://1barreto.github.io/aplicativoentregastaka/**`

   Sem isso, o link do e-mail de convite e o de "esqueci a senha" não voltam para o app.
3. **Emails** (opcional): você pode traduzir os textos dos e-mails de **Invite user** e **Reset password** para português. O link dentro deles tem que continuar como `{{ .ConfirmationURL }}`.

> O envio de e-mail que vem com o Supabase gratuito manda poucos e-mails por hora. Para uma equipe pequena basta. Se um convite não chegar, espere uma hora e reenvie, ou configure um SMTP próprio em **Project Settings › Authentication › SMTP**.

## 2. Ligar o app ao seu Supabase

1. No Supabase, abra **Project Settings › API** (em algumas contas aparece como **Data API** e **API Keys**).
2. Copie:
   - **Project URL**, algo como `https://abcdxyz.supabase.co`
   - A chave **anon public** (em **Legacy API keys**). A chave **publishable** (`sb_publishable_...`) também serve.
   - **Nunca** use a chave `service_role` ou `secret` no app. Ela ignora todas as regras de acesso.
3. No GitHub, abra o arquivo `js/config.js`, clique no lápis (Edit) e troque os dois valores:

   ```js
   window.TAKA_CONFIG = {
     SUPABASE_URL: 'https://abcdxyz.supabase.co',
     SUPABASE_ANON_KEY: 'cole-aqui-a-chave-anon',
   };
   ```

4. Clique em **Commit changes**.

A chave anon fica visível para quem abrir o app, e isso é normal: ela sozinha não dá acesso a nada. Quem protege os dados são as regras do banco (RLS), que exigem login e checam a função de cada pessoa.

## 3. Publicar no GitHub Pages

1. Primeiro junte as mudanças no ramo principal: no GitHub, abra o pull request do app e clique em **Merge pull request**.
2. No repositório, vá em **Settings › Pages**.
3. Em **Build and deployment**:
   - **Source**: Deploy from a branch
   - **Branch**: `main` e pasta `/ (root)`
   - Clique em **Save**.
4. Espere 1 ou 2 minutos e recarregue a página. Vai aparecer o endereço:
   `https://1barreto.github.io/aplicativoentregastaka/`

> O GitHub Pages gratuito só publica repositório **público**. O código ficar público não expõe nenhum dado: os dados estão no Supabase, protegidos por login.

Sempre que alguém mudar algo no `main`, o site atualiza sozinho em 1 ou 2 minutos. Os celulares pegam a versão nova na próxima vez que abrirem o app com internet.

## 4. Entrar como admin e configurar

1. No Supabase, vá em **Authentication › Users › Add user › Create new user**.
   - Coloque seu e-mail e uma senha.
   - Marque **Auto Confirm User**.
2. Abra o **SQL Editor** e rode, trocando pelo seu e-mail e nome:

   ```sql
   update public.perfis set papel = 'admin', ativo = true, nome = 'Rafael'
    where email = 'seu@email.com';
   ```

   Deve aparecer `1 row affected`.
3. Abra `https://1barreto.github.io/aplicativoentregastaka/` e entre com esse e-mail e senha.
4. Em **Mais › Configurações**, preencha:
   - nome do negócio
   - chave Pix e nome de quem recebe (vão na mensagem do botão Cobrar)
   - textos das mensagens de cobrança e de oferta
   - quantos dias antes avisar dos clientes recorrentes
5. Em **Mais › Produtos e preços**, confira os produtos, preços, se é retornável e o estoque mínimo de cada um.
6. Em **Mais › Clientes**, cadastre os clientes (ou deixe a equipe cadastrar conforme for entregando).

## 5. Cadastrar a equipe

Para cada pessoa:

1. No app, vá em **Equipe › Convidar pessoa**. Coloque o e-mail, o nome e a função:
   - **Entregador**: pega carga, entrega, recebe, fecha o caixa.
   - **Atendente**: cria pedidos, cadastra clientes, recebe fiado.
   - **Estoquista**: entrada do fornecedor, saída de vazios, confere retirada e devolução.
   - **Admin**: tudo, mais ajustes, estornos, confirmação de caixa e relatórios.
2. No Supabase, vá em **Authentication › Users › Add user › Send invitation** e coloque o **mesmo e-mail**.
3. A pessoa recebe um e-mail, toca no link, cai no app e cria a senha dela. Pronto: já entra com a função que você escolheu.

O convite precisa ser feito no app **antes** do envio no Supabase. Se a conta for criada sem convite, ela aparece em **Equipe › Aguardando liberação** e só entra depois que você liberar.

Para tirar alguém: **Equipe**, toque na pessoa e em **Desativar**. Ela perde o acesso na hora, e tudo o que ela registrou continua no histórico com o nome dela.

Se alguém esquecer a senha, é só tocar em **Esqueci minha senha** na tela de entrada.

## 6. Instalar nos celulares

Cada pessoa faz isso no próprio celular, com internet, depois de entrar uma vez.

### iPhone

1. Abra o endereço do app no **Safari** (tem que ser o Safari).
2. Entre com e-mail e senha.
3. Toque no botão **Compartilhar** (o quadrado com a seta para cima).
4. Role e toque em **Adicionar à Tela de Início**, depois em **Adicionar**.
5. Abra o app pelo ícone **Taka** que apareceu. Ele abre em tela cheia, sem a barra do Safari.

No iPhone, o app instalado tem login separado do Safari. Se pedir para entrar de novo pelo ícone, é normal: é só na primeira vez.

### Android

1. Abra o endereço do app no **Chrome**.
2. Entre com e-mail e senha.
3. Toque nos três pontinhos **⋮** e em **Instalar app** (ou **Adicionar à tela inicial**).
4. Confirme. O ícone **Taka** aparece com os outros apps.

Dentro do app, em **Mais › Instalar no celular**, tem essas mesmas instruções para mostrar para a equipe.

### Sem internet

Depois de aberto uma vez com internet, o app funciona sem sinal. Entregas, retiradas, pagamentos e pedidos ficam guardados no celular, e a bolinha no topo mostra quantos estão esperando. Quando o sinal volta, tudo sobe sozinho e sem duplicar, mesmo que a pessoa toque duas vezes. Em **Mais › Sincronização** dá para ver a fila e tentar de novo.

Estorno, ajustes de admin e confirmação de fechamento precisam de internet.

---

## Lançar o que você já tem hoje

Faça isso uma vez, logo depois de configurar, entrando como admin.

- **Estoque do depósito**: em **Estoque**, toque em **Ajuste de estoque**, escolha o produto e lance os cheios e os vazios que estão no depósito, com o motivo "Saldo inicial".
- **Vasilhames com clientes**: abra o cliente em **Clientes** e toque em **Ajustar vasilhames**, com a quantidade que ele tem emprestada.
- **Fiado do caderno**: abra o cliente em **Clientes** e toque em **Lançar saldo antigo**. Deixe marcado **Lançar dívida**, coloque o valor que ele deve e o motivo "Saldo do caderno".

Nada no app é apagado. Para corrigir qualquer número, sempre se faz um novo ajuste com o motivo, e o histórico mostra quem fez e quando.

## O dia a dia, em resumo

1. **Início do turno**: o entregador abre **Minha carga › Iniciar turno** e marca o que pegou.
2. **Na rua**: em **Entregar**, escolhe o cliente, a quantidade, os vazios recebidos e a forma de pagamento. Pedidos criados pela atendente aparecem no topo.
3. **Fim do turno**: em **Minha carga › Devolver e encerrar**, marca o que voltou. O app confere se retirado = entregue + devolvido, mostra o dinheiro esperado e ele envia o fechamento com o dinheiro contado.
4. **Admin**: o **Painel** mostra o dia, os fechamentos para confirmar e as diferenças. Em **Relatórios** dá para ver qualquer período e baixar planilhas.

## Problemas comuns

| O que aparece | O que fazer |
| --- | --- |
| "Falta configurar o Supabase" ao abrir | O `js/config.js` ainda está com os valores de exemplo. Refaça a parte 2. |
| "Sua conta foi criada, mas ainda não foi liberada" | Faltou o convite no app, ou a pessoa usou outro e-mail. Libere em **Equipe › Aguardando liberação**. |
| O link do e-mail abre uma página de erro | Confira a **Site URL** e as **Redirect URLs** da parte 1. |
| O convite não chegou | Olhe o spam. O e-mail gratuito do Supabase tem limite por hora; espere e reenvie. |
| No iPhone não aparece "Adicionar à Tela de Início" | Tem que ser no Safari, não no Chrome nem dentro do WhatsApp. |
| O app não mostra a versão nova | Feche o app de vez e abra de novo com internet. |
| O projeto do Supabase foi pausado | O plano gratuito pausa depois de uma semana sem uso. Entre no Supabase e clique em **Restore**. Com uso diário isso não acontece. |
