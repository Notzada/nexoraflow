// ============================================
// NEXORAFLOW BACKEND
// Telegram Bot + Gemini AI + Supabase
// Sistema Híbrido: Regex (comandos simples) + IA (mensagens complexas)
//
// SCHEMA UPDATE: rode no Supabase SQL Editor:
// ALTER TABLE expenses ADD COLUMN IF NOT EXISTS installments int default 1;
// ALTER TABLE expenses ADD COLUMN IF NOT EXISTS installment_current int default 1;
// ALTER TABLE expenses ADD COLUMN IF NOT EXISTS installment_group uuid;
// ============================================

require('dotenv').config();
const path    = require('path');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { addXP, updateStreak }              = require('./services/xpService');
const { addWeeklyXP, getWeeklyRanking, getFriendRanking } = require('./services/rankingService');
const { ensureReferralCode, addFriend, getFriends }       = require('./services/friendService');
const { checkAndGrantAchievements }                       = require('./services/achievementService');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN      = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_KEY        = process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GEMINI_KEY          = process.env.GEMINI_KEY;
const WEBHOOK_URL         = process.env.WEBHOOK_URL;

const RESET_PASSWORD = process.env.RESET_PASSWORD || 'nexora2025';
// Cliente admin (bypassa RLS) — usado em todas as operações do bot
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_KEY);
const genAI    = new GoogleGenerativeAI(GEMINI_KEY);
const model    = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

// Mapa de estados pendentes por chatId
const pendingReset  = new Map();
const pendingLink   = new Map(); // chatId → { step: 'awaiting_email' }
const pendingGoal   = new Map(); // chatId → { category, ts }
const pendingFriend = new Map(); // chatId → { ts }

// ============================================
// HELPER: concede XP + streak + weekly + retorna texto de gamificação
// Verifica conquistas e notifica o usuário pelo Telegram se houver novas
async function notifyAchievements(chatId, userId) {
  try {
    const newOnes = await checkAndGrantAchievements(
      supabaseAdmin,
      userId,
      (uid, amount, reason) => {
        addXP(supabaseAdmin, uid, amount, reason);
        addWeeklyXP(supabaseAdmin, uid, amount);
      }
    );
    for (const ach of newOnes) {
      await sendTelegram(chatId,
        `🏆 *CONQUISTA DESBLOQUEADA!*\n\n*${ach.name}*\n_${ach.desc}_\n\n⭐ +${ach.xp} XP`
      );
    }
  } catch (e) {
    console.error('Erro ao checar conquistas:', e.message);
  }
}

// ============================================
async function grantXP(userId, amount, reason) {
  const [xpResult, streakResult] = await Promise.all([
    addXP(supabaseAdmin, userId, amount, reason),
    updateStreak(supabaseAdmin, userId),
  ]);
  await addWeeklyXP(supabaseAdmin, userId, amount);

  let bonusText = '';
  if (streakResult.bonus > 0) {
    await addXP(supabaseAdmin, userId, streakResult.bonus, `Streak ${streakResult.bonusReason}`);
    await addWeeklyXP(supabaseAdmin, userId, streakResult.bonus);
    bonusText = `\n🔥 *${streakResult.bonusReason}!* +${streakResult.bonus} XP bônus!`;
  }

  const levelUpText = xpResult?.levelUp ? `\n🎉 *LEVEL UP! Você é agora Nível ${xpResult.level}!*` : '';
  const streakText  = streakResult.streak > 1 ? `\n🔥 Sequência: *${streakResult.streak} dias*` : '';

  return `\n⭐ *+${amount} XP* (${xpResult?.totalXp || 0} total · Nível ${xpResult?.level || 1})${streakText}${bonusText}${levelUpText}`;
}

// ============================================
// VINCULAÇÃO TELEGRAM ↔ USUÁRIO
// ============================================
async function getUserByChat(chatId) {
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('id, username')
    .eq('telegram_chat_id', chatId)
    .single();
  return data || null;
}

async function linkTelegramByEmail(chatId, email) {
  const normalized = email.toLowerCase().trim();
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update({ telegram_chat_id: chatId })
    .eq('email', normalized)
    .select('id, username')
    .single();
  if (error) console.error('linkTelegramByEmail error:', error.message);
  if (error || !data) return null;
  return data;
}

