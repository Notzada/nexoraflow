// ============================================
// RANKING SERVICE — Semanal + Amigos
// ============================================

function getWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay()); // domingo
  return d.toISOString().split('T')[0];
}

async function addWeeklyXP(db, userId, amount) {
  const week_start = getWeekStart();
  const { data: existing } = await db
    .from('weekly_xp')
    .select('id, xp')
    .eq('user_id', userId)
    .eq('week_start', week_start)
    .single();

  if (existing) {
    await db.from('weekly_xp')
      .update({ xp: existing.xp + amount })
      .eq('id', existing.id);
  } else {
    await db.from('weekly_xp')
      .insert({ user_id: userId, xp: amount, week_start });
  }
}

// Retorna top 10 global + posição do usuário
async function getWeeklyRanking(db, userId) {
  const week_start = getWeekStart();

  const { data: rows } = await db
    .from('weekly_xp')
    .select('user_id, xp, user_profiles(username, avatar_emoji)')
    .eq('week_start', week_start)
    .order('xp', { ascending: false })
    .limit(10);

  if (!rows || !rows.length) return { top: [], userPos: null };

  const top = rows.map((r, i) => ({
    pos: i + 1,
    username: r.user_profiles?.username || '—',
    avatar:   r.user_profiles?.avatar_emoji || '🧑',
    xp:       r.xp,
    isMe:     r.user_id === userId,
  }));

  const userPos = top.find(r => r.isMe) || null;
  return { top, userPos };
}

// Retorna ranking apenas entre amigos do usuário
async function getFriendRanking(db, userId) {
  const week_start = getWeekStart();

  const { data: friendRows } = await db
    .from('friends')
    .select('friend_id')
    .eq('user_id', userId);

  const friendIds = (friendRows || []).map(f => f.friend_id);
  friendIds.push(userId); // inclui o próprio usuário

  const { data: rows } = await db
    .from('weekly_xp')
    .select('user_id, xp, user_profiles(username, avatar_emoji)')
    .eq('week_start', week_start)
    .in('user_id', friendIds)
    .order('xp', { ascending: false });

  if (!rows || !rows.length) return [];

  return rows.map((r, i) => ({
    pos: i + 1,
    username: r.user_profiles?.username || '—',
    avatar:   r.user_profiles?.avatar_emoji || '🧑',
    xp:       r.xp,
    isMe:     r.user_id === userId,
  }));
}

module.exports = { addWeeklyXP, getWeeklyRanking, getFriendRanking, getWeekStart };
