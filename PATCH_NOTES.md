# NexoraFlow — Patch Notes

---

## v3.0.0 — Contas, Verificações & Bot Completo
**03 de Abril de 2026**

---

### 🆕 O que há de novo

**👤 Contas individuais**
Cada pessoa tem seu próprio perfil com username, avatar e dados separados. Nada mais compartilhado entre usuários.

**⭐ XP & Níveis**
Complete hábitos e tarefas para ganhar XP e subir de nível. Veja sua posição no Ranking.

**📸 Verificações com foto**
Ao concluir um hábito ou tarefa, envie uma foto como prova. Seus amigos aprovam ou rejeitam — se rejeitado, o XP é desfeito e o item volta para não concluído.

**📱 Versão mobile**
Navegação pelo celular com barra inferior e menu de acesso rápido.

**🤖 Bot Telegram atualizado**
Vincule sua conta pelo bot com `/start` e seu email. Gastos, hábitos e tarefas registrados pelo Telegram caem direto no seu perfil.

**📊 Gráficos melhorados**
Evolução de gastos agora em gráfico de área com visual mais limpo. Lançamentos manuais permitem escolher a data.

---

## v2.0.0 — Refatoração Completa & Novas Funcionalidades
**03 de Abril de 2026**

---

### 🏗️ Infraestrutura

- **Migração para localhost (VS Code)** — projeto reestruturado para rodar 100% localmente com Node.js + Express. O backend serve o frontend diretamente em `http://localhost:3000`, sem necessidade de serviços externos de hospedagem.
- **Hot-reload com Nodemon** — servidor reinicia automaticamente ao salvar qualquer arquivo durante o desenvolvimento.
- **Configuração via `.env`** — todas as credenciais (Supabase, Telegram, Gemini, ngrok) isoladas em variável de ambiente. Arquivo `.env.example` incluído como modelo.
- **Debug integrado ao VS Code** — arquivo `launch.json` configurado para iniciar o servidor com `F5` direto no editor.
- **Auto-configuração do frontend** — credenciais embutidas no HTML. O dashboard abre diretamente sem exigir tela de login a cada acesso.

---

### 🤖 Bot Telegram — Sistema Híbrido de Interpretação

- **Regex + IA (Gemini)** — mensagens simples e diretas são resolvidas por Regex puro (sem consumir chamadas de API). Apenas mensagens ambíguas ou complexas são enviadas ao Gemini.
  - Exemplos resolvidos por Regex: `"gastei 50 no almoço"`, `"fiz academia hoje"`, `"/gastos"`
  - Exemplos enviados à IA: `"acho que gastei demais esse mês"`, `"tive um imprevisto"` 
- **Detecção automática de categoria** — mais de 40 padrões mapeados por regex para classificar gastos automaticamente (Alimentação, Transporte, Lazer, Saúde, Casa, Educação, Roupas, Outros).
- **Remoção de gastos pelo bot** — comandos como `"remover gasto uber"` ou `"excluir último lançamento"` deletam o registro diretamente pelo Telegram.
- **Parcelamentos detectados no texto** — o bot identifica parcelamentos no texto natural:
  - `"paguei 1200 de tv em 12x"` → 12 parcelas de R$100
  - `"comprei tênis 300 parcelado em 3 vezes"` → 3 parcelas de R$100
  - Cada parcela é registrada no mês correto automaticamente.
- **Comando secreto `/reset`** — apaga todos os dados do sistema com fluxo de confirmação em 3 etapas: comando → senha → `CONFIRMAR`. Senha definida via variável `RESET_PASSWORD` no `.env`. Expira em 2 minutos se não for confirmado.
- **Novo comando `gastos de hoje`** — retorna resumo dos gastos do dia atual.

---

### 💸 Gastos

