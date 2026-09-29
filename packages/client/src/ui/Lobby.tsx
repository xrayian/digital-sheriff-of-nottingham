import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../state/gameStore';
import { network } from '../net/colyseus';
import { SettingsModal } from './SettingsModal';

type ViewState = 'menu' | 'create' | 'join' | 'room';

export function Lobby() {
  const [view, setView] = useState<ViewState>('menu');
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Expansion Module Settings
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [enableRoyalGoods, setEnableRoyalGoods] = useState(false);
  const [enableDeputies, setEnableDeputies] = useState(false);
  const [enableBlackMarket, setEnableBlackMarket] = useState(false);
  const [sheriffRounds, setSheriffRounds] = useState<number | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const store = useGameStore();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return;
    
    setLoading(true);
    setError('');
    try {
      await network.createRoom(playerName, {
        maxPlayers,
        enableRoyalGoods,
        enableDeputies: maxPlayers === 6 ? enableDeputies : false,
        enableBlackMarket,
        sheriffRounds: maxPlayers === 3 ? (sheriffRounds ?? 3) : undefined,
      });
      setView('room');
    } catch (err: any) {
      setError(err.message || 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = playerName.trim();
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanName || !cleanCode) return;
    
    setLoading(true);
    setError('');
    try {
      await network.joinRoom(cleanCode, cleanName);
      setView('room');
    } catch (err: any) {
      setError(err.message || 'Caravan not found. Verify the room code and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleReady = () => {
    network.send('ready');
  };

  const renderMenu = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col gap-4 w-full max-w-sm"
    >
      <button onClick={() => setView('create')} className="btn-gold">
        Create Game
      </button>
      <button onClick={() => setView('join')} className="btn-outline">
        Join Game
      </button>
      <button
        type="button"
        onClick={() => store.openRulebook()}
        className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-tavern-surface/90 border border-gold/40 hover:border-gold hover:bg-tavern-surface text-gold font-display font-bold text-sm tracking-wider uppercase transition-all shadow-md cursor-pointer"
      >
        <span>📖</span>
        <span>How to Play (Rulebook)</span>
      </button>
    </motion.div>
  );

  const renderCreate = () => (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="w-full max-w-md card-surface p-8"
    >
      <h2 className="text-2xl font-display text-gold mb-6 text-center">Establish Trade</h2>
      <form onSubmit={handleCreate} className="flex flex-col gap-6">
        <div>
          <label className="block text-gold-muted text-sm mb-2 font-display">Merchant Name</label>
          <input
            type="text"
            className="input-field"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter your name..."
            autoFocus
            maxLength={16}
          />
        </div>

        <div>
          <label className="block text-gold-muted text-sm mb-2 font-display">Caravan Size (Max Players)</label>
          <div className="grid grid-cols-4 gap-2">
            {[3, 4, 5, 6].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => {
                  setMaxPlayers(num);
                  if (num !== 6) setEnableDeputies(false);
                }}
                className={`py-2 rounded-lg border font-display font-bold text-sm transition-all ${
                  maxPlayers === num
                    ? 'border-gold bg-gold/25 text-white'
                    : 'border-tavern-border bg-tavern-surface text-parchment/60 hover:text-white'
                }`}
              >
                {num}
              </button>
            ))}
          </div>
        </div>

        {maxPlayers === 3 && (
          <div className="bg-tavern-surface p-3 rounded-lg border border-tavern-border">
            <label className="block text-gold-muted text-xs mb-2 font-display uppercase tracking-wider">3-Player Match Duration</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSheriffRounds(3)}
                className={`py-1.5 px-3 rounded text-xs font-display font-bold transition-all ${
                  (sheriffRounds ?? 3) === 3
                    ? 'bg-gold/20 border border-gold text-gold-light'
                    : 'bg-tavern-bg/50 border border-tavern-border text-parchment/60 hover:text-white'
                }`}
              >
                Standard (3 Turns / 9 Rnds)
              </button>
              <button
                type="button"
                onClick={() => setSheriffRounds(2)}
                className={`py-1.5 px-3 rounded text-xs font-display font-bold transition-all ${
                  sheriffRounds === 2
                    ? 'bg-gold/20 border border-gold text-gold-light'
                    : 'bg-tavern-bg/50 border border-tavern-border text-parchment/60 hover:text-white'
                }`}
              >
                Quick (2 Turns / 6 Rnds)
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3 border-t border-tavern-border pt-4">
          <label className="block text-gold-muted text-sm font-display">Expansion Modules</label>
          
          <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-lg bg-tavern-surface border border-tavern-border hover:border-gold/40 transition-colors">
            <input
              type="checkbox"
              checked={enableRoyalGoods}
              onChange={(e) => setEnableRoyalGoods(e.target.checked)}
              className="accent-gold h-4 w-4 rounded"
            />
            <div>
              <div className="font-bold text-sm text-gold-light">👑 Royal Goods</div>
              <div className="text-xs text-parchment/60">Adds 12 high-value royal goods converted to legal bonus points</div>
            </div>
          </label>

          <label className={`flex items-center gap-3 p-2.5 rounded-lg bg-tavern-surface border border-tavern-border transition-colors ${
            maxPlayers === 6 ? 'cursor-pointer hover:border-gold/40' : 'opacity-40 cursor-not-allowed'
          }`}>
            <input
              type="checkbox"
              disabled={maxPlayers !== 6}
              checked={maxPlayers === 6 && enableDeputies}
              onChange={(e) => setEnableDeputies(e.target.checked)}
              className="accent-gold h-4 w-4 rounded"
            />
            <div>
              <div className="font-bold text-sm text-gold-light">🛡️ 6-Player Deputies</div>
              <div className="text-xs text-parchment/60">2 deputies inspect with Booty Tile (requires 6 players)</div>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-lg bg-tavern-surface border border-tavern-border hover:border-gold/40 transition-colors">
            <input
              type="checkbox"
              checked={enableBlackMarket}
              onChange={(e) => setEnableBlackMarket(e.target.checked)}
              className="accent-gold h-4 w-4 rounded"
            />
            <div>
              <div className="font-bold text-sm text-gold-light">🗡️ Black Market</div>
              <div className="text-xs text-parchment/60">Trade in 3 matching contraband for high-value orders</div>
            </div>
          </label>
        </div>

        {error && <div className="text-crimson text-sm">{error}</div>}
        <div className="flex gap-4 mt-4">
          <button type="button" onClick={() => setView('menu')} className="btn-outline flex-1">
            Back
          </button>
          <button type="submit" disabled={!playerName.trim() || loading} className="btn-gold flex-1">
            {loading ? 'Preparing...' : 'Create'}
          </button>
        </div>
      </form>
    </motion.div>
  );

  const renderJoin = () => (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="w-full max-w-md card-surface p-8"
    >
      <h2 className="text-2xl font-display text-gold mb-6 text-center">Join Caravan</h2>
      <form onSubmit={handleJoin} className="flex flex-col gap-6">
        <div>
          <label className="block text-gold-muted text-sm mb-2 font-display">Merchant Name</label>
          <input
            type="text"
            className="input-field mb-4"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter your name..."
            autoFocus
            maxLength={16}
          />
          <label className="block text-gold-muted text-sm mb-2 font-display">Room Code</label>
          <input
            type="text"
            className="input-field uppercase tracking-widest font-mono font-bold"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="e.g. 4-LETTER CODE"
            maxLength={16}
          />
        </div>
        {error && <div className="text-crimson text-sm">{error}</div>}
        <div className="flex gap-4 mt-4">
          <button type="button" onClick={() => setView('menu')} className="btn-outline flex-1">
            Back
          </button>
          <button type="submit" disabled={!playerName.trim() || !roomCode.trim() || loading} className="btn-gold flex-1">
            {loading ? 'Approaching...' : 'Join'}
          </button>
        </div>
      </form>
    </motion.div>
  );

  const renderRoom = () => {
    const players = Array.from(store.players.values());
    const isHost = players.length > 0 && players[0]?.id === store.localPlayerId;
    const me = store.players.get(store.localPlayerId || '');

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-2xl card-surface p-8"
      >
        <div className="text-center mb-8">
          <h2 className="text-sm font-display text-gold-muted tracking-widest uppercase mb-2">Room Code</h2>
          <div className="flex items-center justify-center gap-3">
            <span className="text-4xl text-gold tracking-widest select-all font-mono font-bold">{store.roomId}</span>
            <button
              type="button"
              onClick={() => {
                if (store.roomId) navigator.clipboard.writeText(store.roomId);
              }}
              className="text-xs px-3 py-1.5 rounded-md border border-gold-muted/40 text-gold-muted hover:text-gold hover:border-gold transition-colors font-display tracking-wider uppercase"
              title="Copy room code"
            >
              Copy
            </button>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          {players.map((p) => (
            <div key={p.id} className="flex items-center justify-between p-4 rounded-lg bg-tavern-bg border border-tavern-border">
              <span className="font-display text-lg text-parchment">
                {p.name} {p.id === store.localPlayerId ? '(You)' : ''}
              </span>
              <span className={`text-sm px-3 py-1 rounded-full font-bold ${p.ready ? 'bg-emerald/20 text-emerald' : 'bg-tavern-surface text-gold-muted'}`}>
                {p.ready ? 'Ready' : 'Not Ready'}
              </span>
            </div>
          ))}
          {players.length === 0 && <div className="text-center text-gold-muted">Waiting for merchants...</div>}
        </div>

        {/* Caravan & Expansion Settings */}
        <div className="mb-8 p-4 rounded-xl bg-tavern-bg/80 border border-tavern-border">
          <div className="flex items-center justify-between mb-3">
            <span className="font-display text-sm text-gold tracking-wide uppercase font-bold">
              Caravan Rules & Expansions
            </span>
            {isHost && (
              <span className="text-[11px] text-gold-muted uppercase tracking-wider bg-gold/10 px-2 py-0.5 rounded border border-gold/20">
                Host Controls
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2 rounded bg-tavern-surface/80 border border-tavern-border text-center">
              <span className="block text-[11px] text-gold-muted font-display uppercase">Max Players</span>
              {isHost ? (
                <div className="flex items-center justify-center gap-1 mt-1">
                  {[3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() =>
                        network.send('update_lobby_options', {
                          maxPlayers: n,
                          enableDeputies: n === 6 ? store.enableDeputies : false,
                        })
                      }
                      className={`text-xs px-2 py-0.5 rounded font-bold transition-colors ${
                        store.maxPlayers === n
                          ? 'bg-gold text-tavern-bg'
                          : 'bg-tavern-bg text-parchment/70 hover:text-white'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="font-display font-bold text-sm text-parchment">{store.maxPlayers}</span>
              )}
            </div>

            <div className="p-2 rounded bg-tavern-surface/80 border border-tavern-border text-center flex flex-col justify-center">
              <span className="block text-[11px] text-gold-muted font-display uppercase">👑 Royal Goods</span>
              {isHost ? (
                <button
                  type="button"
                  onClick={() =>
                    network.send('update_lobby_options', {
                      enableRoyalGoods: !store.enableRoyalGoods,
                    })
                  }
                  className={`mt-1 text-xs px-2 py-0.5 rounded font-bold transition-colors ${
                    store.enableRoyalGoods
                      ? 'bg-emerald/30 text-emerald border border-emerald/50'
                      : 'bg-tavern-bg text-parchment/40'
                  }`}
                >
                  {store.enableRoyalGoods ? 'Active' : 'Off'}
                </button>
              ) : (
                <span
                  className={`mt-1 text-xs font-bold ${
                    store.enableRoyalGoods ? 'text-emerald' : 'text-parchment/40'
                  }`}
                >
                  {store.enableRoyalGoods ? 'Active' : 'Off'}
                </span>
              )}
            </div>

            <div className="p-2 rounded bg-tavern-surface/80 border border-tavern-border text-center flex flex-col justify-center">
              <span className="block text-[11px] text-gold-muted font-display uppercase">🛡️ Deputies</span>
              {isHost ? (
                <button
                  type="button"
                  disabled={store.maxPlayers !== 6}
                  onClick={() =>
                    network.send('update_lobby_options', {
                      enableDeputies: !store.enableDeputies,
                    })
                  }
                  className={`mt-1 text-xs px-2 py-0.5 rounded font-bold transition-colors ${
                    store.maxPlayers !== 6
                      ? 'opacity-30 cursor-not-allowed bg-tavern-bg text-parchment/30'
                      : store.enableDeputies
                      ? 'bg-emerald/30 text-emerald border border-emerald/50'
                      : 'bg-tavern-bg text-parchment/40'
                  }`}
                >
                  {store.maxPlayers !== 6 ? '6p only' : store.enableDeputies ? 'Active' : 'Off'}
                </button>
              ) : (
                <span
                  className={`mt-1 text-xs font-bold ${
                    store.enableDeputies ? 'text-emerald' : 'text-parchment/40'
                  }`}
                >
                  {store.enableDeputies ? 'Active' : 'Off'}
                </span>
              )}
            </div>

            <div className="p-2 rounded bg-tavern-surface/80 border border-tavern-border text-center flex flex-col justify-center">
              <span className="block text-[11px] text-gold-muted font-display uppercase">🗡️ Black Market</span>
              {isHost ? (
                <button
                  type="button"
                  onClick={() =>
                    network.send('update_lobby_options', {
                      enableBlackMarket: !store.enableBlackMarket,
                    })
                  }
                  className={`mt-1 text-xs px-2 py-0.5 rounded font-bold transition-colors ${
                    store.enableBlackMarket
                      ? 'bg-emerald/30 text-emerald border border-emerald/50'
                      : 'bg-tavern-bg text-parchment/40'
                  }`}
                >
                  {store.enableBlackMarket ? 'Active' : 'Off'}
                </button>
              ) : (
                <span
                  className={`mt-1 text-xs font-bold ${
                    store.enableBlackMarket ? 'text-emerald' : 'text-parchment/40'
                  }`}
                >
                  {store.enableBlackMarket ? 'Active' : 'Off'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-4 flex-wrap">
          <button
            type="button"
            onClick={async () => {
              await network.leave();
              setView('menu');
            }}
            className="btn-outline"
          >
            Leave
          </button>
          <button onClick={handleToggleReady} className={me?.ready ? 'btn-outline' : 'btn-gold'}>
            {me?.ready ? 'Not Ready' : 'Ready'}
          </button>
          {isHost && (
            <button
              onClick={() => network.send('startGame')}
              disabled={players.length < 3 || !players.every(p => p.ready)}
              className="btn-gold disabled:opacity-50"
            >
              Start Game
            </button>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-tavern-bg text-parchment bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-tavern-surface to-tavern-bg p-6">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <h1 className="text-5xl md:text-7xl font-display font-black text-transparent bg-clip-text bg-gradient-to-b from-gold-light via-gold to-gold-dark filter drop-shadow-lg mb-4">
          Sheriff of Nottingham
        </h1>
        <p className="text-xl font-display text-gold-muted italic tracking-wide">
          A Game of Bluffing & Bribery
        </p>
      </motion.div>

      <AnimatePresence mode="wait">
        {view === 'menu' && renderMenu()}
        {view === 'create' && renderCreate()}
        {view === 'join' && renderJoin()}
        {view === 'room' && renderRoom()}
      </AnimatePresence>

      {/* Floating Action Controls in Top Right */}
      <div className="fixed top-6 right-6 flex items-center gap-2 z-20">
        <button
          type="button"
          onClick={() => store.openRulebook()}
          className="h-9 px-3 rounded-xl bg-tavern-surface/90 border border-gold/40 hover:border-gold text-gold hover:text-white transition-colors shadow-lg font-display text-xs tracking-wider uppercase cursor-pointer inline-flex items-center justify-center gap-1.5"
          title="Open Nottingham Codex & Rulebook (?)"
        >
          <span>📖</span>
          <span className="hidden sm:inline">Rules</span>
        </button>

        <button
          type="button"
          onClick={() => store.toggleFullscreen()}
          className="h-9 w-9 rounded-xl bg-tavern-surface/90 border border-tavern-border hover:border-gold/60 text-gold-muted hover:text-gold transition-colors shadow-lg cursor-pointer inline-flex items-center justify-center"
          title={store.isFullscreen ? 'Exit Immersive Fullscreen Mode' : 'Enter Immersive Fullscreen Mode'}
        >
          <span className="text-sm">{store.isFullscreen ? '🗗' : '⛶'}</span>
        </button>

        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className="h-9 w-9 rounded-xl bg-tavern-surface/90 border border-tavern-border hover:border-gold/60 text-gold-muted hover:text-gold transition-colors shadow-lg cursor-pointer inline-flex items-center justify-center"
          title="Game & Accessibility Settings"
        >
          ⚙️
        </button>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
