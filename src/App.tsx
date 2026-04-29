import { useState, useEffect, useRef, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { 
  Activity, Music, ListMusic as PlaylistIcon, Settings,
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat,
  Heart, Mic, ListMusic, Volume2, VolumeX,
  ChevronLeft, ChevronRight, Search, Minus, Square, X,
  Home, Folder, Heart as HeartFilled, Plus, Trash2, Maximize2, MoreHorizontal,
  Download, Loader2
} from "lucide-react";
import NowPlayingOverlay from "./NowPlayingOverlay";

function generatePlaylistCover(tracks: Track[]): string | null {
  const tracksWithCover = tracks.filter(t => t.cover && t.cover.startsWith('data:')).slice(0, 4);
  if (tracksWithCover.length === 0) return null;
  
  const canvas = document.createElement('canvas');
  const size = 200;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  
  const cols = 2;
  const rows = 2;
  const cellW = size / cols;
  const cellH = size / rows;
  
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, size, size);
  
  tracksWithCover.forEach((track, i) => {
    const img = new Image();
    img.src = track.cover!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH);
  });
  
  return canvas.toDataURL('image/jpeg', 0.7);
}

function getAverageColor(imageSrc: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve('#1a1a1a'); return; }
      canvas.width = 50;
      canvas.height = 50;
      ctx.drawImage(img, 0, 0, 50, 50);
      const data = ctx.getImageData(0, 0, 50, 50).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
      const count = data.length / 4;
      r = Math.floor(r / count);
      g = Math.floor(g / count);
      b = Math.floor(b / count);
      resolve(`rgb(${r}, ${g}, ${b})`);
    };
    img.onerror = () => resolve('#1a1a1a');
    img.src = imageSrc;
  });
}

function darkenColor(color: string, amount: number): string {
  const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (match) {
    const r = Math.floor(parseInt(match[1]) * (1 - amount));
    const g = Math.floor(parseInt(match[2]) * (1 - amount));
    const b = Math.floor(parseInt(match[3]) * (1 - amount));
    return `rgb(${r}, ${g}, ${b})`;
  }
  return color;
}

const MUSIC_EXTENSIONS = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac', '.wma', '.aiff'];
const COVER_EXTENSIONS = ['cover.jpg', 'folder.jpg', 'album.jpg', 'front.jpg', 'cover.png', 'folder.png', 'album.png', 'front.png', 'cover.jpeg', 'folder.jpeg', 'album.jpeg', 'front.jpeg'];

const isMusicFile = (filename: string): boolean => {
  const ext = filename.toLowerCase();
  return MUSIC_EXTENSIONS.some(e => ext.endsWith(e));
};

const isImageFile = (filename: string): boolean => {
  const name = filename.toLowerCase();
  return COVER_EXTENSIONS.some(e => name === e) || name.match(/^(cover|folder|album|front)\.(jpg|jpeg|png)$/i) !== null;
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
  trackCovers?: string[];
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
    if (key === STORAGE_KEYS.history && json.length > 100000) return;
    if (json.length > 5000000) return;
    console.log("Saving to storage:", key, "length:", json.length);
    localStorage.setItem(key, json);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      console.error("Storage quota exceeded");
    }
  }
}

interface YouTubeTrack {
  id: string;
  title: string;
  artist: string;
  duration_secs: number;
  thumbnail: string;
  url: string;
}

function SearchPage({ onPlayTrack }: { onPlayTrack: (track: Track) => void }) {
  const [query, setQuery] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [results, setResults] = useState<YouTubeTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");

  const handleDownloadUrl = async () => {
    if (!urlInput.trim()) return;
    setDownloading("url");
    try {
      const downloadPath = "E:\\onyx\\lib\\downloads";
      const result = await invoke<string>("download_youtube", { url: urlInput.trim(), outputDir: downloadPath });
      setError("");
      setUrlInput("");
      alert("Downloaded: " + result);
    } catch (e) {
      console.error("Download failed:", e);
      setError("Download failed: " + e);
    } finally {
      setDownloading(null);
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    
    setLoading(true);
    setError("");
    
    try {
      const searchResults = await invoke<YouTubeTrack[]>("search_youtube", { query: query.trim() });
      setResults(searchResults);
    } catch (e) {
      console.error("Search failed:", e);
      setError("Search failed. Make sure yt-dlp is installed.");
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (track: YouTubeTrack) => {
    const newTrack: Track = {
      id: parseInt(track.id.slice(-8), 16) || Date.now(),
      path: track.url,
      title: track.title,
      artist: track.artist,
      album: 'YouTube',
      duration: track.duration_secs,
      cover: track.thumbnail || undefined
    };
    onPlayTrack(newTrack);
  };

  const handleDownload = async (track: YouTubeTrack) => {
    setDownloading(track.id);
    try {
      const downloadPath = "E:\\onyx\\lib\\downloads";
      await invoke<string>("download_youtube", { url: track.url, outputDir: downloadPath });
    } catch (e) {
      console.error("Download failed:", e);
      setError("Download failed: " + e);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">YouTube Music</h2>
      
      <div className="mb-6 p-4 bg-surface-container-high rounded-lg">
        <h3 className="text-white font-medium mb-3">Download by URL</h3>
        <div className="flex gap-3">
          <input 
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleDownloadUrl()}
            placeholder="YouTube URL..."
            className="flex-1 px-4 py-2 bg-surface rounded-lg text-white placeholder-text-outline focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button 
            onClick={handleDownloadUrl}
            disabled={downloading === "url"}
            className="px-4 py-2 bg-green-500 text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
          >
            {downloading === "url" ? "Downloading..." : "Download"}
          </button>
        </div>
      </div>
      
      <div className="flex gap-3 mb-8">
        <input 
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search YouTube..."
          className="flex-1 px-4 py-3 bg-surface-container-high rounded-lg text-white placeholder-text-outline focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button 
          onClick={handleSearch}
          disabled={loading}
          className="px-6 py-3 bg-primary text-black rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {error && (
        <div className="text-red-400 mb-4">{error}</div>
      )}

      <div className="space-y-2">
        {results.map((track) => (
          <div 
            key={track.id}
            className="flex items-center gap-4 p-3 bg-surface-container-high rounded-lg hover:bg-surface-container-high/80 cursor-pointer group"
          >
            <div className="w-12 h-12 bg-surface-container rounded overflow-hidden shrink-0 relative" onClick={() => handlePlay(track)}>
              {track.thumbnail ? (
                <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-surface">
                  <Music className="w-6 h-6 text-outline" />
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                <Play className="w-8 h-8 text-white" fill="white" />
              </div>
            </div>
            <div className="flex-1 min-w-0" onClick={() => handlePlay(track)}>
              <div className="text-white font-medium truncate group-hover:text-primary">{track.title}</div>
              <div className="text-outline text-sm truncate">{track.artist}</div>
            </div>
            <div className="text-outline text-sm shrink-0">
              {Math.floor(track.duration_secs / 60)}:{String(track.duration_secs % 60).padStart(2, '0')}
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); handleDownload(track); }}
              disabled={downloading === track.id}
              className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
              title="Download to library"
            >
              {downloading === track.id ? (
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              ) : (
                <Download className="w-5 h-5 text-white" />
              )}
            </button>
          </div>
        ))}
      </div>

      {results.length === 0 && !loading && query && (
        <div className="text-center text-outline mt-8">
          No results found. Make sure yt-dlp is installed.
        </div>
      )}
    </div>
  );
}

