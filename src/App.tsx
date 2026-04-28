import { useState, useEffect, useRef, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { 
  Flame as Activity, Music, ListMusic as PlaylistIcon, Settings, 
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat,
  Heart, Mic, ListMusic, Volume2, VolumeX,
  ChevronLeft, ChevronRight, Search, Minus, Square, X,
  Home, Folder, Heart as HeartFilled, Plus, Trash2, Maximize2
} from "lucide-react";
import NowPlayingOverlay from "./NowPlayingOverlay";

const MUSIC_EXTENSIONS = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac', '.wma', '.aiff'];

const isMusicFile = (filename: string): boolean => {
  const ext = filename.toLowerCase();
  return MUSIC_EXTENSIONS.some(e => ext.endsWith(e));
};

export interface Track {
  id: number;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover?: string;
}

export interface Playlist {
  id: number;
  name: string;
  path: string;
  track_count: number;
  cover?: string;
}

interface Favorite {
  id: number;
  path: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  addedAt: number;
}

interface PlaybackHistory {
  track: Track;
  playedAt: number;
}

const STORAGE_KEYS = {
  libraryPath: "alora_library_path",
  favorites: "alora_favorites",
  history: "alora_history",
  volume: "alora_volume",
  repeatMode: "alora_repeat",
  shuffle: "alora_shuffle",
  playlists: "alora_playlists",
  tracks: "alora_tracks",
};

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      console.log("Loaded from storage:", key, "length:", stored.length);
      return JSON.parse(stored);
    }
    return defaultValue;
  } catch (e) {
    console.error("Failed to load from storage:", key, e);
    return defaultValue;
  }
}

function saveToStorage(key: string, value: unknown): void {
  try {
    const json = JSON.stringify(value);
    console.log("Saving to storage:", key, "length:", json.length);
    localStorage.setItem(key, json);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      console.error("Storage quota exceeded - playlist images may be too large");
    } else {
      console.error("Failed to save to storage:", e);
    }
  }
}

