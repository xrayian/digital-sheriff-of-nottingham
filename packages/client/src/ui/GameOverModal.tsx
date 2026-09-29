import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../state/gameStore';
import { network } from '../net/colyseus';
import { soundManager } from '../audio/soundManager';

export function GameOverModal() {
  const phase = useGameStore((s) => s.phase);
  const leaderboard = useGameStore((s) => s.leaderboard);
  const winnerId = useGameStore((s) => s.winnerId);
  const winningScore = useGameStore((s) => s.winningScore);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const playersMap = useGameStore((s) => s.players);
  const openRulebook = useGameStore((s) => s.openRulebook);
  const reducedMotion = useGameStore((s) => s.reducedMotion);

  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);

  useEffect(() => {
    if (phase === 'GAME_OVER') {
      soundManager.playHonestFanfare();
      const timer = setTimeout(() => {
        soundManager.playCoin();
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  if (phase !== 'GAME_OVER') return null;

  const winner = Array.from(playersMap.values()).find((p) => p.id === winnerId);
  const winnerName = winner?.name || leaderboard[0]?.name || 'Unknown Champion';
  const isLocalWinner = localPlayerId === winnerId || (leaderboard[0] && leaderboard[0].playerId === localPlayerId);

  const handleReturnToLobby = () => {
    network.leave();
  };

  const getRankBadge = (rank: number) => {
    switch (rank) {
      case 1:
        return { emoji: '🥇', label: '1st', bg: 'bg-amber-500/20 text-gold-light border-gold' };
      case 2:
        return { emoji: '🥈', label: '2nd', bg: 'bg-slate-300/20 text-slate-200 border-slate-400' };
      case 3:
        return { emoji: '🥉', label: '3rd', bg: 'bg-amber-800/20 text-amber-400 border-amber-600' };
      default:
        return { emoji: '🎖️', label: `${rank}th`, bg: 'bg-tavern-surface text-parchment/70 border-tavern-border' };
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md select-none p-4 overflow-y-auto">
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 30 }}
          transition={{
            type: 'spring',
            stiffness: reducedMotion ? 1000 : 250,
            damping: 24,
          }}
          className="relative max-w-3xl w-full bg-walnut-bg/95 border-2 border-gold/80 rounded-3xl p-6 md:p-8 shadow-[0_25px_70px_rgba(0,0,0,0.9)] flex flex-col gap-6 text-parchment my-auto"
        >
          {/* Coronation Header Banner */}
          <div className="flex flex-col items-center text-center gap-2 border-b border-gold/40 pb-5">
            <div className="flex items-center gap-3">
              <span className="text-4xl md:text-5xl filter drop-shadow">👑</span>
              <span className="text-4xl md:text-5xl filter drop-shadow">🏆</span>
            </div>
            
            <h1 className="text-2xl md:text-4xl font-display font-black text-gold tracking-wider uppercase drop-shadow">
              Caravan Journey Complete
            </h1>

            <div className="flex flex-col items-center gap-1 mt-1">
              <span className="text-sm font-display text-gold-light uppercase tracking-widest font-bold">
                {isLocalWinner ? '🌟 Sovereign of the Market! 🌟' : 'Winner Crowned'}
              </span>
              <p className="text-base md:text-xl font-display font-bold text-white">
                <span className="text-gold font-black">{winnerName}</span> wins with{' '}
                <span className="text-gold font-black underline underline-offset-4">{winningScore || leaderboard[0]?.totalScore || 0} Points</span>!
              </p>
              {isLocalWinner && (
                <p className="text-xs text-emerald-400 font-body max-w-md mt-1 animate-pulse">
                  Your cunning trades, honest declarations, and bold ventures through the Nottingham gates have brought you ultimate triumph!
                </p>
              )}
            </div>
          </div>

          {/* Ranked Leaderboard */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-2 text-xs font-display font-bold text-gold-muted uppercase tracking-wider">
              <span>Final Standings</span>
              <span>Total Points</span>
            </div>

            <div className="flex flex-col gap-2">
              {leaderboard.map((entry, idx) => {
                const rankInfo = getRankBadge(entry.rank || idx + 1);
                const isLocal = entry.playerId === localPlayerId;
                const isWinner = entry.rank === 1 || idx === 0;
                const player = playersMap.get(entry.playerId);
                const isExpanded = expandedPlayerId === entry.playerId;

                return (
                  <div
                    key={entry.playerId}
                    className={`flex flex-col rounded-2xl border transition-all ${
                      isWinner
                        ? 'bg-gradient-to-r from-gold/15 via-walnut-card to-gold/15 border-gold shadow-[0_0_25px_rgba(212,168,75,0.25)]'
                        : isLocal
                        ? 'bg-walnut-card border-gold/60 shadow-md'
                        : 'bg-walnut-surface/80 border-tavern-border'
                    }`}
                  >
                    <div
                      onClick={() => setExpandedPlayerId(isExpanded ? null : entry.playerId)}
                      className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-gold/5 rounded-2xl transition-colors"
                    >
                      {/* Left: Rank & Name */}
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-9 h-9 rounded-xl border flex items-center justify-center font-display font-black text-sm ${rankInfo.bg}`}
                        >
                          {rankInfo.emoji}
                        </span>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-display font-black text-sm md:text-base text-white">
                              {entry.name}
                            </span>
                            {isLocal && (
                              <span className="text-[10px] font-display font-bold px-1.5 py-0.5 rounded bg-gold/20 text-gold-light border border-gold/40">
                                YOU
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-parchment/60 font-body">
                            <span>🪙 {entry.gold}g</span>
                            <span>•</span>
                            <span>📦 {entry.goodsValue} goods pts</span>
                            {entry.bonusPoints > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-gold-light font-bold">👑 +{entry.bonusPoints} bonus</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Total Score */}
                      <div className="flex items-center gap-3">
                        <span className="text-xl md:text-2xl font-display font-black text-gold tracking-wide">
                          {entry.totalScore}
                        </span>
                        <span className="text-xs text-parchment/40">
                          {isExpanded ? '▲' : '▼'}
                        </span>
                      </div>
                    </div>

                    {/* Expandable Breakdown Drawer */}
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="px-4 pb-4 pt-1 border-t border-tavern-border/60 text-xs font-body flex flex-col gap-2"
                      >
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-center">
                          <div className="p-2 rounded-xl bg-walnut-surface/60 border border-tavern-border">
                            <span className="text-parchment/60 block text-[10px] uppercase">Cash Purse</span>
                            <span className="font-display font-bold text-gold text-sm">{entry.gold}g</span>
                          </div>
                          <div className="p-2 rounded-xl bg-walnut-surface/60 border border-tavern-border">
                            <span className="text-parchment/60 block text-[10px] uppercase">Legal Goods</span>
                            <span className="font-display font-bold text-white text-sm">{entry.legalGoodsCount} cards</span>
                          </div>
                          <div className="p-2 rounded-xl bg-walnut-surface/60 border border-tavern-border">
                            <span className="text-parchment/60 block text-[10px] uppercase">Contraband</span>
                            <span className="font-display font-bold text-crimson-light text-sm">{entry.contrabandCount} cards</span>
                          </div>
                          <div className="p-2 rounded-xl bg-walnut-surface/60 border border-tavern-border">
                            <span className="text-parchment/60 block text-[10px] uppercase">Royal & King Bonuses</span>
                            <span className="font-display font-bold text-purple-300 text-sm">+{entry.bonusPoints} pts</span>
                          </div>
                        </div>

                        {/* Stand Reveal (Faceup goods & revealed contraband) */}
                        {player && (
                          <div className="flex flex-col gap-1 mt-1 text-[11px] text-parchment/80">
                            <span className="font-display font-bold text-gold-muted text-[10px] uppercase tracking-wider">
                              Delivered to Merchant Stand:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {player.standLegal.map((c, i) => (
                                <span
                                  key={`${c.id}-${i}`}
                                  className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-200"
                                >
                                  🍏 {c.name} ({c.value}g)
                                </span>
                              ))}
                              {player.standRoyal.map((c, i) => (
                                <span
                                  key={`${c.id}-${i}`}
                                  className="px-2 py-0.5 rounded bg-purple-950/60 border border-purple-500/40 text-purple-200 font-bold"
                                >
                                  👑 {c.name} ({c.value}g)
                                </span>
                              ))}
                              {player.standContraband.map((c, i) => (
                                <span
                                  key={`${c.id}-${i}`}
                                  className="px-2 py-0.5 rounded bg-red-950/60 border border-red-500/40 text-red-200 font-bold"
                                >
                                  ⚜️ {c.name} ({c.value}g)
                                </span>
                              ))}
                              {player.standLegal.length === 0 &&
                                player.standRoyal.length === 0 &&
                                player.standContraband.length === 0 && (
                                  <span className="text-parchment/40 italic">No goods were delivered to stand</span>
                                )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Action Buttons */}
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-gold/40 flex-wrap">
            <button
              type="button"
              onClick={() => openRulebook()}
              className="px-4 py-2.5 rounded-xl bg-walnut-surface hover:bg-gold/10 border border-gold/30 text-gold font-display font-bold text-xs uppercase tracking-wider cursor-pointer inline-flex items-center gap-1.5 transition-all"
            >
              <span>📖</span>
              <span>Scoring Rules Codex</span>
            </button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={handleReturnToLobby}
              className="px-8 py-3 rounded-xl bg-gradient-to-r from-gold-dark via-gold to-gold-light text-walnut-bg font-display font-black text-sm uppercase tracking-wider shadow-[0_0_25px_rgba(212,168,75,0.4)] border border-gold-light cursor-pointer"
            >
              Play Again (Return to Lobby)
            </motion.button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
