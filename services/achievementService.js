// ============================================
// ACHIEVEMENT SERVICE — Conquistas NexoraFlow
// ============================================

const ACHIEVEMENTS = [
  // 🚀 Início
  { id: 'first_action',   name: 'Primeiro Passo',          desc: 'Registrou primeira ação no sistema',     xp: 10,  coins: 5,   category: 'inicio'       },
  { id: 'telegram_link',  name: 'Bem-vindo ao Jogo',       desc: 'Vinculou o Telegram ao NexoraFlow',     xp: 5,   coins: 5,   category: 'inicio'       },

  // 💪 Consistência
  { id: 'streak_3',       name: '3 Dias Seguidos',         desc: 'Manteve streak de 3 dias',              xp: 15,  coins: 10,  category: 'consistencia' },
  { id: 'streak_7',       name: 'Semana Perfeita',         desc: 'Manteve streak de 7 dias',              xp: 40,  coins: 30,  category: 'consistencia' },
  { id: 'streak_30',      name: 'Mestre da Consistência',  desc: 'Manteve streak de 30 dias',             xp: 150, coins: 100, category: 'consistencia' },

  // 📊 Uso do sistema
  { id: 'tasks_10',       name: 'Organizado',              desc: '10 tarefas criadas',                    xp: 20,  coins: 10,  category: 'uso'          },
  { id: 'tasks_done_50',  name: 'Executor',                desc: '50 tarefas concluídas',                 xp: 50,  coins: 25,  category: 'uso'          },
  { id: 'expenses_100',   name: 'Controlado',              desc: '100 gastos registrados',                xp: 30,  coins: 20,  category: 'uso'          },

  // 🎯 Metas
  { id: 'first_goal',     name: 'Primeira Meta',           desc: 'Criou sua primeira meta de gasto',      xp: 20,  coins: 10,  category: 'metas'        },
  { id: 'goal_completed', name: 'Meta Concluída',          desc: 'Atingiu 100% de uma meta',              xp: 100, coins: 50,  category: 'metas'        },

  // 🏆 Competição
  { id: 'ranking_1st',    name: 'Primeiro Lugar',          desc: 'Ficou #1 no ranking semanal',           xp: 100, coins: 75,  category: 'competicao'   },
  { id: 'ranking_up',     name: 'Subiu no Ranking',        desc: 'Entrou no top 10 semanal',              xp: 30,  coins: 20,  category: 'competicao'   },
  { id: 'ranking_top3',   name: 'Top 3 Semanal',           desc: 'Ficou top 3 no ranking semanal',        xp: 50,  coins: 40,  category: 'competicao'   },

  // 🎮 Engajamento
  { id: 'active_7',       name: 'Viciado',                 desc: '7 dias seguidos usando o app',          xp: 30,  coins: 20,  category: 'engajamento'  },
  { id: 'active_30',      name: 'Imparável',               desc: '30 dias ativo no NexoraFlow',           xp: 120, coins: 80,  category: 'engajamento'  },

  // 🧠 Avançado
  { id: 'balanced_day',   name: 'Equilibrado',             desc: 'Gasto + hábito + tarefa no mesmo dia',  xp: 25,  coins: 15,  category: 'avancado'     },
  { id: 'multitasker',    name: 'Multitasker',             desc: 'Usou todas as features em 1 semana',    xp: 50,  coins: 30,  category: 'avancado'     },
  { id: 'nexora_legend',  name: 'Lenda Nexora',            desc: 'Nível 5+ com 10+ conquistas',           xp: 300, coins: 200, category: 'avancado'     },
];

