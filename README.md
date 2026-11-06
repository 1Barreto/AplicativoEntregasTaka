# Taka Entregas

App instalável (PWA) para distribuidora de água mineral: estoque, retiradas, entregas, fiado, vasilhames e fechamento de caixa da equipe.

- HTML, CSS e JavaScript puro, sem build
- Supabase: banco, login, tempo real e permissões (RLS)
- Funciona sem internet: os registros ficam na fila do celular e sobem quando a conexão volta
- Publicado no GitHub Pages

## Arquivos

| Arquivo | O que tem |
| --- | --- |
| `index.html` | Casca do app |
| `css/app.css` | Visual (botões grandes, alto contraste) |
| `js/config.js` | URL e chave pública do Supabase (preencher) |
| `js/dados.js` | Supabase, cache local, fila offline, sincronização, tempo real |
| `js/ui.js` | Componentes de tela e formatação |
| `js/app.js` | Login, perfis, navegação |
| `js/cadastros.js` | Clientes, produtos, equipe, configurações |
| `js/estoque.js` | Estoque do depósito, histórico, carga do entregador, conferência |
| `sw.js`, `manifest.json`, `icons/` | Instalação e funcionamento offline |
| `supabase/schema.sql` | Banco completo: tabelas, regras de acesso, funções |

## Andamento

- [x] Etapa 1: login, perfis e cadastros
- [x] Etapa 2: estoque, retirada e devolução
- [ ] Etapa 3: entrega, fiado e vasilhames
- [ ] Etapa 4: fechamento de caixa e painel
- [ ] Etapa 5: pedidos, clientes recorrentes e relatórios

O passo a passo completo de instalação (Supabase, GitHub Pages, equipe e celulares) entra no final.
