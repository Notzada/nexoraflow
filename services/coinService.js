// ============================================
// COIN SERVICE — Moeda interna NexoraFlow
// ============================================

const SHOP_ITEMS = [
  { id: 'tag_economista',  name: 'Economista',         emoji: '💰', desc: 'Mestre das finanças pessoais',  cost: 100,  rarity: 'comum',    type: 'tag'   },
  { id: 'tag_fantasma',    name: 'Fantasma',            emoji: '👻', desc: 'Ninguém te vê vir',             cost: 150,  rarity: 'comum',    type: 'tag'   },
  { id: 'tag_maratonista', name: 'Maratonista',         emoji: '🏃', desc: 'Nunca para, nunca desiste',     cost: 200,  rarity: 'raro',     type: 'tag'   },
  { id: 'tag_mestre',      name: 'Mestre dos Hábitos',  emoji: '🧘', desc: 'Disciplina acima de tudo',      cost: 350,  rarity: 'raro',     type: 'tag'   },
  { id: 'tag_campeao',     name: 'Campeão',             emoji: '🏆', desc: 'Chegou ao topo do ranking',     cost: 500,  rarity: 'épico',    type: 'tag'   },
  { id: 'tag_lendario',    name: 'Lendário',            emoji: '👑', desc: 'Acima de todos',                cost: 1000, rarity: 'lendário', type: 'tag'   },
  { id: 'theme_sakura',    name: 'Sakura',              emoji: '🌸', desc: 'Rosa e branco como as flores de cerejeira do Japão', cost: 50,  rarity: 'raro', type: 'theme', limited: true },
  { id: 'theme_namorados', name: 'Dia dos Namorados',   emoji: '💘', desc: 'Vermelho e dourado para celebrar o amor — 12 de junho', cost: 0, rarity: 'épico', type: 'theme', limited: true, ownerOnly: 'pintodiego52@gmail.com' },
];

const RARITY_COLORS = {
  'comum':    { bg: 'rgba(90,106,138,0.15)',  text: '#5a6a8a', border: 'rgba(90,106,138,0.3)'  },
  'raro':     { bg: 'rgba(79,195,247,0.12)',  text: '#4fc3f7', border: 'rgba(79,195,247,0.3)'  },
  'épico':    { bg: 'rgba(168,85,247,0.15)',  text: '#a855f7', border: 'rgba(168,85,247,0.35)' },
  'lendário': { bg: 'rgba(245,166,35,0.15)',  text: '#f5a623', border: 'rgba(245,166,35,0.4)'  },
};

// Adiciona coins ao usuário e registra no log
async function addCoins(db, userId, amount, reason) {
  const { data: profile } = await db
    .from('user_profiles')
    .select('coins')
    .eq('id', userId)
    .single();
  if (!profile) return null;
  const newCoins = (profile.coins || 0) + amount;
  await db.from('user_profiles').update({ coins: newCoins }).eq('id', userId);
  await db.from('coin_logs').insert({ user_id: userId, amount, reason });
  return newCoins;
}

// Remove coins do usuário (verifica saldo antes)
async function spendCoins(db, userId, amount, reason) {
  const { data: profile } = await db
    .from('user_profiles')
    .select('coins')
    .eq('id', userId)
    .single();
  if (!profile) return { ok: false, error: 'Perfil não encontrado.' };
  if ((profile.coins || 0) < amount) return { ok: false, error: 'Coins insuficientes.' };
  const newCoins = (profile.coins || 0) - amount;
  await db.from('user_profiles').update({ coins: newCoins }).eq('id', userId);
  await db.from('coin_logs').insert({ user_id: userId, amount: -amount, reason });
  return { ok: true, newCoins };
}

// Retorna quantos dias consecutivos um hábito específico foi feito até hoje
async function getHabitStreak(db, habitId, userId) {
  const { data: logs } = await db
    .from('habit_logs')
    .select('done_at')
    .eq('habit_id', habitId)
    .eq('user_id', userId)
    .order('done_at', { ascending: false })
    .limit(40);

  if (!logs || logs.length === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let streak = 0;
  const check = new Date(today);

  for (const log of logs) {
    const logDate = new Date(log.done_at + 'T00:00:00');
    logDate.setHours(0, 0, 0, 0);
    const diff = Math.round((check - logDate) / 86400000);
    if (diff === 0) { streak++; check.setDate(check.getDate() - 1); }
    else break;
  }
  return streak;
}

module.exports = { addCoins, spendCoins, getHabitStreak, SHOP_ITEMS, RARITY_COLORS };
