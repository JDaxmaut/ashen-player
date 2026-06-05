import { useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Pause, Play, SkipBack, SkipForward, Music } from "lucide-react";

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
  dominantColor?: string;
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
  dominantColor = "#f7bd48",
}) => {
  const accent = dominantColor || "#f7bd48";

  const formatTime = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const currentTime = ((progress / 100) * (currentTrack?.duration || 0));

  const handleSeekClick = useCallback<React.MouseEventHandler<HTMLDivElement>>((e) => {
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
          transition={{ duration: 0.35 }}
          className="fixed inset-0 z-[100] overflow-hidden flex flex-col"
        >
          {/* Blurred cover background */}
          <div className="absolute inset-0">
            {currentTrack.cover ? (
              <img
                src={currentTrack.cover}
                alt=""
                className="w-full h-full object-cover scale-110"
                style={{ filter: "blur(50px) saturate(1.4) brightness(0.28)" }}
              />
            ) : (
              <div className="w-full h-full" style={{ background: `radial-gradient(ellipse at 50% 30%, ${accent}30 0%, #080808 70%)` }} />
            )}
            <div className="absolute inset-0 bg-black/40" />
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-5 left-1/2 -translate-x-1/2 z-50 p-2 rounded-full bg-white/8 hover:bg-white/15 border border-white/10 backdrop-blur-sm transition-all cursor-pointer"
          >
            <ChevronDown className="w-5 h-5 text-white/70" />
          </button>

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center justify-center flex-1 px-10 pt-14 pb-10 gap-0">

            {/* Cover */}
            <motion.div
              initial={{ scale: 0.82, opacity: 0, y: 24 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.88, opacity: 0, y: 16 }}
              transition={{ duration: 0.45, ease: [0.34, 1.36, 0.64, 1] }}
              className="relative mb-9"
            >
              {/* Ambient glow behind cover */}
              <motion.div
                className="absolute -inset-8 rounded-3xl blur-3xl pointer-events-none"
                animate={isPlaying ? { opacity: [0.35, 0.6, 0.35] } : { opacity: 0.25 }}
                transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  background: currentTrack.cover
                    ? `url(${currentTrack.cover}) center/cover`
                    : accent,
                  opacity: 0.35,
                }}
              />

              <div
                className="relative rounded-2xl overflow-hidden"
                style={{
                  width: "min(54vmin, 420px)",
                  height: "min(54vmin, 420px)",
                  boxShadow: `0 32px 80px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06), 0 0 60px ${accent}30`,
                }}
              >
                {currentTrack.cover ? (
                  <img src={currentTrack.cover} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ background: `linear-gradient(135deg, ${accent}20, #1a1a1a)` }}
                  >
                    <Music className="text-white/15" style={{ width: "35%", height: "35%" }} />
                  </div>
                )}
              </div>
            </motion.div>

            {/* Track info */}
            <motion.div
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.12 }}
              className="text-center mb-7 w-full max-w-md"
            >
              <h2 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-2 truncate px-2">
                {currentTrack.title}
              </h2>
              <p className="text-white/55 text-base sm:text-lg tracking-wide truncate">{currentTrack.artist}</p>
              {currentTrack.album && currentTrack.album !== "Unknown Album" && (
                <p className="text-white/28 text-sm mt-1 truncate">{currentTrack.album}</p>
              )}
            </motion.div>

            {/* Progress */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              className="w-full max-w-md mb-8"
            >
              <div
                className="w-full h-[5px] bg-white/15 rounded-full cursor-pointer group mb-2.5"
                onClick={handleSeekClick}
              >
                <div
                  className="h-full rounded-full transition-none relative"
                  style={{ width: `${progress}%`, background: accent }}
                >
                  <div
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white opacity-0 group-hover:opacity-100 translate-x-1/2 transition-opacity shadow-md"
                  />
                </div>
              </div>
              <div className="flex justify-between text-xs text-white/35 font-mono tabular-nums">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(currentTrack.duration)}</span>
              </div>
            </motion.div>

            {/* Controls */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.25 }}
              className="flex items-center gap-10"
            >
              <button
                onClick={onPrevTrack}
                className="text-white/45 hover:text-white/90 transition-colors active:scale-90 duration-100"
              >
                <SkipBack className="w-7 h-7" />
              </button>

              <button
                onClick={onTogglePlay}
                className="w-[68px] h-[68px] rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-lg"
                style={{ background: accent, boxShadow: `0 0 30px ${accent}60` }}
              >
                {isPlaying
                  ? <Pause className="w-7 h-7 text-black" />
                  : <Play className="w-7 h-7 text-black ml-1" />}
              </button>

              <button
                onClick={onNextTrack}
                className="text-white/45 hover:text-white/90 transition-colors active:scale-90 duration-100"
              >
                <SkipForward className="w-7 h-7" />
              </button>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NowPlayingOverlay;
