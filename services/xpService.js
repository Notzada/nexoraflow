// ============================================
// XP SERVICE — Gamificação NexoraFlow
// ============================================

// Calcula o nível a partir do XP total
// Level N requer N*100 XP cumulativo
function calcLevel(totalXp) {
  let level = 1;
  let accumulated = 0;
  while (accumulated + level * 100 <= totalXp) {
    accumulated += level * 100;
    level++;
  }
  return { level, xpIntoLevel: totalXp - accumulated, xpNeeded: level * 100 };
}

// Adiciona XP ao usuário, recalcula nível, retorna resultado
async function addXP(db, userId, amount, reason) {
  const { data: profile } = await db
    .from('user_profiles')
    .select('xp, level')
    .eq('id', userId)
    .single();

  if (!profile) return null;

  const oldLevel  = profile.level;
  const newXp     = (profile.xp || 0) + amount;
  const { level } = calcLevel(newXp);

  await db.from('user_profiles').update({ xp: newXp, level }).eq('id', userId);
  await db.from('xp_logs').insert({ user_id: userId, amount, reason });

  return { xpGained: amount, totalXp: newXp, level, levelUp: level > oldLevel };
}

// Atualiza streak do usuário e retorna bônus de XP (se houver)
async function updateStreak(db, userId) {
  const { data: profile } = await db
    .from('user_profiles')
    .select('streak, last_activity_date')
    .eq('id', userId)
    .single();

  if (!profile) return { streak: 0, bonus: 0 };

  const today     = new Date().toISOString().split('T')[0];
  const last      = profile.last_activity_date;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];

  let streak = profile.streak || 0;

  if (last === today) {
    // Já registrou hoje — sem alteração
    return { streak, bonus: 0 };
  } else if (last === yesterday) {
    // Dia seguinte — incrementa streak
    streak += 1;
  } else {
    // Pulou um dia — reseta
    streak = 1;
  }

  await db.from('user_profiles')
    .update({ streak, last_activity_date: today })
    .eq('id', userId);

  // Bônus de milestone
  let bonus = 0;
  let bonusReason = null;
  if      (streak === 3)  { bonus = 15;  bonusReason = '3 dias seguidos'; }
  else if (streak === 7)  { bonus = 40;  bonusReason = '7 dias seguidos'; }
  else if (streak === 30) { bonus = 150; bonusReason = '30 dias seguidos'; }

  return { streak, bonus, bonusReason };
}

module.exports = { addXP, updateStreak, calcLevel };