- **Remoção de gastos** — botão `✕` em cada transação na página de Gastos.
- **Ao remover um gasto parcelado**, todas as parcelas do grupo são removidas de uma vez (confirmação indica quantas parcelas serão excluídas).
- **Edição de categoria** — botão `✎` permite alterar a categoria de qualquer gasto já lançado.
- **Modal de lançamento manual** — substituiu os `prompt()` nativos do browser. Campos: descrição, valor, parcelas (seletor de 1x a 36x com preview do valor por parcela em tempo real) e categoria.
- **Badge de parcela** — cada parcela exibe um badge `1/12x` na listagem para identificação visual.
- **Navegação por mês** — controles `‹ ›` na página de Gastos para navegar entre meses. O botão `›` avança até o mês que tiver o lançamento mais recente no banco (útil para visualizar parcelas futuras).
- **Parcelas separadas por mês** — corrigido bug onde todas as parcelas apareciam no mesmo mês. Agora cada parcela aparece apenas no mês em que vence.

---

### 🏃 Hábitos

- **Adição de hábitos** — botão `+ Novo` abre modal com campo de nome e emoji personalizado.
- **Remoção de hábitos** — botão `✕` em cada hábito. Remove o hábito e todos os registros diários vinculados.

---

### 🎯 Metas

- **CRUD completo de metas** — criação, edição e remoção diretamente pelo dashboard.
- **Modal de meta** — campos: nome, valor alvo, valor atual, prazo e seletor de cor visual (6 opções).
- **Botão `✎`** — abre o modal em modo edição com todos os campos preenchidos.
- **Botão `✕`** — remove a meta com confirmação.

---

### 📋 Tarefas

- **Data limite** — campo de data opcional ao criar tarefas. Na listagem exibe badge:
  - 🔴 `⚠ Atrasada` — prazo já passou
  - 🟡 `⏰ Hoje` — vence hoje
  - 🔵 `03/05` — data futura
- **Modal de criação** — substituiu `prompt()`. Campos: descrição, tag e data limite.

---

### 📅 Agenda

- **Nova página de Agenda** — grade de calendário mensal acessível pelo sidebar.
- **Navegação mensal** — controles `‹ ›` para navegar entre meses.
- **Eventos por tipo** — cada dia exibe eventos coloridos por categoria:
  - 🔵 Tarefas com prazo naquele dia
  - 🔴 Gastos registrados naquele dia
  - 🟢 Hábitos concluídos naquele dia
- **Painel de detalhe** — clicar em um dia abre painel com listagem completa dos eventos, mostrando descrição, categoria e valor (para gastos).
- **Adicionar tarefa pela agenda** — botão `+ Evento` ou clique em dia vazio já pré-preenche a data no modal de tarefa.

---

### 📊 Dashboard & Gráficos

- **Alternância de período no gráfico de barras** — botões `7 Dias`, `30 Dias` e `12 Meses` para visualizar evolução dos gastos.
- **Gráfico corrigido** — dashboard usa apenas dados do mês atual, sem misturar parcelas futuras nos totais e gráficos de pizza.

---

### 🎨 Design & Interface

- **Renomeado de HabitFlow para NexoraFlow** em toda a interface, bot e backend.
- **Tema tecnológico** — fontes substituídas por **Orbitron** (títulos/display) e **Space Mono** (corpo/mono).
- **Layout responsivo para mobile** — media queries para telas até 768px e 480px:
  - Sidebar colapsa para barra de navegação horizontal no topo
  - Stats e gráficos se reorganizam em colunas adaptáveis
  - Modais se ajustam à tela pequena
- **Modais substituem `prompt()`** — todos os formulários de criação/edição usam modais com design consistente. Suporte a `Enter` para confirmar e `Escape` para fechar.
- **Badges visuais** — parcelas (`1/12x`), origem Telegram, data limite de tarefas.

---

### 🗄️ Banco de Dados (Supabase)

- **Novas colunas em `expenses`:**
  - `installments` — total de parcelas
  - `installment_current` — número da parcela atual
  - `installment_group` — UUID que agrupa todas as parcelas de uma compra
- **Schema atualizado** — arquivo `schema.sql` revisado com todos os `IF NOT EXISTS` para ser re-executável sem erros.

---

### 🔒 Segurança

- **Webhook via ngrok** — instruções e configuração para expor o servidor local ao Telegram sem deploy.
- **Credenciais no `.env`** — nenhuma chave sensível hardcoded no código-fonte principal.
- **`.gitignore`** — `.env` e `node_modules` ignorados por padrão.

---

*NexoraFlow é um projeto pessoal de gestão financeira e hábitos com bot Telegram, IA Gemini e banco Supabase.*
