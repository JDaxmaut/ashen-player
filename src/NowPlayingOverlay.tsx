import { useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Pause, Play, SkipBack, SkipForward } from "lucide-react";

interface Track {
  id: number;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover?: string;
}

interface NowPlayingOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  onTogglePlay: () => void;
  onPrevTrack: () => void;
  onNextTrack: () => void;
  onSeek?: (progress: number) => void;
}

const NowPlayingOverlay: React.FC<NowPlayingOverlayProps> = ({
  isOpen,
  onClose,
  currentTrack,
  isPlaying,
  progress,
  onTogglePlay,
  onPrevTrack,
  onNextTrack,
  onSeek,
}) => {
  const dominantColor = "#f7bd48";

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleClick = useCallback<React.MouseEventHandler<HTMLDivElement>>((e) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    onSeek(percent);
  }, [onSeek]);

  return (
    <AnimatePresence>
      {isOpen && currentTrack && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex flex-col overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${dominantColor}10 0%, #0a0a0c 30%, #0a0a0c 70%, ${dominantColor}05 100%)`,
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.7)_100%)" />

          <div
            className="absolute inset-0 opacity-15 blur-[60px]"
            style={{
              backgroundImage: currentTrack.cover ? `url(${currentTrack.cover})` : "none",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-black/90" />

          <div
            className="absolute inset-0 pointer-events-none opacity-[0.015] mix-blend-overlay"
            style={{
              backgroundImage:
                'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")',
            }}
          />

          <div className="absolute top-4 left-4 text-[9px] text-white/20 uppercase tracking-widest font-mono z-50">
            {currentTrack.duration > 0 ? formatTime(currentTrack.duration) : "0:00"}
          </div>

          <button
            onClick={onClose}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-50 p-2.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 transition-all cursor-pointer"
          >
            <ChevronDown className="w-4 h-4 text-white/70" />
          </button>

          <div className="absolute top-4 right-4 flex items-center gap-3 z-50">
            <span className="text-[9px] text-white/25 uppercase tracking-widest font-mono">24-bit</span>
            <span className="text-[9px] text-white/25 uppercase tracking-widest font-mono">44.1kHz</span>
            <span className="text-[9px] text-white/25 uppercase tracking-widest font-mono">FLAC</span>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center px-6 pt-16 pb-4 relative z-10">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="relative mb-10"
            >
              <div
                className="w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 lg:w-72 lg:h-72 xl:w-80 xl:h-80 rounded-xl overflow-hidden transition-all"
                style={{
                  boxShadow: `0 0 80px ${dominantColor}25, 0 20px 60px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.05)`,
                }}
              >
                {currentTrack.cover ? (
                  <img src={currentTrack.cover} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary/20 to-secondary-container/20 flex items-center justify-center">
                    <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
                      <div className="w-14 h-14 rounded-full bg-primary/30" />
                    </div>
                  </div>
                )}
              </div>
              <motion.div
                className="absolute -inset-8 rounded-3xl opacity-30 blur-3xl pointer-events-none"
                animate={isPlaying ? { opacity: [0.3, 0.5, 0.3] } : { opacity: 0.3 }}
                transition={isPlaying ? { duration: 2, repeat: Infinity } : {}}
                style={{
                  background: currentTrack.cover ? `url(${currentTrack.cover})` : dominantColor,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                }}
              />
            </motion.div>

            <motion.div
              initial={{ y: 15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="text-center mb-8"
            >
              <h2
                className="text-4xl md:text-6xl font-serif text-white mb-3 tracking-wide"
                style={{ fontFamily: "Cormorant Garamond, Georgia, serif" }}
              >
                {currentTrack.title}
              </h2>
              <p className="text-base md:text-lg text-white/40 font-light tracking-[0.2em] uppercase">
                {currentTrack.artist}
              </p>
            </motion.div>

            <motion.div
              initial={{ y: 15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              className="w-full max-w-2xl mx-auto h-2 bg-white/10 rounded-full overflow-hidden cursor-pointer"
              onClick={handleClick}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progress}%`,
                  background: 'linear-gradient(to right, #5c1a1a 0%, #b86b1f 40%, #ffd700 100%)',
                  boxShadow: '0 0 10px rgba(255,140,0,0.8)',
                }}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.25 }}
              className="flex items-center gap-10 mt-6"
            >
              <button
                onClick={() => onPrevTrack && onPrevTrack()}
                className="p-3 text-white/30 hover:text-white/60 transition-colors cursor-pointer"
              >
                <SkipBack className="w-6 h-6" />
              </button>
              <button
                onClick={onTogglePlay}
                className="w-14 h-14 rounded-full bg-[#fdfbf7] flex items-center justify-center text-black hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,251,247,0.2),inset_0_0_0_1px_rgba(247,189,72,0.3)] cursor-pointer"
              >
                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
              </button>
              <button
                onClick={() => onNextTrack && onNextTrack()}
                className="p-3 text-white/30 hover:text-white/60 transition-colors cursor-pointer"
              >
                <SkipForward className="w-6 h-6" />
              </button>
            </motion.div>
          </div>

          <div className="absolute bottom-4 left-4 text-[10px] text-white/20 uppercase tracking-widest font-mono z-50">
            {currentTrack.album}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NowPlayingOverlay;