// ============================================
// TELEGRAM: registrar webhook
// ============================================
async function registerWebhook() {
  const url  = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${WEBHOOK_URL}/webhook`;
  const res  = await fetch(url);
  const data = await res.json();
  console.log('Webhook registrado:', data.ok ? '✅' : '❌', data.description || '');
}

// ============================================
// CAMADA 1 — REGEX: comandos simples e diretos
// ============================================

const CATEGORY_MAP = {
  Alimentação: [
    /almo[çc]o/i, /janta/i, /caf[eé]/i, /restaurante/i, /lanche/i,
    /pizza/i, /hamburguer/i, /ifood/i, /rappi/i, /mercado/i, /supermercado/i,
    /padaria/i, /a[çc]ougue/i, /hortifruti/i, /feira/i, /delivery/i,
  ],
  Transporte: [
    /uber/i, /99/i, /taxi/i, /t[áa]xi/i, /[oô]nibus/i, /metro/i,
    /metr[ôo]/i, /gasolina/i, /combust[ií]vel/i, /estacionamento/i,
    /ped[áa]gio/i, /passagem/i, /bilhete/i, /brt/i,
  ],
  Saúde: [
    /farm[áa]cia/i, /rem[eé]dio/i, /medica(mento)?/i, /m[eé]dico/i,
    /consulta/i, /exame/i, /plano de sa[úu]de/i, /hospital/i, /cl[ií]nica/i,
    /dentista/i, /psic[oó]logo/i, /suplemento/i,
  ],
  Lazer: [
    /cinema/i, /teatro/i, /show/i, /bar/i, /balada/i, /festa/i,
    /netflix/i, /spotify/i, /steam/i, /jogo/i, /game/i, /viagem/i,
    /hotel/i, /passeio/i, /ingresso/i,
  ],
  Casa: [
    /aluguel/i, /condom[ií]nio/i, /conta de luz/i, /conta de [áa]gua/i,
    /internet/i, /telefone/i, /g[áa]s/i, /limpeza/i, /reforma/i,
  ],
  Educação: [
    /curso/i, /faculdade/i, /escola/i, /livro/i, /apostila/i,
    /mensalidade/i, /matr[ií]cula/i, /udemy/i, /alura/i,
  ],
  Roupas: [
    /roupa/i, /camisa/i, /cal[çc]a/i, /t[êe]nis/i, /sapato/i,
    /vestido/i, /jaqueta/i, /zara/i, /renner/i, /riachuelo/i,
  ],
};

const HABIT_KEYWORDS = [
  { regex: /academia|treino|muscula[çc][ãa]o|exerc[ií]cio|gym/i,  name: 'Academia',    emoji: '💪' },
  { regex: /medita[çc][ãa]o|meditei|mindfulness/i,                 name: 'Meditação',   emoji: '🧘' },
  { regex: /leitura|li um livro|li \d+ p[áa]ginas|lendo/i,         name: 'Leitura',     emoji: '📚' },
  { regex: /bebi [12][\.,]?\d*\s*l(itros)?|[áa]gua.*dia|hidrat/i, name: 'Água 2L',     emoji: '💧' },
  { regex: /dormi cedo|dormir cedo|cama cedo/i,                     name: 'Dormir cedo', emoji: '😴' },
  { regex: /corri|corrida|running/i,                                name: 'Corrida',     emoji: '🏃' },
];

const QUERY_KEYWORDS = [
  { regex: /quanto gastei (essa|esta) semana|gastos da semana|resumo da semana/i, question: 'gastos' },
  { regex: /quanto gastei (esse|este) m[eê]s|gastos do m[eê]s|resumo do m[eê]s/i, question: 'mes' },
  { regex: /gastos de hoje|gastei hoje|quanto gastei hoje/i,                       question: 'hoje' },
  { regex: /meus h[áa]bitos|h[áa]bitos de hoje|fiz hoje/i,                        question: 'habitos' },
  { regex: /minhas metas|ver metas|metas financeiras/i,                            question: 'metas' },
  { regex: /resumo|relat[oó]rio|como estou/i,                                      question: 'gastos' },
  { regex: /\/gastos/i,                                                             question: 'gastos' },
  { regex: /\/habitos|\/hábitos/i,                                                 question: 'habitos' },
  { regex: /\/metas/i,                                                              question: 'metas' },
];

// Detecção de parcelamento no texto
// Exemplos: "em 3x", "3 vezes", "parcelado em 6x", "12 parcelas", "em 10 vezes"
const INSTALLMENT_REGEX = /(?:parcelado\s+)?em\s+(\d+)\s*[xX×]|(\d+)\s*[xX×]|(\d+)\s+(?:vezes|parcelas?)/i;

// Gasto principal
const EXPENSE_REGEX     = /(?:gastei|paguei|comprei|custou|cobrou|desembolsei|gasto de|gasto com)\s+(?:r\$\s*)?(\d+[\.,]?\d*)\s*(?:reais?|r\$)?\s*(?:(?:com|de|no?|na|em(?!\s+\d)|por|pelo?|pela)\s+(.+))?/i;
const EXPENSE_REGEX_ALT = /(?:r\$\s*)?(\d+[\.,]?\d*)\s*(?:reais?)?\s*(?:de|no?|na|com)\s+(.+)/i;

// Remoção de gasto pelo Telegram
// Exemplos: "remover gasto almoço", "excluir último gasto", "deletar gasto uber", "cancelar último lançamento"
const DELETE_EXPENSE_REGEX = /(?:remov[ae]r?|exclu[íi]r?|delet[ae]r?|cancela[r]?|apaga[r]?)\s+(?:o\s+)?(?:[úu]ltimo\s+)?(?:gasto|lan[çc]amento|despesa)(?:\s+(?:do|de|da|com|no?|na)\s+(.+))?/i;
const DELETE_LAST_REGEX    = /(?:remov[ae]r?|exclu[íi]r?|delet[ae]r?|cancela[r]?|apaga[r]?)\s+(?:o\s+)?[úu]ltimo/i;

const TASK_REGEX = /(?:preciso|lembrar de|n[ãa]o esquecer de|anota[r]?|add tarefa|tarefa:|todo:)\s+(.+)/i;
const CREATE_HABIT_REGEX = /(?:criar?|add|adicionar?|novo|nova|cadastrar?)\s+h[áa]bito\s+(.+)|h[áa]bito\s+novo[:\s]+(.+)/i;

// Renda: "recebi 3000", "entrou 2500 de salário", "ganhei 500 de freela"
const INCOME_REGEX = /(?:recebi|ganhei|entrou|caiu na conta|dep[oó]sito de|pagamento de|recebimento de)\s+(?:r\$\s*)?(\d+[\.,]?\d*)|(?:r\$\s*)?(\d+[\.,]?\d*)\s+(?:de\s+)?(?:sal[áa]rio|renda|receita|freela|freelance|bonus|b[oô]nus)/i;

// Meta de limite: "quero gastar menos com comida", "quero gastar no máximo 500 em alimentação"
const SPENDING_GOAL_REGEX = /(?:quero|vou|preciso)\s+gastar\s+(?:menos\s+(?:com|em|de)\s+(.+)|no\s+m[áa]ximo\s+(?:r\$\s*)?(\d+[\.,]?\d*)\s+(?:(?:com|em|de)\s+(.+))?)/i;

function detectCategory(text) {
  for (const [cat, patterns] of Object.entries(CATEGORY_MAP)) {
    if (patterns.some(p => p.test(text))) return cat;
  }
  return 'Outros';
}

// Extrai o número de parcelas de um texto, retorna 1 se não encontrar
function detectInstallments(text) {
  const m = INSTALLMENT_REGEX.exec(text);
  if (!m) return 1;
  const n = parseInt(m[1] || m[2] || m[3], 10);
  return (n >= 2 && n <= 72) ? n : 1;
}

function tryRegex(text) {
  const t = text.trim();

  // DELETE EXPENSE (antes das queries para não conflitar)
  if (DELETE_LAST_REGEX.test(t) || DELETE_EXPENSE_REGEX.test(t)) {
    const descMatch = DELETE_EXPENSE_REGEX.exec(t);
    const keyword   = descMatch?.[1]?.trim() || null;
    console.log('⚡ [REGEX] delete_expense → keyword:', keyword);
    return { type: 'delete_expense', data: { keyword }, reply: null, _source: 'regex' };
  }

  // QUERY
  for (const { regex, question } of QUERY_KEYWORDS) {
    if (regex.test(t)) {
      console.log('⚡ [REGEX] query →', question);
      return { type: 'query', data: { question }, reply: null, _source: 'regex' };
    }
  }

  // HÁBITO
  for (const { regex, name, emoji } of HABIT_KEYWORDS) {
    if (/fiz|fui|completei|terminei|realizei|pratiquei|treinei|li|corri|bebi|meditei/i.test(t) && regex.test(t)) {
      console.log('⚡ [REGEX] habit →', name);
      return {
        type: 'habit',
        data: { name, emoji },
        reply: `${emoji} *${name}* registrado! Continue assim! 💪`,
        _source: 'regex'
      };
    }
  }

  // GASTO (com detecção de parcelamento)
  let match = EXPENSE_REGEX.exec(t) || EXPENSE_REGEX_ALT.exec(t);
  if (match) {
    const amount       = parseFloat(match[1].replace(',', '.'));
    const description  = (match[2] || t).trim().replace(/\.$/, '');
    const category     = detectCategory(description + ' ' + t);
    const installments = detectInstallments(t);
    console.log('⚡ [REGEX] expense →', { amount, description, category, installments });
    return {
      type: 'expense',
      data: { description, amount, category, installments },
      reply: installments > 1
        ? `💳 *${description}* — R$${amount.toFixed(2)} em *${installments}x de R$${(amount/installments).toFixed(2)}* registrado! (${category})`
        : `💸 *R$${amount.toFixed(2)}* em *${description}* registrado! (${category})`,
      _source: 'regex'
    };
  }

  // RENDA
  const incomeMatch = INCOME_REGEX.exec(t);
  if (incomeMatch) {
    const amount = parseFloat((incomeMatch[1] || incomeMatch[2]).replace(',', '.'));
    // Extrai descrição removendo o match e palavras genéricas
    const STOP = /^(hoje|agora|ontem|aqui|ja|já|nao|não|\d+|\s)+$/i;
    const rawDesc = t.replace(INCOME_REGEX, '').trim().replace(/^(de|do|da|em)\s+/i, '').trim();
    const desc = (!rawDesc || STOP.test(rawDesc)) ? 'Renda' : rawDesc;
    console.log('⚡ [REGEX] income →', { amount, desc });
    return {
      type: 'income',
      data: { description: desc, amount },
      reply: `💰 *+R$${amount.toFixed(2)}* registrado como renda! 🎉`,
      _source: 'regex'
    };
  }

  // META DE LIMITE DE GASTOS
  const goalMatch = SPENDING_GOAL_REGEX.exec(t);
  if (goalMatch) {
    const category = (goalMatch[3] || goalMatch[1] || '').trim();
    const limit    = goalMatch[2] ? parseFloat(goalMatch[2].replace(',', '.')) : null;
    console.log('⚡ [REGEX] spending_goal →', { category, limit });
    return {
      type: 'spending_goal',
      data: { category, limit },
      reply: null,
      _source: 'regex'
    };
  }

  // CRIAR HÁBITO (sem marcar como feito)
  const createHabitMatch = CREATE_HABIT_REGEX.exec(t);
  if (createHabitMatch) {
    const habitName = (createHabitMatch[1] || createHabitMatch[2]).trim();
    console.log('⚡ [REGEX] create_habit →', habitName);
    return {
      type: 'create_habit',
      data: { name: habitName, emoji: '✅' },
      reply: `✅ Hábito *${habitName}* criado! Marque quando completar.`,
      _source: 'regex'
    };
  }

  // TAREFA
  const taskMatch = TASK_REGEX.exec(t);
  if (taskMatch) {
    const taskText = taskMatch[1].trim();
    console.log('⚡ [REGEX] task →', taskText);
    return {
      type: 'task',
      data: { text: taskText, tag: 'Geral' },
      reply: `📋 Tarefa adicionada: *${taskText}*`,
      _source: 'regex'
    };
  }

  return null;
}

// ============================================
// CAMADA 2 — GEMINI: mensagens complexas/ambíguas
// ============================================
async function interpretWithAI(text) {
  console.log('🤖 [GEMINI] chamando IA para:', text);

  const prompt = `
Você é um assistente de finanças e hábitos pessoais.
Analise a mensagem abaixo e retorne APENAS um JSON válido (sem markdown, sem explicação).

Mensagem: "${text}"

Categorias de gastos válidas: Alimentação, Transporte, Lazer, Saúde, Casa, Educação, Roupas, Outros

Se a mensagem mencionar parcelamento (ex: "em 3x", "parcelado em 6 vezes"), extraia o número de parcelas.
Se mencionar remoção/exclusão de gasto, use type "delete_expense" com keyword do que remover.
Se pedir para CRIAR/ADICIONAR um hábito (sem dizer que completou), use type "create_habit" com o nome no campo "name".
Se disser que COMPLETOU/FEZ um hábito, use type "habit".
Se mencionar que RECEBEU dinheiro (salário, renda, freela, depósito), use type "income" com amount e description.
Se quiser LIMITAR gastos com uma categoria (ex: "quero gastar menos com comida"), use type "spending_goal" com category e limit (null se não informado).

Retorne um JSON com EXATAMENTE este formato:
{
  "type": "expense" | "income" | "habit" | "create_habit" | "task" | "query" | "delete_expense" | "spending_goal" | "unknown",
  "data": {
    "description": "descrição",
    "amount": 0.0,
    "category": "Alimentação",
    "installments": 1,
    "keyword": "palavra-chave para encontrar o gasto a remover",
    "name": "nome do hábito",
    "text": "descrição da tarefa",
    "tag": "Pessoal",
    "question": "gastos" | "mes" | "hoje" | "habitos" | "metas"
  },
  "reply": "mensagem amigável de confirmação em português"
}
`;

  try {
    const result = await model.generateContent(prompt);
    const raw    = result.response.text().trim();
    const clean  = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    parsed._source = 'ai';
    return parsed;
  } catch (e) {
    console.error('Erro Gemini:', e.message);
    return {
      type: 'unknown', data: {},
      reply: 'Não entendi. Tente: "gastei 50 no almoço" ou "fiz academia hoje".',
      _source: 'ai_error'
    };
  }
}

async function interpretMessage(text) {
  const fast = tryRegex(text);
  if (fast) return fast;
  return interpretWithAI(text);
}

// ============================================
// SUPABASE: salvar (com user_id)
// ============================================
async function saveExpense({ description, amount, category, installments = 1 }, userId) {
  const n = parseInt(installments, 10) || 1;

  if (n <= 1) {
    const { error } = await supabaseAdmin.from('expenses').insert([{
      description, amount: parseFloat(amount), category: category || 'Outros',
      source: 'telegram', installments: 1, installment_current: 1, user_id: userId
    }]);
    if (error) console.error('ERRO AO SALVAR GASTO:', error);
    else console.log('✅ Gasto salvo:', description, amount);
    return;
  }

  const groupId  = crypto.randomUUID();
  const parcela  = parseFloat(amount) / n;
  const baseDate = new Date();
  const rows = [];

  for (let i = 0; i < n; i++) {
    const d = new Date(baseDate);
    d.setMonth(d.getMonth() + i);
    rows.push({
      description: `${description} (${i+1}/${n})`,
      amount: parseFloat(parcela.toFixed(2)),
      category: category || 'Outros',
      source: 'telegram',
      installments: n,
      installment_current: i + 1,
      installment_group: groupId,
      created_at: d.toISOString(),
      user_id: userId
    });
  }

  const { error } = await supabaseAdmin.from('expenses').insert(rows);
  if (error) console.error('ERRO AO SALVAR PARCELAS:', error);
  else console.log(`✅ ${n} parcelas salvas para "${description}"`);
}

async function createHabit(habitName, emoji, userId) {
  const { data: existing } = await supabaseAdmin.from('habits').select('id')
    .eq('user_id', userId).ilike('name', habitName).limit(1);
  if (existing && existing.length > 0) return existing[0];
  const { data } = await supabaseAdmin.from('habits')
    .insert({ name: habitName, emoji: emoji || '✅', user_id: userId }).select().single();
  return data;
}

async function saveHabitLog(habitName, userId) {
  const { data: habits } = await supabaseAdmin.from('habits').select('id, name')
    .eq('user_id', userId).ilike('name', `%${habitName}%`).limit(1);
  let habitId;
  if (!habits || habits.length === 0) {
    const { data: newHabit } = await supabaseAdmin.from('habits')
      .insert({ name: habitName, emoji: '✅', user_id: userId }).select().single();
    if (!newHabit) return;
    habitId = newHabit.id;
  } else {
    habitId = habits[0].id;
  }
  await supabaseAdmin.from('habit_logs').upsert({
    habit_id: habitId,
    done_at:  new Date().toISOString().split('T')[0],
    source:   'telegram',
    user_id:  userId
  }, { onConflict: 'habit_id,done_at' });
}

async function saveTask({ text, tag }, userId) {
  await supabaseAdmin.from('tasks').insert({ text, tag: tag || 'Geral', user_id: userId });
}

async function saveIncome({ description, amount }, userId) {
  const { error } = await supabaseAdmin.from('expenses').insert([{
    description: description || 'Renda',
    amount: parseFloat(amount),
    category: 'Renda',
    source: 'telegram',
    installments: 1,
    installment_current: 1,
    user_id: userId
  }]);
  if (error) console.error('ERRO AO SALVAR RENDA:', error);
  else console.log('✅ Renda salva:', description, amount);
}

async function createSpendingGoal(category, limit, userId) {
  const name = `Limite ${category}`;
  const { error } = await supabaseAdmin.from('goals').insert({
    name,
    target: parseFloat(limit),
    current: 0,
    color: '#a855f7',
    user_id: userId
  });
  if (error) console.error('ERRO AO CRIAR META:', error);
  return !error;
}

// ============================================
// SUPABASE: remoção de gasto via Telegram
// ============================================
async function deleteExpenseByKeyword(keyword, userId) {
  const { data } = await supabaseAdmin
    .from('expenses')
    .select('id, description, amount, category, installment_group, installments')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!data || !data.length) return 'Nenhum gasto encontrado para remover.';

  let target = null;

  if (keyword) {
    // Tenta encontrar pelo keyword (busca parcial, case insensitive)
    target = data.find(e =>
      e.description.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  // Se não achou pelo keyword ou não veio keyword, pega o mais recente
  if (!target) target = data[0];

  // Se for parcelado, remove todas as parcelas do grupo
  if (target.installment_group) {
    const { error } = await supabaseAdmin
      .from('expenses')
      .delete()
      .eq('installment_group', target.installment_group);

    if (error) return '❌ Erro ao remover parcelas.';

    // Conta quantas foram
    const count = data.filter(e => e.installment_group === target.installment_group).length;
    const baseName = target.description.replace(/\s*\(\d+\/\d+\)$/, '');
    return `🗑️ Parcelamento *${baseName}* removido (${target.installments} parcelas excluídas).`;
  }

  // Gasto simples
  const { error } = await supabaseAdmin.from('expenses').delete().eq('id', target.id);
  if (error) return '❌ Erro ao remover gasto.';
  return `🗑️ Gasto removido: *${target.description}* — R$${parseFloat(target.amount).toFixed(2)}`;
}

// ============================================
// SUPABASE: consultas
// ============================================
async function getWeeklyExpenses(userId) {
  const from = new Date(); from.setDate(from.getDate() - 7);
  const { data } = await supabaseAdmin.from('expenses').select('description, amount, category, created_at')
    .eq('user_id', userId).gte('created_at', from.toISOString()).order('created_at', { ascending: false });
  if (!data || !data.length) return 'Nenhum gasto registrado essa semana.';
  const total = data.reduce((s, e) => s + parseFloat(e.amount), 0);
  const bycat = data.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + parseFloat(e.amount); return acc; }, {});
  const cats  = Object.entries(bycat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `  • ${c}: R$${v.toFixed(2)}`).join('\n');
  return `📊 *Gastos esta semana:*\nTotal: R$${total.toFixed(2)}\n\n${cats}`;
}

async function getMonthlyExpenses(userId) {
  const first = new Date(); first.setDate(1); first.setHours(0, 0, 0, 0);
  const { data } = await supabaseAdmin.from('expenses').select('amount')
    .eq('user_id', userId).gte('created_at', first.toISOString());
  if (!data || !data.length) return 'Nenhum gasto este mês ainda.';
  const total = data.reduce((s, e) => s + parseFloat(e.amount), 0);
  return `💰 Total do mês: *R$${total.toFixed(2)}* (${data.length} transações)`;
}

async function getTodayExpenses(userId) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabaseAdmin.from('expenses').select('description, amount, category')
    .eq('user_id', userId).gte('created_at', today + 'T00:00:00').order('created_at', { ascending: false });
  if (!data || !data.length) return 'Nenhum gasto registrado hoje ainda.';
  const total = data.reduce((s, e) => s + parseFloat(e.amount), 0);
  const list  = data.map(e => `  • ${e.description}: R$${parseFloat(e.amount).toFixed(2)}`).join('\n');
  return `🌅 *Gastos de hoje:*\nTotal: R$${total.toFixed(2)}\n\n${list}`;
}

async function getTodayHabits(userId) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabaseAdmin.from('habit_logs').select('habits(name, emoji)')
    .eq('user_id', userId).eq('done_at', today);
  if (!data || !data.length) return 'Nenhum hábito registrado hoje ainda. 💪';
  return `🌟 *Hábitos de hoje:*\n${data.map(l => `  ✅ ${l.habits.emoji} ${l.habits.name}`).join('\n')}`;
}

async function getGoals(userId) {
  const { data } = await supabaseAdmin.from('goals').select('*').eq('user_id', userId);
  if (!data || !data.length) return 'Nenhuma meta cadastrada.';
  const list = data.map(g => {
    const pct = Math.round((g.current / g.target) * 100);
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    return `🎯 *${g.name}*\n  ${bar} ${pct}%\n  R$${g.current} / R$${g.target}`;
  }).join('\n\n');
  return `📈 *Suas metas:*\n\n${list}`;
}

// ============================================
// RESET: apaga todos os dados do usuário
// ============================================
async function resetAllData(userId) {
  const errors = [];

  // Ordem importa: logs antes de habits (FK)
  const deletes = [
    supabaseAdmin.from('habit_logs').delete().eq('user_id', userId),
    supabaseAdmin.from('expenses').delete().eq('user_id', userId),
    supabaseAdmin.from('tasks').delete().eq('user_id', userId),
    supabaseAdmin.from('goals').delete().eq('user_id', userId),
    supabaseAdmin.from('habits').delete().eq('user_id', userId),
  ];

  for (const op of deletes) {
    const { error } = await op;
    if (error) errors.push(error.message);
  }

  if (errors.length > 0) {
    console.error('⚠️ Erros no reset:', errors);
    return false;
  }

  console.log(`🗑️ [RESET] Dados do usuário ${userId} apagados com sucesso.`);
  return true;
}

// ============================================
// TELEGRAM: enviar mensagem
// ============================================
async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

// ============================================
// ROTA PRINCIPAL: webhook do Telegram
// ============================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const message = req.body?.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text   = message.text;
  console.log(`📨 [${chatId}] ${text}`);

  // ── FLUXO DE VINCULAÇÃO ──────────────────────────────
  if (text === '/start' || text === '/vincular') {
    pendingLink.set(chatId, { step: 'awaiting_email', ts: Date.now() });
    return sendTelegram(chatId,
      `👋 *Bem-vindo ao NexoraFlow Bot!*\n\n` +
      `Para vincular sua conta, envie o *email* que você usou para se cadastrar no site:`
    );
  }

  if (text === '/desvincular') {
    await supabaseAdmin.from('user_profiles').update({ telegram_chat_id: null }).eq('telegram_chat_id', chatId);
    return sendTelegram(chatId, '✅ Conta desvinculada com sucesso.');
  }

  // Fluxo aguardando email
  if (pendingLink.has(chatId)) {
    const state = pendingLink.get(chatId);
    if (Date.now() - state.ts > 300_000) {
      pendingLink.delete(chatId);
      return sendTelegram(chatId, '⏱️ Tempo expirado. Envie /start para tentar novamente.');
    }
    if (state.step === 'awaiting_email') {
      pendingLink.delete(chatId);
      const linked = await linkTelegramByEmail(chatId, text.trim());
      if (!linked) {
        return sendTelegram(chatId,
          `❌ Email não encontrado. Verifique se:\n` +
          `  • O email está correto\n` +
          `  • Você já criou sua conta no site\n\n` +
          `Tente novamente com /start`
        );
      }
      return sendTelegram(chatId,
        `✅ *Conta vinculada com sucesso!*\n` +
        `Olá, *${linked.username}*! 🎉\n\n` +
        `Agora você pode registrar:\n` +
        `💸 "gastei 45 no almoço"\n` +
        `💳 "paguei 300 em 3x no tênis"\n` +
        `✅ "fiz academia hoje"\n` +
        `📋 "preciso comprar remédio"\n` +
        `🗑️ "remover último gasto"\n` +
        `📊 "quanto gastei essa semana?"\n` +
        `🎯 "minhas metas"\n\n` +
        `Atalhos: /gastos /habitos /metas /ranking /amigos /meucodigo /perfil`
      );
    }
  }

  // Fluxo aguardando limite da meta de gastos
  if (pendingGoal.has(chatId)) {
    const state = pendingGoal.get(chatId);
    if (Date.now() - state.ts > 120_000) {
      pendingGoal.delete(chatId);
    } else {
      pendingGoal.delete(chatId);
      const limit = parseFloat(text.replace(',', '.').replace(/[^0-9.]/g, ''));
      if (isNaN(limit) || limit <= 0) {
        return sendTelegram(chatId, '❌ Valor inválido. Tente novamente com /start.');
      }
      const userForGoal = await getUserByChat(chatId);
      if (userForGoal) {
        const ok = await createSpendingGoal(state.category, limit, userForGoal.id);
        return sendTelegram(chatId, ok
          ? `🎯 Meta *Limite ${state.category}* de R$${limit.toFixed(2)}/mês criada!`
          : '❌ Erro ao criar meta.');
      }
    }
  }

  // ── VERIFICAR SE ESTÁ VINCULADO ──────────────────────
  const user = await getUserByChat(chatId);
  if (!user) {
    return sendTelegram(chatId,
      `⚠️ Sua conta ainda não está vinculada.\n\n` +
      `Envie /start e depois seu email cadastrado no NexoraFlow.`
    );
  }
  const userId = user.id;

  // ============================================
  // COMANDO SECRETO DE RESET
  // Fluxo: /reset → pede senha → confirma → apaga tudo
  // ============================================

  // Etapa 1: usuário digitou /reset
  if (text === '/reset') {
    pendingReset.set(chatId, { step: 'awaiting_password', ts: Date.now() });
    return sendTelegram(chatId,
      `⚠️ *Comando de Reset*\n\n` +
      `Isso irá apagar *permanentemente* todos os dados:\n` +
      `  • Gastos e parcelamentos\n` +
      `  • Hábitos e registros\n` +
      `  • Tarefas\n` +
      `  • Metas\n\n` +
      `Digite a senha para continuar:`
    );
  }

  // Etapa 2: usuário está em fluxo de reset — verifica senha
  if (pendingReset.has(chatId)) {
    const state = pendingReset.get(chatId);

    // Expira após 2 minutos de inatividade
    if (Date.now() - state.ts > 120_000) {
      pendingReset.delete(chatId);
      return sendTelegram(chatId, '⏱️ Tempo expirado. Digite /reset para tentar novamente.');
    }

    if (state.step === 'awaiting_password') {
      if (text !== RESET_PASSWORD) {
        pendingReset.delete(chatId);
        console.log(`🔐 [RESET] Senha incorreta para chatId ${chatId}`);
        return sendTelegram(chatId, '❌ Senha incorreta. Operação cancelada.');
      }

      // Senha correta — pede confirmação final
      pendingReset.set(chatId, { step: 'awaiting_confirm', ts: Date.now() });
      return sendTelegram(chatId,
        `✅ Senha correta.\n\n` +
        `⚠️ *Confirmação final*\n` +
        `Digite *CONFIRMAR* (em maiúsculas) para apagar tudo\n` +
        `ou qualquer outra coisa para cancelar:`
      );
    }

    if (state.step === 'awaiting_confirm') {
      pendingReset.delete(chatId);

      if (text !== 'CONFIRMAR') {
        return sendTelegram(chatId, '✅ Reset cancelado. Seus dados estão seguros.');
      }

      // Executa o reset
      console.log(`🗑️ [RESET] Iniciado por chatId ${chatId}`);
      await sendTelegram(chatId, '⏳ Apagando todos os dados...');

      const ok = await resetAllData(userId);

      if (ok) {
        return sendTelegram(chatId,
          `✅ *Reset concluído!*\n\n` +
          `Todos os dados foram apagados:\n` +
          `  🗑️ Gastos removidos\n` +
          `  🗑️ Hábitos removidos\n` +
          `  🗑️ Tarefas removidas\n` +
          `  🗑️ Metas removidas\n\n` +
          `O dashboard está zerado. Bom recomeço! 🚀`
        );
      } else {
        return sendTelegram(chatId, '❌ Ocorreu um erro durante o reset. Verifique os logs do servidor.');
      }
    }
  }

  // ── COMANDOS DE GAMIFICAÇÃO ──────────────────────────
  if (text === '/ranking') {
    const { top, userPos } = await getWeeklyRanking(supabaseAdmin, userId);
    if (!top.length) return sendTelegram(chatId, '📊 Nenhum XP registrado essa semana ainda.');
    const lines = top.map(r =>
      `${r.pos === 1 ? '🥇' : r.pos === 2 ? '🥈' : r.pos === 3 ? '🥉' : `${r.pos}.`} ${r.isMe ? '*' : ''}${r.avatar} ${r.username}${r.isMe ? '*' : ''} — ${r.xp} XP`
    ).join('\n');
    const posText = userPos ? `` : `\nVocê não está no top 10 desta semana.`;
    return sendTelegram(chatId, `🏆 *Ranking Semanal*\n\n${lines}${posText}`);
  }

  if (text === '/amigos') {
    const friends = await getFriends(supabaseAdmin, userId);
    if (!friends.length) {
      const code = await ensureReferralCode(supabaseAdmin, userId);
      return sendTelegram(chatId, `👥 Você ainda não tem amigos.\n\nCompartilhe seu código:\n🔑 *${code}*\n\nSeu amigo usa: /adicionar ${code}`);
    }
    const ranking = await getFriendRanking(supabaseAdmin, userId);
    const lines = ranking.map(r =>
      `${r.pos}. ${r.isMe ? '*' : ''}${r.avatar} ${r.username}${r.isMe ? '*' : ''} — Nível ${r.level} · ${r.xp} XP/semana`
    ).join('\n');
    return sendTelegram(chatId, `👥 *Seus Amigos*\n\n${lines}`);
  }

  if (text === '/meucodigo') {
    const code = await ensureReferralCode(supabaseAdmin, userId);
    return sendTelegram(chatId,
      `🔑 *Seu código de convite:* \`${code}\`\n\n` +
      `Compartilhe com amigos para competir no ranking semanal!\n` +
      `Eles usam: /adicionar ${code}`
    );
  }

  if (text.startsWith('/adicionar ')) {
    const code = text.replace('/adicionar ', '').trim();
    const result = await addFriend(supabaseAdmin, userId, code);
    return sendTelegram(chatId, result.ok
      ? `✅ *${result.username}* adicionado como amigo! Agora vocês competem no ranking.`
      : `❌ ${result.reason}`
    );
  }

  if (text === '/perfil') {
    const { data: p } = await supabaseAdmin.from('user_profiles')
      .select('username, avatar_emoji, xp, level, streak, referral_code')
      .eq('id', userId).single();
    if (!p) return sendTelegram(chatId, '❌ Perfil não encontrado.');
    const code = p.referral_code || await ensureReferralCode(supabaseAdmin, userId);
    return sendTelegram(chatId,
      `${p.avatar_emoji} *${p.username}*\n` +
      `🏅 Nível ${p.level} · ⭐ ${p.xp} XP total\n` +
      `🔥 Sequência: ${p.streak || 0} dias\n` +
      `🔑 Código: \`${code}\`\n\n` +
      `Use /ranking para ver sua posição`
    );
  }

  // ⚡ Sistema híbrido: Regex primeiro, IA como fallback
  const interpreted = await interpretMessage(text);
  const tag = interpreted._source === 'regex' ? '⚡ [REGEX]' : '🤖 [AI]';
  console.log(`${tag} Resultado:`, JSON.stringify(interpreted));

  let reply = interpreted.reply || 'Mensagem processada!';

  switch (interpreted.type) {
    case 'income':
      await saveIncome(interpreted.data, userId);
      break;

    case 'spending_goal': {
      const { category, limit } = interpreted.data;
      const cat = category || 'Geral';
      if (limit) {
        const ok = await createSpendingGoal(cat, limit, userId);
        reply = ok
          ? `🎯 Meta *Limite ${cat}* de R$${parseFloat(limit).toFixed(2)}/mês criada!`
          : '❌ Erro ao criar meta.';
      } else {
        pendingGoal.set(chatId, { category: cat, ts: Date.now() });
        reply = `🎯 Qual o limite mensal que você quer para *${cat}*? (envie o valor em R$)`;
      }
      break;
    }

    case 'expense':
      await saveExpense(interpreted.data, userId);
      await notifyAchievements(chatId, userId);
      break;

    case 'delete_expense':
      reply = await deleteExpenseByKeyword(interpreted.data?.keyword, userId);
      break;

    case 'create_habit': {
      const h = await createHabit(interpreted.data.name, interpreted.data.emoji, userId);
      reply = h ? `✅ Hábito *${interpreted.data.name}* criado! Marque quando completar.`
                : `⚠️ Hábito *${interpreted.data.name}* já existe.`;
      if (h) await notifyAchievements(chatId, userId);
      break;
    }

    case 'habit':
      await saveHabitLog(interpreted.data.name, userId);
      await notifyAchievements(chatId, userId);
      break;

    case 'task':
      await saveTask(interpreted.data, userId);
      await notifyAchievements(chatId, userId);
      break;

    case 'query': {
      const q = interpreted.data.question;
      if      (q === 'gastos' || q === 'resumo')   reply = await getWeeklyExpenses(userId);
      else if (q === 'mes'    || q === 'mês')       reply = await getMonthlyExpenses(userId);
      else if (q === 'hoje')                        reply = await getTodayExpenses(userId);
      else if (q === 'habitos' || q === 'hábitos')  reply = await getTodayHabits(userId);
      else if (q === 'metas')                       reply = await getGoals(userId);
      else                                          reply = await getWeeklyExpenses(userId);
      break;
    }
    default:
      reply = '🤔 Não entendi. Tente: "gastei 50 no mercado" ou "fiz academia hoje".';
  }

  await sendTelegram(chatId, reply);
});

