# NexoraFlow — Guia de Instalação Local (VS Code)

Dashboard de finanças e hábitos com bot Telegram, IA Gemini e Supabase.

---

## Estrutura do Projeto

```
nexoraflow/
├── public/
│   └── index.html        ← Frontend (Dashboard)
├── index.js              ← Backend (Bot + API)
├── package.json
├── schema.sql            ← Execute no Supabase SQL Editor
├── .env                  ← Suas credenciais (não suba para o Git!)
├── .env.example          ← Modelo do .env
├── .gitignore
└── .vscode/
    ├── launch.json       ← Configuração de debug no VS Code
    └── settings.json
```

---

## Pré-requisitos

- [Node.js 18+](https://nodejs.org/) instalado
- [VS Code](https://code.visualstudio.com/) instalado
- Conta no [Supabase](https://app.supabase.com/) (gratuita)
- Token de bot Telegram (via [@BotFather](https://t.me/BotFather))
- Chave Gemini (via [aistudio.google.com](https://aistudio.google.com/apikey))

---

## Instalação Passo a Passo

### 1. Abrir o projeto no VS Code

```bash
# Coloque todos os arquivos em uma pasta, ex: nexoraflow/
# Abra o VS Code nessa pasta:
code nexoraflow/
```

---

### 2. Instalar dependências

Abra o terminal no VS Code (`Ctrl+`` ` ou `Terminal → New Terminal`):

```bash
npm install
```

---

### 3. Configurar o banco de dados (Supabase)

1. Acesse [app.supabase.com](https://app.supabase.com) e crie um projeto
2. Vá em **SQL Editor** e cole o conteúdo do arquivo `schema.sql`
3. Clique em **Run**
4. Anote:
   - **Project URL**: `https://xxxx.supabase.co`
   - **anon public key** (em Settings → API)

---

### 4. Configurar variáveis de ambiente

Copie o arquivo de exemplo:

```bash
# Windows (PowerShell)
copy .env.example .env

# Mac/Linux
cp .env.example .env
```

Abra o `.env` no VS Code e preencha:

```env
TELEGRAM_TOKEN=7123456789:AAHxxxxxxxxxxxxxx
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5...
GEMINI_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxx
WEBHOOK_URL=          ← deixe vazio por enquanto
PORT=3000
```

---

### 5. Iniciar o servidor

#### Opção A — Terminal:
```bash
npm run dev
```

#### Opção B — VS Code Debug (recomendado):
1. Pressione `F5` ou clique no ícone de play (Run and Debug)
2. Selecione **"▶ NexoraFlow (Dev)"**
3. O servidor reinicia automaticamente ao salvar arquivos

Você verá no terminal:
```
🚀 NexoraFlow rodando em http://localhost:3000
📊 Dashboard: http://localhost:3000
⚠️  WEBHOOK_URL não definido — bot Telegram inativo.
```

---

### 6. Acessar o Dashboard

Abra o navegador em: **http://localhost:3000**

Na tela de configuração, preencha:
- **Supabase URL**
- **Supabase Anon Key**
- **Link do seu bot** (ex: `https://t.me/seu_bot`)

---

### 7. Ativar o Bot do Telegram (com ngrok)

Para o bot Telegram funcionar localmente, você precisa expor o servidor:

#### Instalar ngrok:
```bash
# Com npm (mais fácil):
npx ngrok http 3000
```

O ngrok vai gerar uma URL como:
```
https://abc123.ngrok-free.app
```

#### Atualizar o .env:
```env
WEBHOOK_URL=https://abc123.ngrok-free.app
```

Salve o arquivo — o nodemon reinicia o servidor e registra o webhook automaticamente.

> ⚠️ O ngrok gera uma URL nova a cada vez que é iniciado.
> Atualize o WEBHOOK_URL no .env sempre que reiniciar o ngrok.

---

## Comandos disponíveis

| Comando | O que faz |
|---|---|
| `npm run dev` | Inicia com hot-reload (nodemon) |
| `npm start` | Inicia sem hot-reload |

---

## Testando o Bot

Com o servidor rodando e o ngrok ativo, vá no Telegram:

```
/start
gastei 50 reais no almoço
paguei 1200 de tv em 12x
fiz academia hoje
quanto gastei essa semana?
remover último gasto
minhas metas
```

O dashboard em http://localhost:3000 atualiza em tempo real!

---

## Solução de Problemas

| Problema | Solução |
|---|---|
| `Cannot find module 'dotenv'` | Rode `npm install` |
| Dashboard não conecta | Verifique SUPABASE_URL e SUPABASE_KEY no .env |
| Bot não responde | Verifique TELEGRAM_TOKEN e se o ngrok está rodando |
| Porta em uso | Mude PORT=3001 no .env |
| `WEBHOOK_URL não definido` | Normal sem ngrok — dashboard funciona normalmente |
