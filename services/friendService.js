// ============================================
// FRIEND SERVICE — Amigos e Código de Referência
// ============================================

// Garante que o usuário tem um referral_code
async function ensureReferralCode(db, userId) {
  const { data } = await db
    .from('user_profiles')
    .select('referral_code')
    .eq('id', userId)
    .single();

  if (data?.referral_code) return data.referral_code;

  // Gera código único de 6 chars
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  await db.from('user_profiles').update({ referral_code: code }).eq('id', userId);
  return code;
}

// Adiciona amigo pelo referral_code
async function addFriend(db, userId, code) {
  const { data: friend } = await db
    .from('user_profiles')
    .select('id, username')
    .eq('referral_code', code.toUpperCase().trim())
    .single();

  if (!friend) return { ok: false, reason: 'Código não encontrado.' };
  if (friend.id === userId) return { ok: false, reason: 'Você não pode se adicionar.' };

  // Verifica se já são amigos
  const { data: existing } = await db
    .from('friends')
    .select('id')
    .eq('user_id', userId)
    .eq('friend_id', friend.id)
    .single();

  if (existing) return { ok: false, reason: `Você já é amigo de *${friend.username}*.` };

  // Amizade é bidirecional
  await db.from('friends').insert([
    { user_id: userId,    friend_id: friend.id },
    { user_id: friend.id, friend_id: userId    },
  ]);

  return { ok: true, username: friend.username };
}

// Lista amigos do usuário
async function getFriends(db, userId) {
  const { data } = await db
    .from('friends')
    .select('friend_id, user_profiles!friends_friend_id_fkey(username, avatar_emoji, xp, level)')
    .eq('user_id', userId);

  return (data || []).map(f => ({
    id:      f.friend_id,
    username: f.user_profiles?.username || '—',
    avatar:   f.user_profiles?.avatar_emoji || '🧑',
    xp:       f.user_profiles?.xp || 0,
    level:    f.user_profiles?.level || 1,
  }));
}

module.exports = { ensureReferralCode, addFriend, getFriends };