function SettingsPage({ libraryPath, setLibraryPath, onSave, gaplessEnabled, setGaplessEnabled, normEnabled, setNormEnabled }: { 
  libraryPath: string; 
  setLibraryPath: (path: string) => void;
  onSave: () => void;
  gaplessEnabled: boolean;
  setGaplessEnabled: (v: boolean) => void;
  normEnabled: boolean;
  setNormEnabled: (v: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState("general");
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [trayEnabled, setTrayEnabled] = useState(true);

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Music Folder",
      });
      if (selected && typeof selected === "string") {
        setLibraryPath(selected);
        saveToStorage(STORAGE_KEYS.libraryPath, selected);
      }
    } catch (e) {
      console.error("Failed to open dialog:", e);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Settings</h2>
      
      <div className="flex gap-8">
        <div className="w-48 space-y-1">
          {[
            { id: "general", label: "General", icon: Settings },
            { id: "library", label: "Library", icon: Folder },
            { id: "audio", label: "Audio", icon: Volume2 },
            { id: "playback", label: "Playback", icon: Play },
            { id: "about", label: "About", icon: Activity },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                activeTab === item.id ? "bg-white/10 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </div>
        
        <div className="flex-1 space-y-6">
          {activeTab === "general" && (
            <div className="glass-panel rounded-xl p-6 space-y-4">
              <h3 className="text-lg font-semibold text-white">General</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-on-surface">Launch on startup</div>
                    <div className="text-outline text-sm">Automatically start Ember when you log in</div>
                  </div>
                  <button 
                    onClick={() => { setStartupEnabled(!startupEnabled); saveToStorage("startupEnabled", !startupEnabled); }}
                    className={`w-12 h-6 rounded-full relative transition-colors ${startupEnabled ? "bg-primary-container" : "bg-surface-container-high"}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${startupEnabled ? "right-1" : "left-1"}`}></div>
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-on-surface">Minimize to tray</div>
                    <div className="text-outline text-sm">Keep running in the background when closed</div>
                  </div>
                  <button 
                    onClick={() => { setTrayEnabled(!trayEnabled); saveToStorage("trayEnabled", !trayEnabled); }}
                    className={`w-12 h-6 rounded-full relative transition-colors ${trayEnabled ? "bg-primary-container" : "bg-surface-container-high"}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${trayEnabled ? "right-1" : "left-1"}`}></div>
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === "library" && (
            <div className="glass-panel rounded-xl p-6 space-y-4">
              <h3 className="text-lg font-semibold text-white">Library</h3>
              <div>
                <label className="text-on-surface block mb-2">Music folder path</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={libraryPath}
                    onChange={(e) => setLibraryPath(e.target.value)}
                    className="flex-1 bg-surface-container-high rounded-lg px-4 py-2 text-on-surface border border-white/10"
                  />
                  <button 
                    onClick={handleBrowse}
                    className="px-4 py-2 bg-surface-container-high text-on-surface rounded-lg hover:bg-white/10 transition-colors"
                  >
                    Browse
                  </button>
                  <button 
                    onClick={onSave}
                    className="px-4 py-2 bg-gradient-to-r from-primary to-tertiary-container text-bg rounded-lg font-medium"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === "audio" && (
            <div className="glass-panel rounded-xl p-6 space-y-4">
              <h3 className="text-lg font-semibold text-white">Audio</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-on-surface">Volume normalization</div>
                    <div className="text-outline text-sm">Normalize audio levels</div>
                  </div>
                  <button 
                    onClick={() => setNormEnabled(!normEnabled)}
                    className={`w-12 h-6 rounded-full relative transition-colors ${normEnabled ? "bg-primary-container" : "bg-surface-container-high"}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${normEnabled ? "right-1" : "left-1"}`}></div>
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-on-surface">Gapless playback</div>
                    <div className="text-outline text-sm">Eliminate silence between tracks</div>
                  </div>
                  <button 
                    onClick={() => setGaplessEnabled(!gaplessEnabled)}
                    className={`w-12 h-6 rounded-full relative transition-colors ${gaplessEnabled ? "bg-primary-container" : "bg-surface-container-high"}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${gaplessEnabled ? "right-1" : "left-1"}`}></div>
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === "playback" && (
            <div className="glass-panel rounded-xl p-6 space-y-4">
              <h3 className="text-lg font-semibold text-white">Playback</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-on-surface block mb-2">Crossfade (seconds)</label>
                  <input type="range" min="0" max="12" className="w-full accent-primary" />
                </div>
              </div>
            </div>
          )}
          
          {activeTab === "about" && (
            <div className="glass-panel rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-gradient-to-r from-primary to-tertiary-container flex items-center justify-center">
                  <Activity className="w-8 h-8 text-bg" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Ember Music Player</h3>
                  <p className="text-outline">Electric Premium</p>
                </div>
              </div>
              <div className="space-y-2 text-sm text-outline">
                <p>Version 0.1.0</p>
                <p>A high-energy, immersive music discovery experience</p>
                <p>Built with Tauri + React</p>
              </div>
            </div>
          )}
          
          <div className="text-center pt-4">
            <span className="text-outline text-sm">Ember v0.1.0 • Flame Edition</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaylistsPage({ playlists, onSelectPlaylist, onCreatePlaylist, onEditPlaylist }: { 
  playlists: Playlist[];
  onSelectPlaylist: (playlist: Playlist) => void;
  onCreatePlaylist: () => void;
  onEditPlaylist: (playlist: Playlist) => void;
}) {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Your Playlists</h2>
        <button 
          onClick={onCreatePlaylist}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Playlist
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {playlists.map((playlist) => (
          <div key={playlist.id} className="group relative glass-panel rounded-xl p-4 hover:bg-white/10 transition-colors">
            <button onClick={() => onSelectPlaylist(playlist)} className="w-full text-left">
              <div className={`aspect-square rounded-lg mb-4 group-hover:scale-[1.02] transition-transform duration-300 flex items-center justify-center overflow-hidden ${playlist.cover?.startsWith('data:') ? '' : 'bg-gradient-to-br ' + (playlist.cover || 'from-primary/20 to-secondary-container/20')}`}>
                {playlist.cover?.startsWith('data:') ? <img src={playlist.cover} alt="" className="w-full h-full object-cover" /> : <PlaylistIcon className="w-12 h-12 text-white/50" />}
              </div>
              <div className="text-sm font-medium text-on-surface truncate">{playlist.name}</div>
              <div className="text-[11px] text-outline">{playlist.track_count} tracks</div>
            </button>
            <button onClick={() => onEditPlaylist(playlist)} className="absolute top-6 right-6 w-8 h-8 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-black/70">
              <Settings className="w-4 h-4 text-white" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryPage({ 
  tracks, 
  currentTrack, 
  isPlaying, 
  onPlayTrack,
  onPlayAll,
  onShuffle,
  favorites,
  onToggleFavorite,
  history,
  playlistName,
  playlistCover,
  sortBy,
  onSortBy,
}: { 
  tracks: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayTrack: (track: Track) => void;
  onPlayAll: () => void;
  onShuffle: () => void;
  favorites: Favorite[];
  onToggleFavorite: (track: Track) => void;
  history: PlaybackHistory[];
  playlistName?: string;
  playlistCover?: string;
  sortBy: "title" | "artist" | "album" | "duration";
  onSortBy: (sort: "title" | "artist" | "album" | "duration") => void;
}) {
  const sortedTracks = [...tracks].sort((a, b) => {
    if (sortBy === "title") return a.title.localeCompare(b.title);
    if (sortBy === "artist") return a.artist.localeCompare(b.artist);
    if (sortBy === "album") return a.album.localeCompare(b.album);
    if (sortBy === "duration") return (a.duration || 0) - (b.duration || 0);
    return 0;
  });
  return (
    <div className="p-8 bg-gradient-to-br from-primary/10 via-surface-container/30 to-secondary-container/10 rounded-xl">
      <section className="flex gap-8 mb-12">
<div className={`w-[280px] shrink-0 group relative`}>
          <div className={`aspect-square rounded-lg mb-4 flex items-center justify-center shadow-[0_20px_60px_-15px_rgba(247,189,72,0.4)] group-hover:scale-[1.02] transition-transform duration-300 overflow-hidden ring-1 ring-white/[0.05] ${playlistCover?.startsWith('data:') ? 'shadow-[0_20px_60px_-15px_rgba(247,189,72,0.3),0_0_40px_rgba(247,189,72,0.15)]' : 'bg-gradient-to-br from-primary/20 to-secondary-container/20'}`}>
            {playlistCover?.startsWith('data:') ? (
              <>
                <img src={playlistCover} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                  <button className="w-20 h-20 rounded-full bg-gradient-to-r from-primary to-tertiary-container flex items-center justify-center shadow-[0_0_30px_rgba(255,176,205,0.6)] transform translate-y-4 group-hover:translate-y-0 transition-all duration-300" onClick={onPlayAll}>
                    <Play className="w-10 h-10 text-white ml-1" fill="white" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <PlaylistIcon className="w-20 h-20 text-white/50" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                  <button className="w-20 h-20 rounded-full bg-gradient-to-r from-primary to-tertiary-container flex items-center justify-center shadow-[0_0_30px_rgba(255,176,205,0.6)] transform translate-y-4 group-hover:translate-y-0 transition-all duration-300" onClick={onPlayAll}>
                    <Play className="w-10 h-10 text-white ml-1" fill="white" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        
        <div className="flex flex-col min-h-0 justify-center">
          <span className="text-primary text-[11px] uppercase tracking-widest mb-2 block">{playlistName ? "Playlist" : "Library"}</span>
          <h2 className="text-4xl md:text-5xl font-serif text-white mb-4 leading-tight tracking-wide uppercase">{playlistName || "ALL TRACKS"}</h2>
          <p className="text-stone-500 text-[10px] font-bold mb-6 tracking-[0.2em] uppercase">{playlistName ? `${tracks.length} TRACKS` : `${tracks.length} TRACKS`}</p>
          <div className="flex items-center gap-4">
            <button onClick={onPlayAll} className="px-8 py-3 rounded-full bg-gradient-to-r from-primary to-tertiary-container text-bg text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 hover:shadow-[0_0_20px_rgba(255,176,205,0.4)] transition-shadow">
              <Play className="w-4 h-4" fill="currentColor" />
              Play All
            </button>
            <button onClick={onShuffle} className="px-6 py-3 rounded-full bg-white/10 text-on-surface text-[12px] font-semibold uppercase tracking-wider hover:bg-white/20 transition-colors">
              <Shuffle className="w-4 h-4 inline mr-2" />
              Shuffle
            </button>
          </div>
        </div>
      </section>
      
      {/* History Section */}
      {history.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[11px] text-stone-500 uppercase tracking-widest">Recently Played</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {history.slice(0, 5).map((item, idx) => (
              <button 
                key={idx}
                onClick={() => onPlayTrack(item.track)}
                className="shrink-0 flex items-center gap-3 px-3 py-2 bg-white/[0.03] backdrop-blur-sm rounded-lg hover:bg-white/[0.08] border border-white/[0.05] transition-all"
              >
                <div className="w-8 h-8 rounded bg-gradient-to-br from-primary/20 to-secondary-container/20 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-primary/50"></div>
                </div>
                <span className="text-sm text-stone-300 truncate max-w-[120px]">{item.track.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <span className="text-outline text-[11px] uppercase tracking-widest mr-2">Sort by:</span>
        {(["title", "artist", "album", "duration"] as const).map((s) => (
          <button
            key={s}
            onClick={() => onSortBy(s)}
            className={`px-3 py-1 rounded-sm text-xs transition-all duration-300 ${sortBy === s ? "text-primary/80" : "bg-transparent text-stone-500 hover:text-white"}`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[40px_1fr_150px_80px] gap-4 px-4 py-2 border-b border-white/[0.03] text-stone-600 text-[9px] uppercase tracking-widest mb-2 opacity-30">
        <div className="text-center">#</div>
        <div>Title</div>
        <div className="mr-8">Album</div>
        <div className="text-right"></div>
      </div>
      
      <div className="space-y-1 mb-12 min-h-0">
        {sortedTracks.map((track, index) => {
          const isFavorite = favorites.some(f => f.path === track.path);
          return (
            <div
              key={track.id}
              onClick={() => onPlayTrack(track)}
              className={`grid grid-cols-[40px_1fr_150px_80px] gap-4 px-4 py-3 rounded-lg items-center group cursor-pointer transition-colors relative overflow-hidden ${
                currentTrack?.id === track.id ? "bg-white/5 border border-white/5" : "hover:bg-white/5 border border-transparent"
              }`}
            >
              {currentTrack?.id === track.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>}
              <div className="text-center w-full flex justify-center">
                {currentTrack?.id === track.id && isPlaying ? (
                  <div className="w-4 h-4 relative flex items-end gap-[2px]">
                    <span className="w-[3px] bg-primary rounded-t-sm h-[8px]"></span>
                    <span className="w-[3px] bg-primary rounded-t-sm h-[14px]"></span>
                    <span className="w-[3px] bg-primary rounded-t-sm h-[10px]"></span>
                  </div>
                ) : (
                  <span className="text-outline text-sm group-hover:hidden">{index + 1}</span>
                )}
                {currentTrack?.id !== track.id && (
                  <Play className="w-4 h-4 hidden group-hover:block text-on-surface" />
                )}
              </div>
              <div className="flex items-center gap-4 overflow-hidden">
                <div className="w-10 h-10 rounded bg-surface-container-high flex items-center justify-center shrink-0 overflow-hidden">
                  {track.cover ? <img src={track.cover} alt="" className="w-full h-full object-cover" /> : <Music className="w-5 h-5 text-outline" />}
                </div>
                <div className="truncate">
                  <div className={`text-sm font-medium truncate ${currentTrack?.id === track.id ? "text-primary" : "text-on-surface group-hover:text-primary transition-colors"}`}>
                    {track.title}
                  </div>
                  <div className="text-[11px] text-outline truncate mt-0.5">{track.artist}</div>
                </div>
              </div>
              <div className="text-outline text-[12px] truncate mr-8">{track.album}</div>
              <div className="text-right text-outline text-[12px] flex items-center justify-end gap-3">
                <button 
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(track); }}
                  className="transition-colors hover:text-white"
                >
                  {isFavorite ? <HeartFilled className="w-4 h-4 text-primary fill-primary" /> : <Heart className={`w-4 h-4 ${currentTrack?.id === track.id ? "text-primary" : "opacity-0 group-hover:opacity-100"}`} />}
                </button>
                {formatDuration(track.duration)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="h-20"></div>
    </div>
  );
}

function FavoritesPage({ favorites, onPlayTrack, onRemoveFavorite }: {
  favorites: Favorite[];
  onPlayTrack: (track: Track) => void;
  onRemoveFavorite: (path: string) => void;
}) {
  if (favorites.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[400px]">
        <Heart className="w-16 h-16 text-outline mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">No favorites yet</h2>
        <p className="text-outline">Click the heart icon on any track to add it to your favorites</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-2 mb-6">
        <HeartFilled className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-bold text-white">Your Favorites</h2>
      </div>
      
      <div className="grid grid-cols-[40px_1fr_150px_80px] gap-4 px-4 py-3 border-b border-white/[0.05] text-stone-500 text-[10px] uppercase tracking-widest mb-2">
        <div className="text-center">#</div>
        <div>Title</div>
        <div className="mr-8">Added</div>
        <div className="text-right"></div>
      </div>
      
      <div className="space-y-1">
        {favorites.map((fav, index) => (
          <div
            key={fav.id}
            onClick={() => onPlayTrack({ ...fav, album: fav.album || 'Unknown', duration: fav.duration || 0 })}
            className="grid grid-cols-[40px_1fr_150px_80px] gap-4 px-4 py-3 rounded-lg items-center group cursor-pointer hover:bg-white/5 transition-colors"
          >
            <div className="text-center w-full flex justify-center">
              <span className="text-outline text-sm">{index + 1}</span>
            </div>
            <div className="flex items-center gap-4 overflow-hidden">
              <div className="w-10 h-10 rounded bg-surface-container-high flex items-center justify-center shrink-0">
                <Music className="w-5 h-5 text-outline" />
              </div>
              <div className="truncate">
                <div className="text-sm font-medium truncate text-on-surface group-hover:text-primary transition-colors">
                  {fav.title}
                </div>
                <div className="text-[11px] text-outline truncate mt-0.5">{fav.artist}</div>
              </div>
            </div>
            <div className="text-outline text-[12px] truncate mr-8">
              {new Date(fav.addedAt).toLocaleDateString()}
            </div>
            <div className="text-right">
              <button 
                onClick={(e) => { e.stopPropagation(); onRemoveFavorite(fav.path); }}
                className="text-outline hover:text-red-500 transition-colors p-2"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function CreatePlaylistModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, cover: string) => void }) {
  const [name, setName] = useState("");
  const [coverColor, setCoverColor] = useState(0);
  const [customCover, setCustomCover] = useState<string | null>(null);
  
  const colors = [
    "from-pink-500 to-purple-500",
    "from-blue-500 to-cyan-500", 
    "from-green-500 to-emerald-500",
    "from-orange-500 to-red-500",
    "from-indigo-500 to-blue-500",
    "from-rose-500 to-pink-500",
  ];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) setCustomCover(ev.target.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div className="glass-panel rounded-2xl p-8 w-[420px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Create Playlist</h2>
          <button onClick={onClose} className="text-outline hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="flex flex-col items-center mb-6">
          <div className="w-40 h-40 rounded-xl mb-4 flex items-center justify-center overflow-hidden bg-surface-container-high">
            {customCover ? (
              <img src={customCover} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className={`w-full h-full bg-gradient-to-br ${colors[coverColor]} flex items-center justify-center`}>
                <PlaylistIcon className="w-16 h-16 text-white/50" />
              </div>
            )}
          </div>
          <div className="flex gap-2 mb-2">
            {colors.map((c, i) => (
              <button key={i} onClick={() => { setCoverColor(i); setCustomCover(null); }} className={`w-8 h-8 rounded-full bg-gradient-to-br ${c} ${coverColor === i && !customCover ? 'ring-2 ring-white ring-offset-2 ring-offset-black' : ''}`} />
            ))}
          </div>
          <label className="text-primary text-sm cursor-pointer hover:underline">
            Upload Image
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          </label>
        </div>

        <div className="mb-6">
          <label className="text-outline text-sm mb-2 block">Playlist Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="My Playlist" className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-outline focus:outline-none focus:border-primary" />
        </div>

        <button onClick={() => name.trim() && onCreate(name.trim(), customCover || colors[coverColor])} disabled={!name.trim()} className="w-full py-3 bg-gradient-to-r from-primary to-purple-500 rounded-lg font-medium text-black disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity">
          Create Playlist
        </button>
      </div>
    </div>
  );
}

function EditPlaylistModal({ playlist, onClose, onSave, onDelete }: { playlist: Playlist; onClose: () => void; onSave: (updated: Playlist) => void; onDelete: () => void }) {
  const [name, setName] = useState(playlist.name);
  const [coverColor, setCoverColor] = useState(0);
  const [customCover, setCustomCover] = useState<string | null>(playlist.cover?.startsWith('data:') ? playlist.cover : null);
  
  const colors = [
    "from-pink-500 to-purple-500",
    "from-blue-500 to-cyan-500", 
    "from-green-500 to-emerald-500",
    "from-orange-500 to-red-500",
    "from-indigo-500 to-blue-500",
    "from-rose-500 to-pink-500",
  ];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) setCustomCover(ev.target.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div className="glass-panel rounded-2xl p-8 w-[420px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Edit Playlist</h2>
          <button onClick={onClose} className="text-outline hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="flex flex-col items-center mb-6">
          <div className="w-40 h-40 rounded-xl mb-4 flex items-center justify-center overflow-hidden bg-surface-container-high">
            {customCover ? (
              <img src={customCover} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className={`w-full h-full bg-gradient-to-br ${colors[coverColor]} flex items-center justify-center`}>
                <PlaylistIcon className="w-16 h-16 text-white/50" />
              </div>
            )}
          </div>
          <div className="flex gap-2 mb-2">
            {colors.map((c, i) => (
              <button key={i} onClick={() => { setCoverColor(i); setCustomCover(null); }} className={`w-8 h-8 rounded-full bg-gradient-to-br ${c} ${coverColor === i && !customCover ? 'ring-2 ring-white ring-offset-2 ring-offset-black' : ''}`} />
            ))}
          </div>
          <label className="text-primary text-sm cursor-pointer hover:underline">
            Upload Image
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          </label>
        </div>

        <div className="mb-6">
          <label className="text-outline text-sm mb-2 block">Playlist Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary" />
        </div>

        <div className="flex gap-3">
          <button onClick={onDelete} className="flex-1 py-3 bg-red-500/20 text-red-400 rounded-lg font-medium hover:bg-red-500/30 transition-colors">
            Delete
          </button>
          <button onClick={() => name.trim() && onSave({ ...playlist, name: name.trim(), cover: customCover || colors[coverColor] })} disabled={!name.trim()} className="flex-1 py-3 bg-gradient-to-r from-primary to-purple-500 rounded-lg font-medium text-black disabled:opacity-50">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState<"library" | "playlists" | "favorites" | "settings">("library");
  const [navHistory, setNavHistory] = useState<("library" | "playlists" | "favorites" | "settings")[]>(["library"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [currentPlaylist, setCurrentPlaylist] = useState<Playlist | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [tracks, setTracks] = useState<Track[]>(() => loadFromStorage(STORAGE_KEYS.tracks, []));
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadFromStorage(STORAGE_KEYS.playlists, []));
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [libraryPath, setLibraryPath] = useState(() => loadFromStorage(STORAGE_KEYS.libraryPath, "C:\\Music"));
  const [volume, setVolume] = useState(() => loadFromStorage(STORAGE_KEYS.volume, 5));
  const [progress, setProgress] = useState(0);
  const [shuffleEnabled, setShuffleEnabled] = useState(() => loadFromStorage(STORAGE_KEYS.shuffle, false));
  const [repeatMode, setRepeatMode] = useState<"none" | "all" | "one">(() => loadFromStorage(STORAGE_KEYS.repeatMode, "none"));
  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFromStorage(STORAGE_KEYS.favorites, []));
  const [history, setHistory] = useState<PlaybackHistory[]>(() => loadToStorage(STORAGE_KEYS.history, []));
  const loudnessMap = new Map<number, number>();
  const [trackLoudness, setTrackLoudness] = useState(loudnessMap);
  const [sortBy, setSortBy] = useState<"title" | "artist" | "album" | "duration">("title");
  const [gaplessEnabled, setGaplessEnabled] = useState(true);
  const [normEnabled, setNormEnabled] = useState(() => loadFromStorage("alora_normEnabled", true));
  const [showOverlay, setShowOverlay] = useState(false);
  

  setTrackLoudness;
  setGaplessEnabled;
  setNormEnabled;

  const navigateTo = (view: "library" | "playlists" | "favorites" | "settings") => {
    const newHistory = navHistory.slice(0, historyIndex + 1);
    newHistory.push(view);
    setNavHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentView(view);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setCurrentView(navHistory[historyIndex - 1]);
    }
  };

  const goForward = () => {
    if (historyIndex < navHistory.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setCurrentView(navHistory[historyIndex + 1]);
    }
  };
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressInterval = useRef<number | null>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);
  const nextTrackFnRef = useRef<(() => void) | null>(null);
  const prevTrackFnRef = useRef<(() => void) | null>(null);

  function loadToStorage<T>(key: string, defaultValue: T): T {
    return loadFromStorage(key, defaultValue);
  }

  useEffect(() => { loadLibrary(); setTimeout(() => setIsLoading(false), 2000); }, [libraryPath]);
useEffect(() => { if (libraryPath) { loadLibrary(); setTimeout(() => setIsLoading(false), 2000); } }, []);
  
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, []);
  
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => setIsPlaying(true));
      navigator.mediaSession.setActionHandler('pause', () => setIsPlaying(false));
      navigator.mediaSession.setActionHandler('previoustrack', () => prevTrackFnRef.current?.());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrackFnRef.current?.());
    }
  }, []);
  
  useEffect(() => {
    if ('mediaSession' in navigator && currentTrack) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying, currentTrack]);

  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play().catch(console.error);
        startProgressTracking();
      } else {
        audioRef.current.pause();
        stopProgressTracking();
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current && normEnabled && currentTrack?.id != null) {
      const gainDb = trackLoudness.get(currentTrack.id);
      if (gainDb !== undefined && gainDb !== 0) {
        const volumeMultiplier = Math.pow(10, gainDb / 20);
        audioRef.current.volume = Math.min(1.0, (volume / 100) * volumeMultiplier);
      } else {
        audioRef.current.volume = volume / 100;
      }
    } else if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume, normEnabled, currentTrack, trackLoudness]);

  const loadLibrary = async () => {
    try {
      const entries = await readDir(libraryPath);
      const newTracks: Track[] = [];
      const playlists: Playlist[] = [];
      let trackId = 1;
      let playlistId = 1;

      const existingByPath = new Map(tracks.map(t => [t.path, t]));

      for (const entry of entries) {
        const name = entry.name;
        const fullPath = libraryPath + (libraryPath.endsWith('\\') ? '' : '\\') + name;
        
        if (entry.isDirectory) {
          try {
            const subEntries = await readDir(fullPath);
            const trackCount = subEntries.filter(e => isMusicFile(e.name)).length;
            playlists.push({ id: playlistId++, name, path: fullPath, track_count: trackCount });
          } catch { playlists.push({ id: playlistId++, name, path: fullPath, track_count: 0 }); }
        } else {
          if (isMusicFile(name)) {
            const existing = existingByPath.get(fullPath);
            if (existing) {
              newTracks.push(existing);
              trackId = Math.max(trackId, existing.id + 1);
            } else {
              newTracks.push({ id: trackId++, path: fullPath, title: name.replace(/\.[^.]+$/, ''), artist: 'Unknown Artist', album: 'Unknown Album', duration: 0, cover: undefined });
            }
          }
        }
      }
      setTracks(newTracks);
      saveToStorage(STORAGE_KEYS.tracks, newTracks);
      setPlaylists(playlists);
      
      const loadMissingMetadata = async () => {
        const tracksWithoutMeta = newTracks.filter(t => !t.cover || t.artist === 'Unknown Artist' || t.duration === 0);
        const batchSize = 15;
        for (let i = 0; i < tracksWithoutMeta.length; i += batchSize) {
          const batch = tracksWithoutMeta.slice(i, i + batchSize);
          await Promise.all(batch.map(async (track) => {
            try {
              const meta = await invoke<{ title: string; artist: string; album: string; duration: number; cover: string | null } | null>("get_audio_metadata", { path: track.path });
              if (meta) {
                setTracks(prev => {
                  const updated = prev.map(t => t.id === track.id ? { ...t, title: meta.title, artist: meta.artist, album: meta.album, duration: meta.duration, cover: meta.cover || undefined } : t);
                  return updated;
                });
              }
            } catch {}
          }));
        }
        saveToStorage(STORAGE_KEYS.tracks, newTracks);
      };
      
      loadMissingMetadata();
    } catch (e) { 
      console.error("Failed to load library:", e);
    }
  };

  const addToHistory = useCallback((track: Track) => {
    setHistory(prev => {
      const filtered = prev.filter(h => h.track.path !== track.path);
      const updated = [{ track, playedAt: Date.now() }, ...filtered].slice(0, 50);
      saveToStorage(STORAGE_KEYS.history, updated);
      return updated;
    });
  }, []);

  const playTrack = useCallback(async (track: Track) => {
    let updatedTrack = track;
    
    if (!track.artist || track.artist === 'Unknown Artist' || !track.album || track.album === 'Unknown Album') {
      try {
        const meta = await invoke<{ title: string; artist: string; album: string; duration: number; cover: string | null } | null>("get_audio_metadata", { path: track.path });
        if (meta) {
          updatedTrack = { ...track, title: meta.title, artist: meta.artist, album: meta.album, duration: meta.duration || track.duration, cover: meta.cover || track.cover };
          setTracks(prev => {
            const updated = prev.map(t => t.id === track.id ? updatedTrack : t);
            saveToStorage(STORAGE_KEYS.tracks, updated);
            return updated;
          });
        }
      } catch (e) { console.error("Failed to load metadata:", e); }
    }
    
    if (normEnabled && !trackLoudness.has(updatedTrack.id)) {
      try {
        const loudness = await invoke<{ integrated_lufs: number; true_peak_dbtp: number; gain_db: number } | null>("get_track_loudness", { path: updatedTrack.path });
        if (loudness) {
          setTrackLoudness(prev => new Map(prev).set(updatedTrack.id, loudness.gain_db));
        }
      } catch (e) { console.error("Failed to load loudness:", e); }
    }
    
    setCurrentTrack(updatedTrack);
    setIsPlaying(true);
    addToHistory(updatedTrack);
    if (audioRef.current) {
      try {
        const src = convertFileSrc(updatedTrack.path);
        audioRef.current.src = src;
        audioRef.current.onerror = (e) => console.error("Audio error:", e);
        audioRef.current.onloadedmetadata = () => {
          if (audioRef.current && audioRef.current.duration && !updatedTrack.duration) {
            setCurrentTrack(prev => prev ? { ...prev, duration: Math.floor(audioRef.current!.duration) } : null);
          }
        };
        audioRef.current.play().catch(e => console.error("Play error:", e));
        
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: updatedTrack.title,
            artist: updatedTrack.artist,
            album: updatedTrack.album,
            artwork: updatedTrack.cover ? [{ src: updatedTrack.cover, sizes: '512x512', type: 'image/jpeg' }] : []
          });
        }
      } catch (e) {
        console.error("Failed to play:", e);
      }
    }
  }, [addToHistory]);

  const playAll = () => {
    const sorted = getSortedTracks();
    if (sorted.length > 0) playTrack(sorted[0]);
  };
  
  const shuffleTracks = () => {
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    if (shuffled.length > 0) playTrack(shuffled[0]);
  };

  const getSortedTracks = () => {
    const arr = filteredTracks.length > 0 ? filteredTracks : tracks;
    return [...arr].sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title);
      if (sortBy === "artist") return a.artist.localeCompare(b.artist);
      if (sortBy === "album") return a.album.localeCompare(b.album);
      if (sortBy === "duration") return (a.duration || 0) - (b.duration || 0);
      return 0;
    });
  };

  const nextTrack = () => {
    if (!currentTrack) return;
    const sorted = getSortedTracks();
    const currentIndex = sorted.findIndex(t => t.id === currentTrack.id);
    const nextIndex = shuffleEnabled ? Math.floor(Math.random() * sorted.length) : (currentIndex + 1) % sorted.length;
    if (sorted[nextIndex]) playTrack(sorted[nextIndex]);
  };

  const prevTrack = () => {
    if (!currentTrack) return;
    const sorted = getSortedTracks();
    const currentIndex = sorted.findIndex(t => t.id === currentTrack.id);
    const prevIndex = (currentIndex - 1 + sorted.length) % sorted.length;
    if (sorted[prevIndex]) playTrack(sorted[prevIndex]);
  };

  useEffect(() => {
    nextTrackFnRef.current = nextTrack;
    prevTrackFnRef.current = prevTrack;
  }, [nextTrack, prevTrack]);

  const togglePlay = () => {
    const sorted = getSortedTracks();
    if (!currentTrack && sorted.length > 0) playTrack(sorted[0]);
    else setIsPlaying(!isPlaying);
  };

  const startProgressTracking = () => {
    if (progressInterval.current) return;
    progressInterval.current = window.setInterval(() => {
      if (audioRef.current) {
        const currentTime = audioRef.current.currentTime;
        const duration = audioRef.current.duration;
        const currentProgress = (currentTime / duration) * 100;
        setProgress(currentProgress);
        
        if (gaplessEnabled && duration > 0 && currentTime >= duration - 0.5) {
          nextTrack();
        } else if (!gaplessEnabled && currentProgress >= 99) {
          nextTrack();
        }
      }
    }, 100);
  };

  const stopProgressTracking = () => {
    if (progressInterval.current) { clearInterval(progressInterval.current); progressInterval.current = null; }
  };

  const handleOverlaySeek = (percent: number) => {
    if (!audioRef.current || !currentTrack) return;
    const newTime = (percent / 100) * audioRef.current.duration;
    audioRef.current.currentTime = newTime;
    setProgress(percent);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !currentTrack) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = percent * audioRef.current.duration;
    setProgress(percent * 100);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value);
    setVolume(newVolume);
    saveToStorage(STORAGE_KEYS.volume, newVolume);
    if (audioRef.current) audioRef.current.volume = newVolume / 100;
  };

  const toggleMute = () => {
    if (volume > 0) { setVolume(0); if (audioRef.current) audioRef.current.volume = 0; }
    else { setVolume(70); if (audioRef.current) audioRef.current.volume = 0.7; }
  };

  const toggleRepeat = () => {
    setRepeatMode(prev => {
      const next = prev === "none" ? "all" : prev === "all" ? "one" : "none";
      saveToStorage(STORAGE_KEYS.repeatMode, next);
      return next;
    });
  };

  const toggleShuffle = () => {
    setShuffleEnabled(prev => { saveToStorage(STORAGE_KEYS.shuffle, !prev); return !prev; });
  };

  const toggleFavorite = (track: Track) => {
    setFavorites(prev => {
      const isFav = prev.some(f => f.path === track.path);
      let updated;
      if (isFav) { updated = prev.filter(f => f.path !== track.path); }
      else { updated = [{ ...track, id: Date.now(), addedAt: Date.now() }, ...prev]; }
      saveToStorage(STORAGE_KEYS.favorites, updated);
      return updated;
    });
  };

  const removeFavorite = (path: string) => {
    setFavorites(prev => {
      const updated = prev.filter(f => f.path !== path);
      saveToStorage(STORAGE_KEYS.favorites, updated);
      return updated;
    });
  };

  const handleSelectPlaylist = async (playlist: Playlist) => {
    try {
      const entries = await readDir(playlist.path);
      const newTracks: Track[] = [];
      let trackId = Date.now();
      for (const entry of entries) {
        if (isMusicFile(entry.name)) {
          const fullPath = playlist.path + (playlist.path.endsWith('\\') ? '' : '\\') + entry.name;
          newTracks.push({ id: trackId++, path: fullPath, title: entry.name.replace(/\.[^.]+$/, ''), artist: 'Unknown Artist', album: 'Unknown Album', duration: 0, cover: undefined });
        }
      }
      setTracks(newTracks);
      setCurrentView("library");
      setCurrentPlaylist(playlist);
      
      const loadMetadataParallel = async () => {
        const batchSize = 20;
        for (let i = 0; i < newTracks.length; i += batchSize) {
          const batch = newTracks.slice(i, i + batchSize);
          await Promise.all(batch.map(async (track) => {
            try {
              const meta = await invoke<{ title: string; artist: string; album: string; duration: number; cover: string | null } | null>("get_audio_metadata", { path: track.path });
              if (meta) {
                setTracks(prev => {
                  const updated = prev.map(t => t.id === track.id ? { ...t, title: meta.title, artist: meta.artist, album: meta.album, duration: meta.duration, cover: meta.cover || undefined } : t);
                  return updated;
                });
              }
            } catch {}
          }));
          saveToStorage(STORAGE_KEYS.tracks, newTracks);
        }
      };
      
      loadMetadataParallel();
      
      if (newTracks.length > 0 && newTracks[0].cover) {
        setPlaylists(prev => {
          const updated = prev.map(p => p.path === playlist.path ? { ...p, cover: newTracks[0].cover, track_count: newTracks.length } : p);
          saveToStorage(STORAGE_KEYS.playlists, updated);
          return updated;
        });
      }
    } catch (e) { console.error("Failed to load playlist:", e); }
  };

  const handleCreatePlaylist = () => {
    setShowCreatePlaylist(true);
  };

  const handleConfirmCreatePlaylist = (name: string, cover: string) => {
    const newPlaylist: Playlist = {
      id: Date.now(),
      name,
      path: "",
      track_count: 0,
      cover
    };
    setPlaylists(prev => {
      const updated = [...prev, newPlaylist];
      saveToStorage(STORAGE_KEYS.playlists, updated);
      return updated;
    });
    setShowCreatePlaylist(false);
  };

  const handleSavePlaylist = (updated: Playlist) => {
    setPlaylists(prev => {
      const newList = prev.map(p => p.id === updated.id ? updated : p);
      saveToStorage(STORAGE_KEYS.playlists, newList);
      return newList;
    });
    setEditingPlaylist(null);
  };

  const handleDeletePlaylist = () => {
    if (editingPlaylist) {
      setPlaylists(prev => {
        const newList = prev.filter(p => p.id !== editingPlaylist.id);
        saveToStorage(STORAGE_KEYS.playlists, newList);
        return newList;
      });
      setEditingPlaylist(null);
    }
  };

  const filteredTracks = searchQuery 
    ? tracks.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.artist.toLowerCase().includes(searchQuery.toLowerCase()) || t.album.toLowerCase().includes(searchQuery.toLowerCase()))
    : tracks;

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-bg flex flex-col items-center justify-center z-[100]">
        <div className="relative mb-8">
          <div className="w-24 h-24 rounded-full bg-gradient-to-r from-primary to-tertiary-container flex items-center justify-center animate-pulse">
            <Activity className="w-12 h-12 text-bg" />
          </div>
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-32 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary to-tertiary-container animate-[loading_1.5s_ease-in-out_infinite]"></div>
          </div>
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight mb-2">Ember</h1>
        <p className="text-primary text-sm uppercase tracking-widest">Loading...</p>
        <style>{`
          @keyframes loading {
            0% { width: 0%; }
            50% { width: 100%; }
            100% { width: 0%; margin-left: 100%; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg text-on-surface overflow-hidden">
      <audio ref={audioRef} />
      
      {showCreatePlaylist && <CreatePlaylistModal onClose={() => setShowCreatePlaylist(false)} onCreate={handleConfirmCreatePlaylist} />}
      {editingPlaylist && <EditPlaylistModal playlist={editingPlaylist} onClose={() => setEditingPlaylist(null)} onSave={handleSavePlaylist} onDelete={handleDeletePlaylist} />}
      
      <header className="fixed top-0 left-0 right-0 z-[60] bg-surface-container-lowest/80 backdrop-blur-md border-b border-surface-container-high/50 h-14 flex items-center justify-between pl-6 shadow-2xl" data-tauri-drag-region>
        <div className="flex items-center gap-4 w-1/3">
          <button onClick={goBack} disabled={historyIndex === 0} className={`p-2 transition-colors ${historyIndex === 0 ? 'text-white/20 cursor-not-allowed' : 'text-outline hover:text-primary'}`}><ChevronLeft className="w-5 h-5" /></button>
          <button onClick={goForward} disabled={historyIndex === navHistory.length - 1} className={`p-2 transition-colors ${historyIndex === navHistory.length - 1 ? 'text-white/20 cursor-not-allowed' : 'text-outline hover:text-primary'}`}><ChevronRight className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 flex justify-center w-1/3 max-w-xl">
          <div className="relative w-full max-w-md group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm group-focus-within:text-primary transition-colors w-4 h-4" />
            <input 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-stone-900/50 border border-outline/20 hover:border-outline/40 rounded-md py-1.5 pl-10 pr-4 text-sm text-on-surface focus:outline-none focus:bg-stone-900/80 focus:border-primary/50 transition-all placeholder-outline" 
              placeholder="Search artists, tracks, or playlists..." 
              type="text"
            />
          </div>
        </div>
        <div className="flex items-center justify-end w-1/3 h-full">
          <div className="flex items-center gap-4 mr-4">
          </div>
          <div className="flex items-center h-full">
            <button onClick={() => getCurrentWindow().minimize()} className="w-12 h-full flex items-center justify-center hover:bg-stone-800/50 transition-colors text-outline hover:text-primary"><Minus className="w-4 h-4" /></button>
            <button onClick={() => getCurrentWindow().toggleMaximize()} className="w-12 h-full flex items-center justify-center hover:bg-stone-800/50 transition-colors text-outline hover:text-primary"><Square className="w-3 h-3" /></button>
            <button onClick={() => getCurrentWindow().close()} className="w-12 h-full flex items-center justify-center hover:bg-red-900/80 hover:text-white transition-colors text-outline"><X className="w-4 h-4" /></button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 pt-14">
        <aside className="w-20 md:w-[280px] bg-surface-container-low/95 border-r border-white/[0.03] flex flex-col py-6 px-2 md:py-10 md:px-4 fixed left-0 top-14 h-[calc(100vh-3.5rem)] z-40 shadow-[10px_0_30px_-5px_rgba(0,0,0,0.8)] font-serif tracking-tight text-sm uppercase transition-all duration-300">
          <div className="px-2 md:px-6 mb-6 flex flex-col md:flex-row items-center gap-2 md:gap-4">
            <div className="w-10 h-10 md:w-14 md:h-14 rounded-full overflow-hidden border border-primary/30 shadow-[0_0_15px_rgba(247,189,72,0.3)]">
              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-secondary-container/20 flex items-center justify-center">
                <Activity className="w-5 h-5 md:w-7 md:h-7 text-primary" />
              </div>
            </div>
            <div className="hidden md:block text-center">
              <h1 className="text-primary font-bold tracking-widest text-lg">EMBER</h1>
            </div>
          </div>

          <nav className="flex-1 px-1 md:px-4 space-y-1">
            <div className="hidden md:block text-[11px] text-outline uppercase tracking-widest px-4 mb-4 mt-6">Browse</div>
            <button onClick={() => navigateTo("library")} className={`w-full flex items-center gap-2 md:gap-4 py-3 pl-4 md:pl-6 rounded-sm transition-all duration-300 ${currentView === "library" ? "text-primary font-bold border-r-[2px] border-primary shadow-[0_0_10px_rgba(212,175,55,0.4)] bg-gradient-to-r from-primary/10 to-transparent" : "text-stone-500 hover:text-primary hover:bg-stone-800/50"}`}>
              <Home className={`w-4 h-4 md:w-5 md:h-5 ${currentView === "library" ? "text-primary" : ""}`} />
              <span className="hidden md:inline">Home</span>
            </button>
            <button onClick={() => navigateTo("playlists")} className={`w-full flex items-center gap-2 md:gap-4 py-3 pl-4 md:pl-6 rounded-sm transition-all duration-300 ${currentView === "playlists" ? "text-primary font-bold border-r-[2px] border-primary shadow-[0_0_10px_rgba(212,175,55,0.4)] bg-gradient-to-r from-primary/10 to-transparent" : "text-stone-500 hover:text-primary hover:bg-stone-800/50"}`}>
              <PlaylistIcon className="w-4 h-4 md:w-5 md:h-5 text-stone-500" />
              <span className="hidden md:inline">Playlists</span>
            </button>
            <button onClick={() => navigateTo("favorites")} className={`w-full flex items-center gap-2 md:gap-4 py-3 pl-4 md:pl-6 rounded-sm transition-all duration-300 ${currentView === "favorites" ? "text-primary font-bold border-r-[2px] border-primary shadow-[0_0_10px_rgba(212,175,55,0.4)] bg-gradient-to-r from-primary/10 to-transparent" : "text-stone-500 hover:text-primary hover:bg-stone-800/50"}`}>
              <Heart className={`w-4 h-4 md:w-5 md:h-5 ${currentView === "favorites" ? "text-primary" : ""}`} />
              <span className="hidden md:inline">Favorites</span>
            </button>
          </nav>

          <div className="mt-auto px-1 md:px-4 space-y-1 pb-20 md:pb-24">
            <div className="hidden md:block text-[11px] text-outline uppercase tracking-widest px-4 mb-4">System</div>
            <button onClick={() => navigateTo("settings")} className={`w-full flex items-center gap-2 md:gap-4 py-3 pl-4 md:pl-6 rounded-sm transition-all duration-300 ${currentView === "settings" ? "text-primary font-bold border-r-[2px] border-primary shadow-[0_0_10px_rgba(212,175,55,0.4)] bg-gradient-to-r from-primary/10 to-transparent" : "text-stone-500 hover:text-primary hover:bg-stone-800/50"}`}>
              <Settings className="w-4 h-4 md:w-5 md:h-5" />
              <span className="hidden md:inline">Settings</span>
            </button>
          </div>
        </aside>

        <main className="flex-1 ml-20 md:ml-[280px] relative h-[calc(100vh-3.5rem)] overflow-y-auto pb-20 md:pb-24 p-3 md:p-8 border-t border-white/[0.03]">
          <div className="fixed inset-0 pointer-events-none z-[-1] opacity-40 mix-blend-overlay" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")'}}></div>
          <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary-container/5 pointer-events-none z-[-1]"></div>
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[150px] pointer-events-none z-[-1]"></div>
          <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-primary/10 to-transparent pointer-events-none"></div>

          <div className="max-w-7xl mx-auto">
            {currentView === "library" && (
              <LibraryPage 
                tracks={filteredTracks}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                onPlayTrack={playTrack}
                onPlayAll={playAll}
                onShuffle={shuffleTracks}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                history={history}
                playlistName={currentPlaylist?.name}
                playlistCover={currentPlaylist?.cover}
                sortBy={sortBy}
                onSortBy={setSortBy}
              />
            )}
            {currentView === "playlists" && (
              <PlaylistsPage 
                playlists={playlists}
                onSelectPlaylist={handleSelectPlaylist}
                onCreatePlaylist={handleCreatePlaylist}
                onEditPlaylist={setEditingPlaylist}
              />
            )}
            {currentView === "favorites" && (
              <FavoritesPage 
                favorites={favorites}
                onPlayTrack={playTrack}
                onRemoveFavorite={removeFavorite}
              />
            )}
            {currentView === "settings" && (
              <SettingsPage 
                libraryPath={libraryPath}
                setLibraryPath={setLibraryPath}
                onSave={loadLibrary}
                gaplessEnabled={gaplessEnabled}
                setGaplessEnabled={setGaplessEnabled}
                normEnabled={normEnabled}
                setNormEnabled={setNormEnabled}
              />
            )}
          </div>
        </main>
      </div>

      <footer className="fixed bottom-0 w-full z-50 border-t border-surface-container-high/30 bg-surface-container-lowest/80 backdrop-blur-xl shadow-[0_-10px_20px_rgba(0,0,0,0.5)] h-16 md:h-24 px-3 md:px-12 flex items-center justify-between text-xs uppercase tracking-widest text-white/60">
        <div className="flex items-center gap-2 md:gap-4 w-1/3 min-w-0">
          <div className="relative group hidden md:block">
            {currentTrack?.cover ? <img src={currentTrack.cover} alt="" className="w-12 h-12 md:w-16 md:h-16 rounded-xl object-cover shrink-0 shadow-[0_0_15px_rgba(247,189,72,0.2)] cursor-pointer" onClick={() => setShowOverlay(true)} /> : <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl bg-gradient-to-br from-primary/10 to-secondary-container/20 border border-white/[0.05] shrink-0 cursor-pointer" onClick={() => setShowOverlay(true)}></div>}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-md cursor-pointer" onClick={() => setShowOverlay(true)}>
              <Maximize2 className="w-4 h-4 text-white" />
            </div>
          </div>
          <div className="min-w-0 truncate">
            <div className="text-xs md:text-sm text-white font-medium truncate mb-0.5 md:mb-1">{currentTrack?.title || "No track"}</div>
            <div className="text-[10px] md:text-[11px] text-outline truncate hover:underline cursor-pointer">{currentTrack?.artist || "Select a track"}</div>
          </div>
          {currentTrack && (
            <button onClick={() => toggleFavorite(currentTrack)} className="text-primary ml-2 hover:scale-110 transition-transform p-1">
              {favorites.some(f => f.path === currentTrack?.path) ? <HeartFilled className="w-3 h-4" fill="currentColor" /> : <Heart className="w-3 h-4" />}
            </button>
          )}
        </div>

        <div className="flex flex-col items-center justify-center w-full max-w-xl px-1 md:px-4 flex-1">
          <div className="flex items-center gap-2 md:gap-4 lg:gap-6 mb-1 md:mb-2">
            <button onClick={toggleShuffle} className={`text-white/40 hover:text-white/70 transition-colors p-1 md:p-2 active:scale-90 hidden sm:block ${shuffleEnabled ? "text-primary" : ""}`} title="Shuffle">
              <Shuffle className="w-4 h-4 md:w-5 md:h-5" />
            </button>
            <button onClick={prevTrack} className="text-white/60 hover:text-primary transition-colors p-1 md:p-2 active:scale-90" title="Previous">
              <SkipBack className="w-5 h-5 md:w-7 md:h-7" />
            </button>
            <button onClick={togglePlay} className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-white flex items-center justify-center text-black hover:scale-105 active:scale-95 transition-all shadow-[0_0_15px_rgba(255,255,255,0.3)]" title="Play">
              {isPlaying ? <Pause className="w-5 h-5 md:w-7 md:h-7" /> : <Play className="w-5 h-5 md:w-7 md:h-7 ml-0.5" />}
            </button>
            <button onClick={nextTrack} className="text-white/60 hover:text-primary transition-colors p-1 md:p-2 active:scale-90" title="Next">
              <SkipForward className="w-5 h-5 md:w-7 md:h-7" />
            </button>
            <button onClick={toggleRepeat} className={`text-white/40 hover:text-white/70 transition-colors p-1 md:p-2 active:scale-90 hidden sm:block ${repeatMode !== "none" ? "text-primary" : ""}`} title="Repeat">
              <Repeat className={`w-4 h-4 md:w-5 md:h-5 ${repeatMode === "one" ? "scale-125" : ""}`} />
            </button>
          </div>
          <div className="w-full flex items-center gap-1 md:gap-3 text-[10px] md:text-[11px] normal-case tracking-normal">
            <span className="text-outline w-6 md:w-8 text-right">{formatDuration(currentTrack ? Math.floor((progress / 100) * currentTrack.duration) : 0)}</span>
            <div className="flex-1 h-1 md:h-1.5 bg-white/[0.1] rounded-full overflow-hidden group cursor-pointer relative" onClick={handleProgressClick}>
              <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary to-secondary shadow-[0_0_10px_rgba(247,189,72,0.5)] transition-all" style={{ width: `${progress}%` }}></div>
              <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 md:w-3 md:h-3 bg-white rounded-full shadow-[0_0_8px_rgba(247,189,72,0.8)] opacity-0 group-hover:opacity-100 transform -translate-x-1 transition-all" style={{ left: `${progress}%` }}></div>
              <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-primary rounded-full shadow-[0_0_6px_rgba(247,189,72,1)] transform -translate-x-1/2" style={{ left: `${progress}%` }}></div>
            </div>
            <span className="text-outline w-6 md:w-8">{currentTrack ? formatDuration(currentTrack.duration) : "0:00"}</span>
          </div>
        </div>

        <div className="hidden lg:flex items-center justify-end gap-4 md:gap-6 w-1/3">
          <button className="text-white/60 hover:text-primary transition-colors p-1 md:p-2 active:scale-90" title="Lyrics">
            <Mic className="w-4 h-4 md:w-5 md:h-5" />
          </button>
          <button className="text-white/60 hover:text-primary transition-colors p-1 md:p-2 active:scale-90" title="Queue">
            <ListMusic className="w-4 h-4 md:w-5 md:h-5" />
          </button>
          <div className="flex items-center gap-1 md:gap-2 w-20 md:w-32 group">
            <button onClick={toggleMute} className="text-white/60 hover:text-primary transition-colors p-1" title="Volume">
              {volume === 0 ? <VolumeX className="w-3 h-4 md:w-4 md:h-4" /> : <Volume2 className="w-3 h-4 md:w-4 md:h-4" />}
            </button>
            <input type="range" min="0" max="100" value={volume} onChange={handleVolumeChange} className="flex-1 h-1 md:h-1.5 rounded-full appearance-none cursor-pointer" style={{ background: `linear-gradient(to right, #f7bd48 0%, #f7bd48 ${volume}%, rgba(255,255,255,0.1) ${volume}%, rgba(255,255,255,0.1) 100%)`, WebkitAppearance: 'none' }} />
          </div>
</div>
        </footer>

      <NowPlayingOverlay
        isOpen={showOverlay}
        onClose={() => setShowOverlay(false)}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        progress={progress}
        onTogglePlay={togglePlay}
        onPrevTrack={prevTrack}
        onNextTrack={nextTrack}
        onSeek={handleOverlaySeek}
      />
    </div>
  );
}

export default App;