function getWeekStart() {
  const now = new Date();
  const day = now.getDay(); // 0=dom
  const diff = now.getDate() - day;
  const d = new Date(now);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

// Verifica e concede conquistas não desbloqueadas. Retorna lista das novas.
async function checkAndGrantAchievements(db, userId, addXPFn, addCoinsFn) {
  // Conquistas já desbloqueadas
  const { data: alreadyUnlocked } = await db
    .from('user_achievements')
    .select('achievement_id')
    .eq('user_id', userId);

  const unlockedIds = new Set((alreadyUnlocked || []).map(u => u.achievement_id));
  const unlockedCount = unlockedIds.size;

  // Se já tem todas, sai rápido
  if (unlockedCount >= ACHIEVEMENTS.length) return [];

  // Perfil
  const { data: profile } = await db
    .from('user_profiles')
    .select('xp, level, streak, telegram_chat_id')
    .eq('id', userId)
    .single();

  if (!profile) return [];

  const today = new Date().toISOString().split('T')[0];
  const weekStart = getWeekStart();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Buscas paralelas
  const [
    { count: totalExpenses },
    { count: totalTasks },
    { count: doneTasks },
    { count: totalGoals },
    { data: allGoals },
    { data: todayExpenses },
    { data: todayHabits },
    { data: todayDoneTasks },
    { count: recentExpenses },
    { count: recentHabits },
    { count: recentTasks },
    { data: weeklyRanking },
  ] = await Promise.all([
    db.from('expenses').select('id', { count: 'exact', head: true }).eq('user_id', userId).neq('category', 'Renda'),
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('done', true),
    db.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    db.from('goals').select('current, target').eq('user_id', userId),
    db.from('expenses').select('id', { count: 'exact', head: false }).eq('user_id', userId).gte('created_at', today + 'T00:00:00'),
    db.from('habit_logs').select('id', { count: 'exact', head: false }).eq('user_id', userId).eq('done_at', today),
    db.from('tasks').select('id', { count: 'exact', head: false }).eq('user_id', userId).eq('done', true).gte('created_at', today + 'T00:00:00').limit(1),
    db.from('expenses').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sevenDaysAgo),
    db.from('habit_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sevenDaysAgo),
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sevenDaysAgo),
    db.from('weekly_xp').select('user_id, xp').eq('week_start', weekStart).order('xp', { ascending: false }),
  ]);

  const hasCompletedGoal = (allGoals || []).some(g => Number(g.current) >= Number(g.target));
  const balancedToday = (todayExpenses?.length > 0) && (todayHabits?.length > 0) && (todayDoneTasks?.length > 0);
  const usedAllFeatures = recentExpenses > 0 && recentHabits > 0 && recentTasks > 0 && totalGoals > 0;

  let userRank = 999;
  if (weeklyRanking) {
    const idx = weeklyRanking.findIndex(r => r.user_id === userId);
    if (idx !== -1) userRank = idx + 1;
  }

  const conditions = {
    first_action:   (totalExpenses || 0) > 0 || (totalTasks || 0) > 0,
    telegram_link:  !!profile.telegram_chat_id,
    streak_3:       (profile.streak || 0) >= 3,
    streak_7:       (profile.streak || 0) >= 7,
    streak_30:      (profile.streak || 0) >= 30,
    tasks_10:       (totalTasks || 0) >= 10,
    tasks_done_50:  (doneTasks || 0) >= 50,
    expenses_100:   (totalExpenses || 0) >= 100,
    first_goal:     (totalGoals || 0) >= 1,
    goal_completed: hasCompletedGoal,
    ranking_1st:    userRank === 1,
    ranking_top3:   userRank <= 3,
    ranking_up:     userRank <= 10,
    active_7:       (profile.streak || 0) >= 7,
    active_30:      (profile.streak || 0) >= 30,
    balanced_day:   balancedToday,
    multitasker:    usedAllFeatures,
    nexora_legend:  (profile.level || 1) >= 5 && unlockedCount >= 10,
  };

  const newlyUnlocked = [];

  for (const ach of ACHIEVEMENTS) {
    if (unlockedIds.has(ach.id)) continue;
    if (!conditions[ach.id]) continue;

    const { error } = await db.from('user_achievements').insert({
      user_id: userId,
      achievement_id: ach.id,
    });

    if (!error) {
      if (addXPFn)    await addXPFn(userId, ach.xp, `Conquista: ${ach.name}`);
      if (addCoinsFn && ach.coins) await addCoinsFn(userId, ach.coins, `Conquista: ${ach.name}`);
      newlyUnlocked.push(ach);
      unlockedIds.add(ach.id);
    }
  }

  return newlyUnlocked;
}

module.exports = { ACHIEVEMENTS, checkAndGrantAchievements };