function SettingsPage({ libraryPath, setLibraryPath, onSave, gaplessEnabled, setGaplessEnabled, normEnabled, setNormEnabled, eqEnabled, setEqEnabled, eqPreset, setEqPreset, eqBands, setEqBands, EQ_PRESETS, EQ_FREQUENCIES }: { 
  libraryPath: string; 
  setLibraryPath: (path: string) => void;
  onSave: () => void;
  gaplessEnabled: boolean;
  setGaplessEnabled: (v: boolean) => void;
  normEnabled: boolean;
  setNormEnabled: (v: boolean) => void;
  eqEnabled: boolean;
  setEqEnabled: (v: boolean) => void;
  eqPreset: string;
  setEqPreset: (v: string) => void;
  eqBands: number[];
  setEqBands: (v: number[]) => void;
  EQ_PRESETS: Record<string, number[]>;
  EQ_FREQUENCIES: number[];
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
                    <div className="text-outline text-sm">v0.1.0</div>
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
                
                <div className="border-t border-white/10 pt-4 mt-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-on-surface">Equalizer</div>
                      <div className="text-outline text-sm">Adjust audio frequencies</div>
                    </div>
                    <button 
                      onClick={() => setEqEnabled(!eqEnabled)}
                      className={`w-12 h-6 rounded-full relative transition-colors ${eqEnabled ? "bg-primary-container" : "bg-surface-container-high"}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${eqEnabled ? "right-1" : "left-1"}`}></div>
                    </button>
                  </div>
                  
                  {eqEnabled && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {Object.keys(EQ_PRESETS).map((preset) => (
                          <button
                            key={preset}
                            onClick={() => { setEqPreset(preset); setEqBands(EQ_PRESETS[preset]); }}
                            className={`px-3 py-1 rounded-full text-xs capitalize ${
                              eqPreset === preset ? "bg-primary text-black" : "bg-surface-container-high text-on-surface"
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      
                      <div className="flex justify-between gap-2">
                        {eqBands.map((value, index) => (
                          <div key={index} className="flex flex-col items-center">
                            <input
                              type="range"
                              min="-12"
                              max="12"
                              value={value}
                              onChange={(e) => {
                                const newBands = [...eqBands];
                                newBands[index] = parseInt(e.target.value);
                                setEqBands(newBands);
                                setEqPreset("custom");
                              }}
                              className="h-32 w-4 -rotate-180 accent-primary"
                              style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                            />
                            <span className="text-[10px] text-outline mt-1">{value > 0 ? `+${value}` : value}</span>
                            <span className="text-[8px] text-outline">{EQ_FREQUENCIES[index] >= 1000 ? `${EQ_FREQUENCIES[index]/1000}k` : EQ_FREQUENCIES[index]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
                  <Music className="w-8 h-8 text-bg" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Music Player</h3>
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
            <span className="text-outline text-sm">v0.1.0</span>
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
  allPlaylists,
  onSelectPlaylist,
  playlistCovers,
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
  allPlaylists?: Playlist[];
  onSelectPlaylist?: (playlist: Playlist) => void;
  playlistCovers?: Record<string, string[]>;
}) {
  const [bgColor, setBgColor] = useState<string>('rgba(26, 26, 26, 1)');
  
  useEffect(() => {
    const firstTrackWithCover = tracks.find(t => t.cover && t.cover.startsWith('data:'));
    if (firstTrackWithCover?.cover) {
      getAverageColor(firstTrackWithCover.cover).then(color => {
        setBgColor(color);
      });
    } else {
      setBgColor('rgba(26, 26, 26, 1)');
    }
  }, [tracks]);
  
  const totalDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const hours = Math.floor(totalDuration / 3600);
  const minutes = Math.floor((totalDuration % 3600) / 60);
  const durationText = hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`;
  
  const sortedTracks = [...tracks].sort((a, b) => {
    if (sortBy === "title") return a.title.localeCompare(b.title);
    if (sortBy === "artist") return a.artist.localeCompare(b.artist);
    if (sortBy === "album") return a.album.localeCompare(b.album);
    if (sortBy === "duration") return (a.duration || 0) - (b.duration || 0);
    return 0;
  });
  
if (!playlistName && allPlaylists && allPlaylists.length > 0) {
    const recentPlaylistPaths = new Set(history.slice(0, 10).map(h => h.track.path.split('\\').slice(0, -1).join('\\')));
    const recentPlaylists = allPlaylists.filter(p => recentPlaylistPaths.has(p.path));
    const otherPlaylists = allPlaylists.filter(p => !recentPlaylistPaths.has(p.path));
    
    return (
      <div className="p-8">
        {recentPlaylists.length > 0 && (
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[11px] text-stone-500 uppercase tracking-widest">Recently Played</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {recentPlaylists.map((playlist) => (
                <button 
                  key={playlist.id}
                  onClick={() => onSelectPlaylist?.(playlist)}
                  className="group text-left p-4 rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors"
                >
                  <div className="aspect-square rounded-lg overflow-hidden bg-surface-container-high mb-3 shadow-lg group-hover:scale-[1.02] transition-transform">
                    {playlistCovers?.[playlist.path]?.[0] ? (
                      <img src={playlistCovers[playlist.path][0]} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-surface-container-high to-surface flex items-center justify-center">
                        <PlaylistIcon className="w-10 h-10 text-white/30" />
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-on-surface truncate group-hover:text-primary transition-colors font-medium">{playlist.name}</div>
                  <div className="text-xs text-outline truncate">{playlist.track_count} tracks</div>
                </button>
              ))}
            </div>
          </div>
        )}
        
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[11px] text-stone-500 uppercase tracking-widest">All Playlists</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {otherPlaylists.map((playlist) => (
              <button 
                key={playlist.id}
                onClick={() => onSelectPlaylist?.(playlist)}
                className="group text-left"
              >
                <div className="aspect-square rounded-lg overflow-hidden bg-surface-container-high mb-3 shadow-lg group-hover:scale-[1.02] transition-transform">
                  {playlistCovers?.[playlist.path]?.[0] ? (
                    <img src={playlistCovers[playlist.path][0]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-surface-container-high to-surface flex items-center justify-center">
                      <PlaylistIcon className="w-16 h-16 text-white/30" />
                    </div>
                  )}
                </div>
                <div className="text-sm font-medium text-on-surface truncate group-hover:text-primary transition-colors">{playlist.name}</div>
                <div className="text-xs text-outline truncate">{playlist.track_count} tracks</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden">
      <div 
        className="p-8 pb-32 relative overflow-hidden"
        style={{ 
          background: `linear-gradient(180deg, ${bgColor} 0%, ${darkenColor(bgColor, 0.7)} 100%)`
        }}
      >
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}></div>
        
        <section className="relative z-10 flex gap-8 items-end">
          <div 
            className="w-52 h-52 md:w-60 md:h-60 shrink-0 rounded-lg overflow-hidden shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] group cursor-pointer relative"
            onClick={onPlayAll}
          >
            {playlistCover?.startsWith('data:') ? (
              <img src={playlistCover} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-surface-container-high to-surface-container flex items-center justify-center">
                <PlaylistIcon className="w-20 h-20 text-white/30" />
              </div>
            )}
          </div>
          
          <div className="flex flex-col min-h-0 justify-end flex-1">
            <span className="text-white/70 text-xs uppercase tracking-wider mb-2">Playlist</span>
            <h2 className="text-4xl md:text-6xl font-bold text-white mb-4 leading-tight tracking-tight">
              {playlistName || "All Tracks"}
            </h2>
            <p className="text-white/60 text-sm mb-6">
              {tracks.length} tracks, <span className="text-white/50">{durationText}</span>
            </p>
            <div className="flex items-center gap-4">
              <button 
                onClick={onPlayAll} 
                className="w-14 h-14 rounded-full bg-primary flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg"
              >
                <Play className="w-6 h-6 text-black ml-1" fill="currentColor" />
              </button>
              <button 
                onClick={onShuffle} 
                className="text-white/50 hover:text-white transition-colors"
              >
                <Shuffle className="w-8 h-8" />
              </button>
            </div>
          </div>
        </section>
      </div>
      
      <div className="bg-gradient-to-b from-surface-container/50 to-bg px-8 pt-8 -mt-20 relative z-20">

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
                className={`grid grid-cols-[30px_1fr_120px_60px] gap-2 px-2 py-2 rounded-lg items-center group cursor-pointer transition-colors relative overflow-hidden ${
                  currentTrack?.id === track.id ? "bg-white/5 border border-white/5" : "hover:bg-white/5 border border-transparent"
                }`}
              >
                {currentTrack?.id === track.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>}
                <div className="text-center w-full flex justify-center">
                  {currentTrack?.id === track.id && isPlaying ? (
                    <div className="w-3 h-3 relative flex items-end gap-[1px]">
                      <span className="w-[2px] bg-primary rounded-t-sm h-[6px]"></span>
                      <span className="w-[2px] bg-primary rounded-t-sm h-[10px]"></span>
                      <span className="w-[2px] bg-primary rounded-t-sm h-[8px]"></span>
                    </div>
                  ) : (
                    <span className="text-outline text-xs group-hover:hidden">{index + 1}</span>
                  )}
                  {currentTrack?.id !== track.id && (
                    <Play className="w-3 h-3 hidden group-hover:block text-on-surface" />
                  )}
                </div>
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-8 h-8 rounded bg-surface-container-high flex items-center justify-center shrink-0 overflow-hidden">
                    {track.cover ? <img src={track.cover} alt="" className="w-full h-full object-cover" /> : <Music className="w-4 h-4 text-outline" />}
                  </div>
                  <div className="truncate">
                    <div className={`text-xs font-medium truncate ${currentTrack?.id === track.id ? "text-primary" : "text-on-surface group-hover:text-primary transition-colors"}`}>
                      {track.title}
                    </div>
                    <div className="text-[10px] text-outline truncate mt-0.5">{track.artist}</div>
                  </div>
                </div>
                <div className="text-outline text-[11px] truncate mr-4">{track.album}</div>
                <div className="text-right text-outline text-[11px] flex items-center justify-end gap-2">
                  <button 
                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(track); }}
                    className="transition-colors hover:text-white p-1"
                  >
                    {isFavorite ? <HeartFilled className="w-3 h-3 text-primary fill-primary" /> : <Heart className={`w-3 h-3 ${currentTrack?.id === track.id ? "text-primary" : "opacity-0 group-hover:opacity-100"}`} />}
                  </button>
                  {formatDuration(track.duration)}
                </div>
              </div>
            );
          })}
        </div>
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
  const [currentView, setCurrentView] = useState<"library" | "playlists" | "favorites" | "settings" | "search">("library");
  const [navHistory, setNavHistory] = useState<("library" | "playlists" | "favorites" | "settings" | "search")[]>(["library"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [currentPlaylist, setCurrentPlaylist] = useState<Playlist | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarPlaylistView, setSidebarPlaylistView] = useState<"compact" | "expanded">("expanded");
  const [titlebarHeight, setTitlebarHeight] = useState(56);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [playlistCovers, setPlaylistCovers] = useState<Record<string, string[]>>(() => loadFromStorage("alora_playlistCovers", {}));
  const [rightSidebarBg, setRightSidebarBg] = useState<string>('rgba(14, 14, 14, 1)');
  
  const [tracks, setTracks] = useState<Track[]>(() => loadFromStorage(STORAGE_KEYS.tracks, []));
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadFromStorage(STORAGE_KEYS.playlists, []));
  
useEffect(() => {
    const loadCovers = async () => {
      for (const playlist of playlists) {
        try {
          const entries = await readDir(playlist.path);
          let folderCover: string | undefined;
          for (const entry of entries) {
            if (!folderCover && isImageFile(entry.name)) {
              try {
                const imagePath = playlist.path + (playlist.path.endsWith('\\') ? '' : '\\') + entry.name;
                const imageData = await readFile(imagePath);
                let binary = '';
                const bytes = new Uint8Array(imageData);
                for (let i = 0; i < bytes.byteLength; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);
                const ext = entry.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                folderCover = `data:${ext};base64,${base64}`;
              } catch {}
            }
          }
          if (folderCover) {
            setPlaylistCovers(prev => ({ ...prev, [playlist.path]: [folderCover] }));
            continue;
          }
        } catch {}
        
        const folderPath = playlist.path.substring(0, playlist.path.lastIndexOf('\\'));
        const playlistTracks = tracks.filter(t => {
          const trackFolder = t.path.substring(0, t.path.lastIndexOf('\\'));
          return trackFolder === folderPath;
        });
        
        const existingCovers = playlistTracks
          .filter(t => t.cover && t.cover.startsWith('data:'))
          .slice(0, 4)
          .map(t => t.cover!);
        
        if (existingCovers.length > 0) {
          setPlaylistCovers(prev => ({ ...prev, [playlist.path]: existingCovers }));
          continue;
        }
        
        const tracksToLoad = playlistTracks.slice(0, 4);
        const loadedCovers: string[] = [];
        
        for (const track of tracksToLoad) {
          if (!track.cover || track.artist === 'Unknown Artist') {
            try {
              const meta = await invoke<{ title: string; artist: string; album: string; duration: number; cover: string | null } | null>("get_audio_metadata", { path: track.path });
              if (meta) {
                setTracks(prev => prev.map(t => t.path === track.path ? { ...t, title: meta.title || t.title, artist: meta.artist || t.artist, album: meta.album || t.album, duration: meta.duration || t.duration, cover: meta.cover || t.cover } : t));
                if (meta.cover) {
                  loadedCovers.push(meta.cover);
                  setPlaylistCovers(prev => ({ ...prev, [playlist.path]: [...(prev[playlist.path] || []), meta.cover!] }));
                  if (loadedCovers.length >= 4) break;
                }
              }
            } catch {}
          }
        }
        
        if (loadedCovers.length === 0) {
          const updatedCovers = playlistTracks
            .filter(t => t.cover && t.cover.startsWith('data:'))
            .slice(0, 4)
            .map(t => t.cover!);
          if (updatedCovers.length > 0) {
            setPlaylistCovers(prev => ({ ...prev, [playlist.path]: updatedCovers }));
          }
        }
      }
    };
    if (playlists.length > 0 && tracks.length > 0) {
      loadCovers();
    }
  }, [playlists.length, tracks.length]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [libraryPath, setLibraryPath] = useState(() => loadFromStorage(STORAGE_KEYS.libraryPath, "C:\\Music"));
  const [volume, setVolume] = useState(() => loadFromStorage(STORAGE_KEYS.volume, 5));
  const [progress, setProgress] = useState(0);
  const [shuffleEnabled, setShuffleEnabled] = useState(() => loadFromStorage(STORAGE_KEYS.shuffle, false));
  const [repeatMode, setRepeatMode] = useState<"none" | "all" | "one">(() => loadFromStorage(STORAGE_KEYS.repeatMode, "none"));
  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFromStorage(STORAGE_KEYS.favorites, []));
  const [history, setHistory] = useState<PlaybackHistory[]>(() => loadToStorage(STORAGE_KEYS.history, []));
  const loudnessMap = new Map<string, number>();
  const [trackLoudness, setTrackLoudness] = useState(loudnessMap);
  const [sortBy, setSortBy] = useState<"title" | "artist" | "album" | "duration">("title");
const [gaplessEnabled, setGaplessEnabled] = useState(true);
  const [normEnabled, setNormEnabled] = useState(() => loadFromStorage("alora_normEnabled", true));
  const [showOverlay, setShowOverlay] = useState(false);
  
  const [eqEnabled, setEqEnabled] = useState(() => loadFromStorage("alora_eqEnabled", false));
  const [eqPreset, setEqPreset] = useState(() => loadFromStorage("alora_eqPreset", "flat"));
  const [eqBands, setEqBands] = useState(() => loadFromStorage("alora_eqBands", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  
  const EQ_PRESETS: Record<string, number[]> = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
    treble: [0, 0, 0, 0, 2, 4, 5, 6, 6, 6],
    vocal: [-1, 0, 2, 4, 5, 5, 4, 2, 0, -1],
    rock: [4, 3, 1, 0, -1, 0, 2, 4, 5, 5],
    electronic: [4, 4, 1, -1, -2, 0, 2, 4, 5, 6],
    classical: [0, 0, 0, 0, 0, -1, -2, -2, -1, 0],
    jazz: [2, 1, 0, 1, -1, -1, 0, 1, 2, 3],
  };
  
  const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  
setTrackLoudness;
setGaplessEnabled;
  setNormEnabled;
  setEqEnabled;
  setEqBands;

  useEffect(() => { saveToStorage("alora_eqEnabled", eqEnabled); }, [eqEnabled]);
  useEffect(() => { saveToStorage("alora_eqPreset", eqPreset); }, [eqPreset]);
  useEffect(() => { saveToStorage("alora_eqBands", eqBands); }, [eqBands]);

  const navigateTo = (view: "library" | "playlists" | "favorites" | "settings" | "search") => {
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const gainNodeRef = useRef<GainNode | null>(null);
  const progressInterval = useRef<number | null>(null);

  const setupAudioWithEQ = useCallback(() => {
    if (!audioRef.current || audioContextRef.current) return;
    
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      
      const source = ctx.createMediaElementSource(audioRef.current);
      audioSourceRef.current = source;
      
      const filters: BiquadFilterNode[] = [];
      let lastNode: AudioNode = source;
      
      const frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
      for (let i = 0; i < 10; i++) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = frequencies[i];
        filter.Q.value = 1.4;
        filter.gain.value = 0;
        
        lastNode.connect(filter);
        lastNode = filter;
        filters.push(filter);
      }
      
      eqFiltersRef.current = filters;
      
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1;
      gainNodeRef.current = gainNode;
      
      lastNode.connect(gainNode);
      gainNode.connect(ctx.destination);
    } catch (e) {
      console.error("Failed to setup audio context:", e);
    }
  }, []);

  useEffect(() => {
    if (eqFiltersRef.current.length === 10) {
      eqFiltersRef.current.forEach((filter, i) => {
        filter.gain.value = eqEnabled ? eqBands[i] : 0;
      });
    }
  }, [eqBands, eqEnabled]);

  useEffect(() => {
    if (eqEnabled && audioRef.current && isPlaying && !audioContextRef.current) {
      setupAudioWithEQ();
    }
  }, [eqEnabled, isPlaying, setupAudioWithEQ]);

  useEffect(() => {
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  }, [currentTrack]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  useEffect(() => {
    if (currentTrack?.cover) {
      getAverageColor(currentTrack.cover).then(color => {
        setRightSidebarBg(color);
      });
    } else {
      setRightSidebarBg('rgba(14, 14, 14, 1)');
    }
  }, [currentTrack?.cover]);
  const nextTrackFnRef = useRef<(() => void) | null>(null);
  const prevTrackFnRef = useRef<(() => void) | null>(null);

  function loadToStorage<T>(key: string, defaultValue: T): T {
    return loadFromStorage(key, defaultValue);
  }

  const libraryLoaded = useRef(false);
  useEffect(() => {
    if (libraryLoaded.current) return;
    libraryLoaded.current = true;
    loadLibrary();
    setTimeout(() => setIsLoading(false), 2000);
  }, []);
  
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
        audioRef.current.play().catch(e => { if (e.name !== 'AbortError') console.error(e) });
        startProgressTracking();
      } else {
        audioRef.current.pause();
        stopProgressTracking();
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current && normEnabled && currentTrack?.path) {
      const gainDb = trackLoudness.get(currentTrack.path);
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
            
            let folderCover: string | undefined;
            for (const subEntry of subEntries) {
              if (!folderCover && isImageFile(subEntry.name)) {
                try {
                  const imagePath = fullPath + (fullPath.endsWith('\\') ? '' : '\\') + subEntry.name;
                  const imageData = await readFile(imagePath);
                  let binary = '';
                  const bytes = new Uint8Array(imageData);
                  for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                  }
                  const base64 = btoa(binary);
                  const ext = subEntry.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                  folderCover = `data:${ext};base64,${base64}`;
                } catch {}
              }
            }
            
            const subTracks: Track[] = [];
            let subTrackId = Date.now();
            for (const subEntry of subEntries) {
              if (isMusicFile(subEntry.name)) {
                const trackPath = fullPath + (fullPath.endsWith('\\') ? '' : '\\') + subEntry.name;
                const existingTrack = tracks.find(t => t.path === trackPath);
                if (existingTrack) {
                  subTracks.push(existingTrack);
                } else {
                  subTracks.push({
                    id: subTrackId++,
                    path: trackPath,
                    title: subEntry.name.replace(/\.[^.]+$/, ''),
                    artist: 'Unknown Artist',
                    album: 'Unknown Album',
                    duration: 0,
                    cover: undefined
                  });
                }
              }
            }
            
            const firstFourTracks = subTracks.slice(0, 4);
            for (const track of firstFourTracks) {
              if (!track.cover || track.artist === 'Unknown Artist') {
                try {
                  const meta = await invoke<{ title: string; artist: string; album: string; duration: number; cover: string | null } | null>("get_audio_metadata", { path: track.path });
                  if (meta) {
                    track.title = meta.title;
                    track.artist = meta.artist;
                    track.album = meta.album;
                    track.duration = meta.duration;
                    track.cover = meta.cover || undefined;
                  }
                } catch {}
              }
            }
            
            const generatedCover = generatePlaylistCover(subTracks);
            playlists.push({ 
              id: playlistId++, 
              name, 
              path: fullPath, 
              track_count: trackCount,
              cover: generatedCover || undefined
            });
          } catch { 
            playlists.push({ id: playlistId++, name, path: fullPath, track_count: 0 }); 
          }
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
      saveToStorage(STORAGE_KEYS.playlists, playlists);
    } catch (e) { 
      console.error("Failed to load library:", e);
    }
  };

  const addToHistory = useCallback((track: Track) => {
    setHistory(prev => {
      const filtered = prev.filter(h => h.track.path !== track.path);
      const trackForHistory = { ...track, cover: undefined };
      const updated = [{ track: trackForHistory, playedAt: Date.now() }, ...filtered].slice(0, 50);
      try {
        saveToStorage(STORAGE_KEYS.history, updated);
      } catch {}
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
    
    const isYouTube = updatedTrack.path.startsWith('http');
    
    if (normEnabled && !isYouTube && updatedTrack.path && !trackLoudness.has(updatedTrack.path)) {
      try {
        const loudness = await invoke<{ integrated_lufs: number; true_peak_dbtp: number; gain_db: number } | null>("get_track_loudness", { path: updatedTrack.path });
        if (loudness) {
          setTrackLoudness(prev => new Map(prev).set(updatedTrack.path, loudness.gain_db));
        }
      } catch (e) { console.error("Failed to load loudness:", e); }
    }
    
    setCurrentTrack(updatedTrack);
    setIsPlaying(true);
    addToHistory(updatedTrack);
    
    if (audioRef.current) {
      try {
        if (eqEnabled && !audioContextRef.current) {
          setupAudioWithEQ();
        }
        
        const src = isYouTube ? updatedTrack.path : convertFileSrc(updatedTrack.path);
        audioRef.current.src = src;
        audioRef.current.onerror = (e) => console.error("Audio error:", e);
        audioRef.current.onloadedmetadata = () => {
          if (audioRef.current && audioRef.current.duration && !updatedTrack.duration) {
            setCurrentTrack(prev => prev ? { ...prev, duration: Math.floor(audioRef.current!.duration) } : null);
          }
        };
        audioRef.current.play().catch(e => { if (e.name !== 'AbortError') console.error("Play error:", e) });
        
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

  const nextTrack = useCallback(() => {
    if (!currentTrack) return;
    const sorted = getSortedTracks();
    const currentIndex = sorted.findIndex(t => t.path === currentTrack.path);
    if (currentIndex === -1) return;
    let nextIndex: number;
    if (shuffleEnabled) {
      nextIndex = Math.floor(Math.random() * sorted.length);
    } else {
      nextIndex = (currentIndex + 1) % sorted.length;
    }
    if (sorted[nextIndex]) {
      playTrack(sorted[nextIndex]);
    }
  }, [currentTrack, shuffleEnabled]);

  const prevTrack = useCallback(() => {
    if (!currentTrack) return;
    const sorted = getSortedTracks();
    const currentIndex = sorted.findIndex(t => t.path === currentTrack.path);
    if (currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + sorted.length) % sorted.length;
    if (sorted[prevIndex]) {
      playTrack(sorted[prevIndex]);
    }
  }, [currentTrack]);

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
      const existingTracks = new Map(tracks.map(t => [t.path, t]));
      const newTracks: Track[] = [];
      let trackId = Date.now();
      
      let folderCover: string | undefined;
      
      for (const entry of entries) {
        if (!folderCover && isImageFile(entry.name)) {
          try {
            const imagePath = playlist.path + (playlist.path.endsWith('\\') ? '' : '\\') + entry.name;
            const imageData = await readFile(imagePath);
            let binary = '';
            const bytes = new Uint8Array(imageData);
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            const ext = entry.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
            folderCover = `data:${ext};base64,${base64}`;
          } catch (e) {
            console.error("Failed to load cover:", e);
          }
        }
        
        if (isMusicFile(entry.name)) {
          const fullPath = playlist.path + (playlist.path.endsWith('\\') ? '' : '\\') + entry.name;
          const existing = existingTracks.get(fullPath);
          if (existing && existing.artist !== 'Unknown Artist') {
            newTracks.push(existing);
          } else {
            newTracks.push({ id: trackId++, path: fullPath, title: entry.name.replace(/\.[^.]+$/, ''), artist: 'Unknown Artist', album: 'Unknown Album', duration: 0, cover: undefined });
          }
        }
      }
      
      const generatedCover = generatePlaylistCover(newTracks);
      
      const updatedPlaylist = { 
        ...playlist, 
        cover: folderCover || generatedCover || playlist.cover, 
        track_count: newTracks.length
      };
      
      setPlaylists(prev => {
        const updated = prev.map(p => p.path === playlist.path ? updatedPlaylist : p);
        return updated;
      });
      
      if (folderCover) {
        setPlaylistCovers(prev => ({ ...prev, [playlist.path]: [folderCover] }));
      }
      
      setTracks(newTracks);
      setCurrentView("library");
      setCurrentPlaylist(updatedPlaylist);
      
      setTimeout(async () => {
        for (const track of newTracks) {
          if (track.artist === 'Unknown Artist' || !track.cover) {
            try {
              const meta = await invoke<{ title: string; artist: string; album: string; duration: number; cover: string | null } | null>("get_audio_metadata", { path: track.path });
              if (meta) {
                track.title = meta.title;
                track.artist = meta.artist;
                track.album = meta.album;
                track.duration = meta.duration;
                track.cover = meta.cover || undefined;
              }
            } catch {}
          }
        }
        setTracks([...newTracks]);
        saveToStorage(STORAGE_KEYS.tracks, newTracks);
      }, 100);
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
            <Music className="w-12 h-12 text-bg" />
          </div>
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-32 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary to-tertiary-container animate-[loading_1.5s_ease-in-out_infinite]"></div>
          </div>
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight mb-2">Player</h1>
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
      <audio 
          ref={audioRef} 
          crossOrigin="anonymous"
          onEnded={() => { if (!shuffleEnabled) nextTrack(); else { const s = getSortedTracks(); const i = Math.floor(Math.random() * s.length); if(s[i]) playTrack(s[i]); } }}
        />
      
      {showCreatePlaylist && <CreatePlaylistModal onClose={() => setShowCreatePlaylist(false)} onCreate={handleConfirmCreatePlaylist} />}
      {editingPlaylist && <EditPlaylistModal playlist={editingPlaylist} onClose={() => setEditingPlaylist(null)} onSave={handleSavePlaylist} onDelete={handleDeletePlaylist} />}
      
      <header className={`fixed top-0 left-0 right-0 z-[60] bg-surface-container-lowest/80 backdrop-blur-md border-b border-surface-container-high/50 flex items-center justify-between pl-4 shadow-2xl`} style={{ height: titlebarHeight }} data-tauri-drag-region>
        <div className="flex items-center gap-2">
          <button onClick={() => navigateTo("settings")} className="p-2 text-outline hover:text-primary transition-colors" title="Settings">
            <MoreHorizontal className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1">
            <button onClick={goBack} disabled={historyIndex === 0} className={`p-2 transition-colors ${historyIndex === 0 ? 'text-white/20 cursor-not-allowed' : 'text-outline hover:text-primary'}`}><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={goForward} disabled={historyIndex === navHistory.length - 1} className={`p-2 transition-colors ${historyIndex === navHistory.length - 1 ? 'text-white/20 cursor-not-allowed' : 'text-outline hover:text-primary'}`}><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
        
        {titlebarHeight >= 50 && (
          <div className="flex-1 flex justify-center max-w-xl px-4">
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
        )}
        
        <div className="flex items-center h-full">
          <div 
            className="w-full h-1 absolute bottom-0 cursor-ns-resize hover:bg-primary/50"
            onMouseDown={(e) => {
              e.preventDefault();
              const startY = e.clientY;
              const startHeight = titlebarHeight;
              const onMouseMove = (moveEvent: MouseEvent) => {
                const newHeight = Math.max(40, Math.min(80, startHeight + (startY - moveEvent.clientY)));
                setTitlebarHeight(newHeight);
              };
              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
              };
              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
            }}
          />
          <button onClick={() => getCurrentWindow().minimize()} className="w-10 h-full flex items-center justify-center hover:bg-stone-800/50 transition-colors text-outline hover:text-primary"><Minus className="w-4 h-4" /></button>
          <button onClick={() => getCurrentWindow().toggleMaximize()} className="w-10 h-full flex items-center justify-center hover:bg-stone-800/50 transition-colors text-outline hover:text-primary"><Square className="w-3 h-3" /></button>
          <button onClick={() => getCurrentWindow().close()} className="w-10 h-full flex items-center justify-center hover:bg-red-900/80 hover:text-white transition-colors text-outline"><X className="w-4 h-4" /></button>
        </div>
      </header>

      <div className="flex flex-1" style={{ marginTop: titlebarHeight }}>
        <aside className="bg-surface-container-lowest/95 border-r border-white/[0.03] flex flex-col py-6 px-3 md:px-4 fixed left-0 z-40 shadow-[10px_0_30px_-5px_rgba(0,0,0,0.8)] font-serif tracking-tight text-sm uppercase transition-all duration-300 flex flex-col" style={{ top: titlebarHeight, height: `calc(100vh - ${titlebarHeight}px)`, width: sidebarWidth }}>
          <div 
            className="absolute right-0 top-0 w-1 h-full cursor-ew-resize hover:bg-primary/50"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = sidebarWidth;
              const onMouseMove = (moveEvent: MouseEvent) => {
                const newWidth = Math.max(60, Math.min(400, startWidth + (moveEvent.clientX - startX)));
                setSidebarWidth(newWidth);
              };
              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
              };
              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
            }}
          />
          <nav className="flex-1 px-1 md:px-4 space-y-1 overflow-y-auto">
            <div className="hidden md:block text-[11px] text-outline uppercase tracking-widest px-4 mb-4">Browse</div>
            <button onClick={() => { setCurrentPlaylist(null); setCurrentView("library"); }} className={`w-full flex items-center gap-2 md:gap-4 py-3 pl-4 md:pl-6 rounded-sm transition-all duration-300 ${currentView === "library" && !currentPlaylist ? "text-primary font-bold border-r-[2px] border-primary shadow-[0_0_10px_rgba(212,175,55,0.4)] bg-gradient-to-r from-primary/10 to-transparent" : "text-stone-500 hover:text-primary hover:bg-stone-800/50"}`}>
              <Home className={`w-4 h-4 md:w-5 md:h-5 ${currentView === "library" ? "text-primary" : ""}`} />
              <span className="hidden md:inline">Home</span>
            </button>
            <button onClick={() => navigateTo("playlists")} className={`w-full flex items-center gap-2 md:gap-4 py-3 pl-4 md:pl-6 rounded-sm transition-all duration-300 ${currentView === "playlists" ? "text-primary font-bold border-r-[2px] border-primary shadow-[0_0_10px_rgba(212,175,55,0.4)] bg-gradient-to-r from-primary/10 to-transparent" : "text-stone-500 hover:text-primary hover:bg-stone-800/50"}`}>
              <PlaylistIcon className="w-4 h-4 md:w-5 md:h-5 text-stone-500" />
              <span className="hidden md:inline">Playlists</span>
            </button>
            <button onClick={() => {
              if (favorites.length > 0) {
                setTracks(favorites.map(f => ({ ...f, id: f.id, title: f.title, artist: f.artist, album: f.album || 'Unknown', duration: f.duration || 0 })));
                setCurrentPlaylist({ id: -1, name: 'Favorites', path: '', track_count: favorites.length, cover: undefined });
                setCurrentView("library");
              } else {
                navigateTo("favorites");
              }
            }} className={`w-full flex items-center gap-2 md:gap-4 py-3 pl-4 md:pl-6 rounded-sm transition-all duration-300 ${currentView === "favorites" || currentPlaylist?.id === -1 ? "text-primary font-bold border-r-[2px] border-primary shadow-[0_0_10px_rgba(212,175,55,0.4)] bg-gradient-to-r from-primary/10 to-transparent" : "text-stone-500 hover:text-primary hover:bg-stone-800/50"}`}>
              <Heart className={`w-4 h-4 md:w-5 md:h-5 ${currentView === "favorites" || currentPlaylist?.id === -1 ? "text-primary" : ""}`} />
              <div className="hidden md:flex flex-col items-start">
                <span>Favorites</span>
                <span className="text-[10px] text-outline">{favorites.length} tracks</span>
              </div>
            </button>
            <button onClick={() => navigateTo("search")} className={`w-full flex items-center gap-2 md:gap-4 py-3 pl-4 md:pl-6 rounded-sm transition-all duration-300 ${currentView === "search" ? "text-primary font-bold border-r-[2px] border-primary shadow-[0_0_10px_rgba(212,175,55,0.4)] bg-gradient-to-r from-primary/10 to-transparent" : "text-stone-500 hover:text-primary hover:bg-stone-800/50"}`}>
              <Search className={`w-4 h-4 md:w-5 md:h-5 ${currentView === "search" ? "text-primary" : ""}`} />
              <span className="hidden md:inline">Search</span>
            </button>
          </nav>

          <div className="mt-4 px-1 md:px-4 pb-20 md:pb-24">
            <div className="hidden md:flex items-center justify-between text-[11px] text-outline uppercase tracking-widest px-4 mb-4">
              <span>Playlists</span>
              <button onClick={() => setSidebarPlaylistView(v => v === "expanded" ? "compact" : "expanded")} className="hover:text-primary transition-colors">
                {sidebarPlaylistView === "expanded" ? <ListMusic className="w-4 h-4" /> : <Home className="w-4 h-4" />}
              </button>
            </div>
            
            {sidebarPlaylistView === "expanded" ? (
              <div className="space-y-1 max-h-[300px] overflow-y-auto pr-2">
                {favorites.length > 0 && (
                  <button 
                    onClick={() => {
                      setTracks(favorites.map(f => ({ ...f, id: f.id, title: f.title, artist: f.artist, album: f.album || 'Unknown', duration: f.duration || 0 })));
                      setCurrentPlaylist({ id: -1, name: 'Favorites', path: '', track_count: favorites.length, cover: undefined });
                      setCurrentView("library");
                    }}
                    className={`w-full flex items-center gap-3 py-2 pl-2 md:pl-4 rounded-md hover:bg-white/5 transition-all group ${currentPlaylist?.id === -1 ? 'bg-white/10' : ''}`}
                  >
                    <div className="w-10 h-10 shrink-0 rounded-md bg-gradient-to-br from-primary/30 to-secondary-container/30 flex items-center justify-center">
                      <Heart className="w-5 h-5 text-primary" fill="currentColor" />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-xs md:text-sm text-on-surface truncate group-hover:text-primary transition-colors">Favorites</div>
                      <div className="text-[10px] text-outline truncate">{favorites.length} tracks</div>
                    </div>
                  </button>
                )}
                {playlists.map((playlist) => (
                  <button 
                    key={playlist.id}
                    onClick={() => handleSelectPlaylist(playlist)}
                    className="w-full flex items-center gap-3 py-2 pl-2 md:pl-4 rounded-md hover:bg-white/5 transition-all group"
                  >
                    <div className="w-10 h-10 shrink-0 rounded-md overflow-hidden bg-surface-container-high flex items-center justify-center">
                      {playlistCovers?.[playlist.path]?.[0] ? (
                        <img src={playlistCovers[playlist.path][0]} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <PlaylistIcon className="w-5 h-5 text-outline" />
                      )}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-xs md:text-sm text-on-surface truncate group-hover:text-primary transition-colors">{playlist.name}</div>
                      <div className="text-[10px] text-outline truncate">{playlist.track_count} tracks</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 pr-2">
                {favorites.length > 0 && (
                  <button 
                    onClick={() => {
                      setTracks(favorites.map(f => ({ ...f, id: f.id, title: f.title, artist: f.artist, album: f.album || 'Unknown', duration: f.duration || 0 })));
                      setCurrentPlaylist({ id: -1, name: 'Favorites', path: '', track_count: favorites.length, cover: undefined });
                      setCurrentView("library");
                    }}
                    className="aspect-square rounded-md bg-gradient-to-br from-primary/30 to-secondary-container/30 group hover:ring-2 hover:ring-primary/50 transition-all flex items-center justify-center"
                  >
                    <Heart className="w-8 h-8 text-primary" fill="currentColor" />
                  </button>
                )}
                {playlists.map((playlist) => (
                  <button 
                    key={playlist.id}
                    onClick={() => handleSelectPlaylist(playlist)}
                    className="aspect-square rounded-md overflow-hidden bg-surface-container-high group hover:ring-2 hover:ring-primary/50 transition-all"
                  >
                    {playlistCovers?.[playlist.path]?.[0] ? (
                      <img src={playlistCovers[playlist.path][0]} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <PlaylistIcon className="w-8 h-8 text-outline" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 relative h-[calc(100vh-3.5rem)] overflow-y-auto pb-20 md:pb-24 p-3 md:p-8 border-t border-white/[0.03]" style={{ marginLeft: sidebarWidth, marginRight: rightSidebarWidth }}>
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
                allPlaylists={playlists}
                onSelectPlaylist={handleSelectPlaylist}
                playlistCovers={playlistCovers}
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
                eqEnabled={eqEnabled}
                setEqEnabled={setEqEnabled}
                eqPreset={eqPreset}
                setEqPreset={setEqPreset}
                eqBands={eqBands}
                setEqBands={setEqBands}
                EQ_PRESETS={EQ_PRESETS}
                EQ_FREQUENCIES={EQ_FREQUENCIES}
              />
            )}
            {currentView === "search" && (
              <SearchPage 
                onPlayTrack={playTrack}
              />
            )}
          </div>
        </main>
        
<aside 
          className="fixed right-0 top-[56px] h-[calc(100vh-56px-6rem)] bg-surface-container-lowest/95 border-l border-white/[0.03] flex flex-col z-40 shadow-[-10px_0_30px_-5px_rgba(0,0,0,0.8)]"
          style={{ width: rightSidebarWidth, backgroundColor: rightSidebarBg }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-surface-container-lowest/95 pointer-events-none" />
          <div 
            className="absolute left-0 top-0 w-1 h-full cursor-ew-resize hover:bg-primary/50 z-50"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = rightSidebarWidth;
              const onMouseMove = (moveEvent: MouseEvent) => {
                const newWidth = Math.max(200, Math.min(600, startWidth - (moveEvent.clientX - startX)));
                setRightSidebarWidth(newWidth);
              };
              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
              };
              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
            }}
          />
          <div className="p-4 flex flex-col h-full overflow-hidden relative z-10">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] uppercase tracking-widest text-outline">Now Playing</span>
            </div>
            
            {currentTrack ? (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="text-center mb-3">
                  <div className="text-sm text-outline font-medium">{currentTrack.artist}</div>
                </div>
                
                <div className="w-full aspect-square rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.5)] mb-4 bg-surface-container shrink-0">
                  {currentTrack.cover ? (
                    <img 
                      src={currentTrack.cover} 
                      alt="" 
                      className="w-full h-full object-cover"
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        const canvas = document.createElement('canvas');
                        canvas.width = 1;
                        canvas.height = 1;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                          ctx.drawImage(img, 0, 0, 1, 1);
                          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
                          (img.parentElement?.parentElement as HTMLElement)?.style?.setProperty('--cover-color', `rgb(${r},${g},${b})`);
                        }
                      }}
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-primary/20 to-secondary-container/30 flex items-center justify-center">
                      <Music className="w-1/2 h-1/2 text-white/20" />
                    </div>
                  )}
                </div>
                
                <div className="text-center mb-3 shrink-0">
                  <div className="text-base font-semibold text-on-surface mb-1 truncate px-2">{currentTrack.title}</div>
                  <div className="text-sm text-outline">{currentTrack.artist}</div>
                </div>
                
                <div className="flex-1 overflow-y-auto text-[10px] text-outline space-y-1">
                  {currentTrack.album && currentTrack.album !== 'Unknown Album' && (
                    <div className="flex justify-between items-center py-1.5 border-b border-white/[0.05]">
                      <span className="shrink-0">Album</span>
                      <span className="text-on-surface truncate ml-2 text-right max-w-[140px] text-[9px]">{currentTrack.album}</span>
                    </div>
                  )}
                  {currentTrack.duration > 0 && (
                    <div className="flex justify-between items-center py-1.5 border-b border-white/[0.05]">
                      <span className="shrink-0">Duration</span>
                      <span className="text-on-surface text-[9px]">{formatDuration(currentTrack.duration)}</span>
                    </div>
                  )}
                  {currentTrack.path && (
                    <div className="flex justify-between items-center py-1.5 border-b border-white/[0.05]">
                      <span className="shrink-0">Path</span>
                      <span className="text-on-surface truncate ml-2 text-right max-w-[140px] text-[8px]">{currentTrack.path.split('\\').pop()}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-1.5 border-b border-white/[0.05]">
                    <span className="shrink-0">Format</span>
                    <span className="text-on-surface text-[9px]">{currentTrack.path?.split('.').pop()?.toUpperCase() || 'Unknown'}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-outline">
                <Music className="w-12 h-12 mb-3 opacity-30" />
                <div className="text-sm">No track playing</div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <footer className="fixed bottom-0 w-full z-50 border-t border-surface-container-high/30 bg-surface-container-lowest/80 backdrop-blur-xl shadow-[0_-10px_20px_rgba(0,0,0,0.5)] h-16 md:h-24 px-3 md:px-12 flex items-center justify-between text-xs uppercase tracking-widest text-white/60" style={{ marginRight: rightSidebarWidth }}>
        <div className="flex items-center gap-2 md:gap-4 w-1/3 min-w-0">
          <div className="relative group hidden md:block">
            {currentTrack?.cover ? <img src={currentTrack.cover} alt="" className="w-12 h-12 md:w-16 md:h-16 rounded-xl object-cover shrink-0 shadow-[0_0_15px_rgba(247,189,72,0.2)] cursor-pointer" onClick={() => setShowOverlay(true)} /> : <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl bg-gradient-to-br from-primary/10 to-secondary-container/20 border border-white/[0.05] shrink-0 cursor-pointer" onClick={() => setShowOverlay(true)}></div>}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-md cursor-pointer" onClick={() => setShowOverlay(true)}>
              <Maximize2 className="w-4 h-4 text-white" />
            </div>
          </div>
          <div className="min-w-0 truncate">
            <div className="text-xs md:text-sm text-white font-medium truncate mb-0.5 md:mb-1">{currentTrack?.title || "No track"}</div>
            {currentTrack?.artist && (
              <button 
                onClick={() => setSearchQuery(currentTrack.artist)}
                className="text-[10px] md:text-[11px] text-outline truncate hover:text-primary hover:underline cursor-pointer transition-colors text-left"
              >
                {currentTrack.artist}
              </button>
            )}
            {!currentTrack && <div className="text-[10px] md:text-[11px] text-outline">Select a track</div>}
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
            <input type="range" min="0" max="100" value={volume} onChange={handleVolumeChange} className="w-20 md:w-24 h-1 md:h-1.5 rounded-full appearance-none cursor-pointer" style={{ background: `linear-gradient(to right, #f7bd48 0%, #f7bd48 ${volume}%, rgba(255,255,255,0.1) ${volume}%, rgba(255,255,255,0.1) 100%)`, WebkitAppearance: 'none' }} />
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