import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, SkipBack, SkipForward, Play, Pause } from 'lucide-react';

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

const Waveform: React.FC<{ progress: number; trackPath: string | null; isOpen: boolean; onSeek?: (progress: number) => void }> = ({ progress, trackPath, isOpen, onSeek }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!trackPath) return;

    const loadWaveform = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(trackPath);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        const rawData = audioBuffer.getChannelData(0);
        const samples = 400;
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData: number[] = [];

        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          filteredData.push(sum / blockSize);
        }

        const max = Math.max(...filteredData);
        const normalized = filteredData.map(n => n / max);
        setWaveformData(normalized);
      } catch (e) {
        const mockData = Array.from({ length: 400 }, (_, i) => {
          const seed = Math.sin(i * 0.25) * 0.5 + Math.sin(i * 0.13) * 0.3 + Math.sin(i * 0.07) * 0.2;
          return Math.max(0.05, Math.abs(seed) + 0.1);
        });
        setWaveformData(mockData);
      } finally {
        setIsLoading(false);
      }
    };

    loadWaveform();
  }, [trackPath, isOpen]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !onSeek) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newProgress = (x / rect.width) * 100;
    onSeek(Math.max(0, Math.min(100, newProgress)));
  }, [onSeek]);

  return (
    <div 
      ref={containerRef}
      className="w-full h-12 flex items-center justify-center gap-[1px] cursor-pointer select-none"
      onClick={handleClick}
    >
      {isLoading ? (
        <div className="w-full h-full flex items-center justify-center gap-[1px]">
          {Array.from({ length: 200 }).map((_, i) => (
            <div key={i} className="w-0.5 bg-white/10" style={{ height: '2px' }} />
          ))}
        </div>
      ) : (
        waveformData.map((amplitude, i) => {
          const position = i / waveformData.length;
          const isActive = position <= progress / 100;
          const barHeight = Math.max(2, amplitude * 44);
          
          return (
            <div key={i} className="flex items-center justify-center" style={{ width: '0.25%', flex: '0 0 auto' }}>
              <div
                className="w-0.5 transition-all duration-75"
                style={{
                  height: `${barHeight}px`,
                  background: isActive ? 'linear-gradient(to top, #f7bd48, #ff8844)' : 'rgba(255,255,255,0.05)',
                  boxShadow: isActive ? '0 0 4px rgba(247,189,72,0.4)' : 'none',
                  opacity: isActive ? 0.9 : 0.25,
                }}
              />
            </div>
          );
        })
      )}
    </div>
  );
};

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
  const dominantColor = '#f7bd48';
  const [audioSrc, setAudioSrc] = useState<string | null>(null);

  useEffect(() => {
    if (currentTrack?.path && isOpen) {
      setAudioSrc(currentTrack.path);
    }
  }, [currentTrack, isOpen]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.5)_100%)" />
          
          <div 
            className="absolute inset-0 opacity-15 blur-[60px]" 
            style={{ 
              backgroundImage: currentTrack.cover ? `url(${currentTrack.cover})` : 'none', 
              backgroundSize: 'cover', 
              backgroundPosition: 'center' 
            }} 
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-black/90" />
          
          <div className="absolute inset-0 pointer-events-none opacity-[0.015] mix-blend-overlay" 
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")'}}
          />

          <div className="absolute top-4 left-4 text-[9px] text-white/20 uppercase tracking-widest font-mono z-50">
            {currentTrack.duration > 0 ? formatTime(currentTrack.duration) : '0:00'}
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
                className="w-48 h-48 md:w-60 md:h-60 rounded-xl overflow-hidden"
                style={{ 
                  boxShadow: `0 0 80px ${dominantColor}25, 0 20px 60px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.05)` 
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
              <div 
                className="absolute -inset-6 rounded-2xl opacity-25 blur-2xl pointer-events-none"
                style={{ 
                  background: currentTrack.cover ? `url(${currentTrack.cover})` : dominantColor,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
            </motion.div>

            <motion.div 
              initial={{ y: 15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="text-center mb-8"
            >
              <h2 className="text-4xl md:text-6xl font-serif text-white mb-3 tracking-wide" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif' }}>
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
              className="w-full"
            >
              <Waveform progress={progress} trackPath={audioSrc} isOpen={isOpen} onSeek={onSeek} />
            </motion.div>

            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.25 }}
              className="flex items-center gap-10 mt-6"
            >
              <button onClick={onPrevTrack} className="p-3 text-white/30 hover:text-white/60 transition-colors cursor-pointer">
                <SkipBack className="w-6 h-6" />
              </button>
              <button 
                onClick={onTogglePlay} 
                className="w-14 h-14 rounded-full bg-[#fdfbf7] flex items-center justify-center text-black hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,251,247,0.2),inset_0_0_0_1px_rgba(247,189,72,0.3)] cursor-pointer"
              >
                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
              </button>
              <button onClick={onNextTrack} className="p-3 text-white/30 hover:text-white/60 transition-colors cursor-pointer">
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