// ============================================
// API — UPLOAD DE AVATAR (usa service_role para bypassar RLS do Storage)
// ============================================
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

app.post('/api/avatar', upload.single('file'), async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  if (!req.file) return res.status(400).json({ error: 'No file' });

  const ext = req.file.originalname.split('.').pop().toLowerCase();
  const filePath = `${user.id}/avatar.${ext}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from('avatars')
    .upload(filePath, req.file.buffer, { upsert: true, contentType: req.file.mimetype });

  if (upErr) return res.status(500).json({ error: upErr.message });

  const { data: { publicUrl } } = supabaseAdmin.storage.from('avatars').getPublicUrl(filePath);

  res.json({ url: publicUrl + '?t=' + Date.now() });
});

// ============================================
// API — EVENTOS: submeter prova por etapa
// ============================================
app.post('/api/event/submit', upload.single('file'), async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { eventId, step } = req.body;
  if (!eventId || !step || !req.file) return res.status(400).json({ error: 'Dados incompletos' });

  // Verifica se evento existe e está ativo
  const { data: event } = await supabaseAdmin.from('events').select('*').eq('id', eventId).eq('active', true).single();
  if (!event) return res.status(404).json({ error: 'Evento não encontrado' });

  // Upload da foto
  const ext = req.file.originalname.split('.').pop().toLowerCase();
  const filePath = `events/${eventId}/${user.id}_step${step}.${ext}`;
  const { error: upErr } = await supabaseAdmin.storage
    .from('avatars').upload(filePath, req.file.buffer, { upsert: true, contentType: req.file.mimetype });
  if (upErr) return res.status(500).json({ error: upErr.message });

  const { data: { publicUrl } } = supabaseAdmin.storage.from('avatars').getPublicUrl(filePath);

  // Salva submissão
  const { error: subErr } = await supabaseAdmin.from('event_submissions').upsert({
    event_id: eventId, user_id: user.id, step: parseInt(step),
    photo_url: publicUrl + '?t=' + Date.now(), status: 'pending',
  }, { onConflict: 'event_id,user_id,step' });

  if (subErr) return res.status(500).json({ error: subErr.message });

  // Cancela verificações anteriores desse step (reenvio após rejeição)
  const stepLabel = step == 1 ? 'Garrafinha CHEIA' : 'Garrafinha VAZIA';
  await supabaseAdmin.from('verifications')
    .update({ status: 'done' })
    .eq('user_id', user.id).eq('type', 'event').eq('ref_id', eventId)
    .ilike('ref_name', `%${stepLabel}%`);

  // Cria nova verificação para amigos aprovarem
  const verificationId = require('crypto').randomUUID();
  await supabaseAdmin.from('verifications').insert({
    id: verificationId,
    user_id: user.id,
    type: 'event',
    ref_id: eventId,
    ref_name: `${event.title} — ${stepLabel}`,
    photo_url: publicUrl + '?t=' + Date.now(),
    xp_amount: Math.round(event.xp_reward / 2),
    status: 'pending',
  });

  res.json({ ok: true, verificationId });
});

// API — EVENTOS: aprovar/rejeitar submissão (após votação)
app.post('/api/event/finalize', express.json(), async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { verificationId, verdict } = req.body; // verdict: 'approved' | 'rejected'
  const { data: verif } = await supabaseAdmin.from('verifications').select('*').eq('id', verificationId).single();
  if (!verif) return res.status(404).json({ error: 'Não encontrado' });

  await supabaseAdmin.from('verifications').update({ status: verdict }).eq('id', verificationId);

  // Determina qual step esta verificação pertence (CHEIA=1, VAZIA=2)
  const step = verif.ref_name && verif.ref_name.includes('CHEIA') ? 1 : 2;

  if (verdict === 'approved') {
    // Atualiza apenas o step correto
    await supabaseAdmin.from('event_submissions')
      .update({ status: 'approved' })
      .eq('event_id', verif.ref_id).eq('user_id', verif.user_id).eq('step', step);

    // Verifica se ambas etapas foram aprovadas
    const { data: subs } = await supabaseAdmin.from('event_submissions')
      .select('step,status').eq('event_id', verif.ref_id).eq('user_id', verif.user_id);
    const allDone = subs && subs.length >= 2 && subs.every(s => s.status === 'approved');

    if (allDone) {
      const { data: event } = await supabaseAdmin.from('events').select('xp_reward').eq('id', verif.ref_id).single();
      if (event) {
        await addXP(supabaseAdmin, verif.user_id, event.xp_reward, `Evento: ${verif.ref_name}`);
        await addWeeklyXP(supabaseAdmin, verif.user_id, event.xp_reward);
      }
    } else {
      // XP parcial por etapa aprovada
      await addXP(supabaseAdmin, verif.user_id, verif.xp_amount, verif.ref_name);
      await addWeeklyXP(supabaseAdmin, verif.user_id, verif.xp_amount);
    }
  } else {
    // Rejeitado: marca submission como rejected para o usuário poder reenviar
    await supabaseAdmin.from('event_submissions')
      .update({ status: 'rejected' })
      .eq('event_id', verif.ref_id).eq('user_id', verif.user_id).eq('step', step);
  }

  res.json({ ok: true });
});

// ============================================
// API — AMIGOS (requer service_role para insert bidirecional)
// ============================================

// Aceitar solicitação de amizade
app.post('/api/friend/accept', express.json(), async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { requestId } = req.body;
  const { data: request } = await supabaseAdmin
    .from('friend_requests').select('*').eq('id', requestId).single();

  if (!request || request.to_id !== user.id || request.status !== 'pending')
    return res.status(400).json({ error: 'Solicitação inválida.' });

  // Insere amizade bidirecional com service_role
  await supabaseAdmin.from('friends').insert([
    { user_id: request.from_id, friend_id: request.to_id },
    { user_id: request.to_id,   friend_id: request.from_id },
  ]);
  await supabaseAdmin.from('friend_requests').update({ status: 'accepted' }).eq('id', requestId);

  res.json({ ok: true });
});

// Rejeitar solicitação
app.post('/api/friend/reject', express.json(), async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { requestId } = req.body;
  await supabaseAdmin.from('friend_requests')
    .update({ status: 'rejected' })
    .eq('id', requestId)
    .eq('to_id', user.id);

  res.json({ ok: true });
});

// ============================================
// SERVIR O FRONTEND (index.html na raiz do projeto)
// ============================================
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota de health check (útil para testar se o servidor está de pé)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'NexoraFlow Bot', timestamp: new Date().toISOString() });
});

// ============================================
// INICIALIZAÇÃO
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n🚀 NexoraFlow rodando em http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔧 Health:    http://localhost:${PORT}/health\n`);
  if (WEBHOOK_URL) {
    await registerWebhook();
  } else {
    console.log('⚠️  WEBHOOK_URL não definido — bot Telegram inativo.');
    console.log('   Use ngrok para expor o servidor e defina WEBHOOK_URL no .env\n');
  }
});
