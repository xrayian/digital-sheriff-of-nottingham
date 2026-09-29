import { useState, useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import { network } from '../net/colyseus';
import { soundManager } from '../audio/soundManager';
import { TableBoard2D } from '../ui/table2d/TableBoard2D';
import { ActionLedger } from '../ui/table2d/ActionLedger';
import { MarketPanel } from '../ui/MarketPanel';
import { BagLoadingPanel } from '../ui/BagLoadingPanel';
import { DeclarationPanel } from '../ui/DeclarationPanel';
import { ErrorToast } from '../ui/ErrorToast';
import { ExaminationDesk } from '../ui/ExaminationDesk';
import { InspectionOutcomeModal } from '../ui/InspectionOutcomeModal';
import { BlackMarketPanel } from '../ui/BlackMarketPanel';
import { SettingsModal } from '../ui/SettingsModal';
import { NegotiationOfferModal } from '../ui/NegotiationOfferModal';
import { NegotiationFeedback } from '../ui/NegotiationFeedback';
import { DiscardPileModal } from '../ui/DiscardPileModal';
import { GameOverModal } from '../ui/GameOverModal';

export function GameScene() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    soundManager.startAmbientLoop();
    return () => {
      soundManager.stopAmbientLoop();
    };
  }, []);

  const phase = useGameStore((s) => s.phase);
  const round = useGameStore((s) => s.round);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const sheriffId = useGameStore((s) => s.sheriffId);
  const deputyIds = useGameStore((s) => s.deputyIds);
  const enableDeputies = useGameStore((s) => s.enableDeputies);
  const bootyTile = useGameStore((s) => s.bootyTile);
  const activeMerchantId = useGameStore((s) => s.activeMerchantId);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const playersMap = useGameStore((s) => s.players);
  const isFullscreen = useGameStore((s) => s.isFullscreen);
  const toggleFullscreen = useGameStore((s) => s.toggleFullscreen);
  const openRulebook = useGameStore((s) => s.openRulebook);

  const players = Array.from(playersMap.values());
  const sheriffPlayer = players.find((p) => p.isSheriff || p.id === sheriffId);
  const activePlayer = players.find((p) => p.id === activeMerchantId);
  const localPlayer = players.find((p) => p.id === localPlayerId);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-tavern-bg select-none bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-tavern-surface to-tavern-bg">
      {/* 2D Flat Table Board Arena */}
      <TableBoard2D />

      {/* 2D HUD Top Header Bar */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none z-20">
        {/* Game & Round Info */}
        <div className="flex items-center gap-2.5 bg-tavern-bg/95 border border-tavern-border px-3.5 py-1.5 rounded-xl backdrop-blur-md shadow-2xl">
          <span className="font-display font-black text-gold text-base tracking-wider">
            NOTTINGHAM
          </span>
          <span className="w-1 h-3.5 bg-tavern-border rounded-full" />
          <span className="font-display text-xs text-parchment">
            Round <span className="font-bold text-gold">{round || 1}</span>
            {totalRounds > 0 && <span className="text-parchment/60 font-body"> of {totalRounds}</span>}
          </span>
          {enableDeputies ? (
            <>
              <span className="w-1 h-3.5 bg-tavern-border rounded-full" />
              <span className="font-display text-xs text-blue-300 flex items-center gap-1.5 bg-blue-500/20 px-2 py-0.5 rounded-md border border-blue-400/30">
                <span>🛡️ Deputies:</span>
                <span className="font-bold text-white">
                  {players.filter((p) => deputyIds.includes(p.id)).map((p) => p.name).join(' & ') || 'Assigned'}
                </span>
              </span>
              {bootyTile && (
                <span className="font-display text-xs text-gold flex items-center gap-1.5 bg-gold/15 px-2 py-0.5 rounded-md border border-gold/30">
                  <span>💰 Booty:</span>
                  <span className="font-bold text-white">{bootyTile.gold}g</span>
                  {bootyTile.goodsCount > 0 && <span className="text-parchment/60">({bootyTile.goodsCount} goods)</span>}
                </span>
              )}
            </>
          ) : sheriffPlayer ? (
            <>
              <span className="w-1 h-3.5 bg-tavern-border rounded-full" />
              <span className="font-display text-xs text-gold flex items-center gap-1.5 bg-gold/15 px-2 py-0.5 rounded-md border border-gold/30">
                <span>⭐ Sheriff:</span>
                <span className="font-bold text-white">{sheriffPlayer.name}</span>
              </span>
            </>
          ) : null}
        </div>

        {/* Current Phase Banner */}
        <div className="flex items-center gap-2 bg-tavern-bg/95 border border-gold/70 px-5 py-1.5 rounded-xl backdrop-blur-md shadow-2xl">
          <span className="font-display text-xs text-gold-muted uppercase tracking-widest">Phase:</span>
          <span className="font-display font-black text-xs md:text-sm text-gold tracking-widest uppercase">
            {phase?.replace('_', ' ') || 'MARKET'}
          </span>
          {activePlayer && (
            <span className="ml-1 text-xs font-display px-2 py-0.5 rounded bg-emerald/20 border border-emerald/50 text-emerald font-bold animate-pulse">
              {activePlayer.name}'s Turn
            </span>
          )}
        </div>

        {/* Right Action Menu */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={() => openRulebook()}
            className="h-8 px-3 rounded-lg bg-tavern-bg/95 border border-gold/40 text-gold hover:text-white hover:border-gold transition-colors font-display text-xs tracking-wider uppercase backdrop-blur-md shadow-lg cursor-pointer inline-flex items-center justify-center gap-1.5"
            title="Rulebook"
          >
            <span>📖</span>
            <span className="hidden sm:inline">Rules</span>
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="h-8 px-3 rounded-lg bg-tavern-bg/95 border border-tavern-border text-gold-muted hover:text-gold hover:border-gold/60 transition-colors font-display text-xs tracking-wider uppercase backdrop-blur-md shadow-lg cursor-pointer inline-flex items-center justify-center gap-1.5"
            title="Toggle Fullscreen"
          >
            <span className="text-sm">{isFullscreen ? '🗗' : '⛶'}</span>
            <span className="hidden md:inline">{isFullscreen ? 'Windowed' : 'Fullscreen'}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="h-8 w-8 rounded-lg bg-tavern-bg/85 border border-tavern-border text-gold-muted hover:text-gold hover:border-gold/60 transition-colors font-display text-sm tracking-wider uppercase backdrop-blur-md shadow-lg cursor-pointer inline-flex items-center justify-center"
            title="Game & Accessibility Settings"
          >
            ⚙️
          </button>
          <button
            type="button"
            onClick={() => network.leave()}
            className="h-8 px-3 rounded-lg bg-tavern-bg/85 border border-tavern-border text-gold-muted hover:text-crimson hover:border-crimson/60 transition-colors font-display text-xs tracking-wider uppercase backdrop-blur-md shadow-lg cursor-pointer inline-flex items-center justify-center"
          >
            Leave
          </button>
        </div>
      </div>

      {/* Town Action Ledger Drawer */}
      <ActionLedger />

      {/* Core Loop UI Panels */}
      <MarketPanel />
      <BagLoadingPanel />
      <DeclarationPanel />
      <ErrorToast />

      {/* Examination Desk & Inspection Outcomes */}
      <ExaminationDesk />
      <InspectionOutcomeModal />

      {/* Negotiation Feed Rework: Toasts, DEAL Stamps, and Offer Modal */}
      <NegotiationFeedback />
      <NegotiationOfferModal />

      {/* Black Market Expansion Panel */}
      <BlackMarketPanel />

      {/* Discard Pile Viewer Modal */}
      <DiscardPileModal />

      {/* Endgame Victory & Standings Modal */}
      <GameOverModal />

      {/* Settings & Accessibility Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Local Player Quick Stats Bar at Bottom Center */}
      {localPlayer && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-5 bg-tavern-bg/95 border border-tavern-border px-5 py-2 rounded-2xl backdrop-blur-md shadow-2xl pointer-events-none z-20">
          <div className="flex items-center gap-2">
            <span className="text-xs font-display text-gold-muted uppercase tracking-wider">Your Stand:</span>
            <span className="font-display font-bold text-white text-xs md:text-sm">{localPlayer.name}</span>
          </div>
          <div className="flex items-center gap-1 text-gold font-display font-bold text-xs">
            <span>🪙</span>
            <span>{localPlayer.gold}g</span>
          </div>
          <div className="flex items-center gap-1 text-parchment font-display text-xs">
            <span>🃏</span>
            <span>{localPlayer.handCount} cards</span>
          </div>
        </div>
      )}
    </div>
  );
}
