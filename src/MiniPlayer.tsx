import { Play, Pause, SkipBack, SkipForward, Music } from "lucide-react";

interface Track {
  id: number;
  title: string;
  artist: string;
  duration?: number;
  cover?: string;
}

interface MiniPlayerProps {
  track: Track | null;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export default function MiniPlayer({ track, isPlaying, onPlay, onPause, onPrev, onNext }: MiniPlayerProps) {
  if (!track) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-surface-container-high rounded-2xl shadow-2xl border border-surface-container-high/50 p-3 flex items-center gap-3 w-80 backdrop-blur-lg">
      <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-surface-container">
        {track.cover ? (
          <img src={track.cover} alt={track.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-outline">
            <Music className="w-6 h-6" />
          </div>
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">{track.title}</div>
        <div className="text-xs text-outline truncate">{track.artist}</div>
      </div>
      
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onPrev} className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-outline hover:text-on-surface transition-colors">
          <SkipBack className="w-4 h-4" />
        </button>
        <button onClick={isPlaying ? onPause : onPlay} className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center hover:scale-105 transition-transform">
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <button onClick={onNext} className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-outline hover:text-on-surface transition-colors">
          <SkipForward className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}