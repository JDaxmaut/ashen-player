import { useState, useEffect, useRef, useCallback } from "react";
import { set } from 'idb-keyval';
import { open } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { 
  Activity, Music, ListMusic as PlaylistIcon, Settings,
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat,
  Heart, FileText, Volume2, VolumeX,
  ChevronLeft, ChevronRight, Search, Minus, Square, X,
  Home, Folder, Heart as HeartFilled, Plus, Trash2, Maximize2, MoreHorizontal, Download, Loader2, Monitor
} from "lucide-react";
import NowPlayingOverlay from "./NowPlayingOverlay";



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

const MUSIC_EXTENSIONS = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac', '.wma', '.aiff'];

const isMusicFile = (filename: string): boolean => {
  const ext = filename.toLowerCase();
  return MUSIC_EXTENSIONS.some(e => ext.endsWith(e));
};

interface YouTubeTrack {
  id: string;
  title: string;
  artist: string;
  duration_secs: number;
  thumbnail: string;
  url: string;
}

export interface Track {
  id: number;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover?: string;
  lyrics?: string;
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
  cover?: string;
  addedAt: number;
}

interface PlaybackHistory {
  trackPath: string;
  title: string;
  artist: string;
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

async function saveToStorageAsync(key: string, value: unknown): Promise<void> {
  try {
    await set(key, value);
  } catch (e) {
    console.error("Failed to save to storage:", key, e);
  }
}

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
    return defaultValue;
  } catch { return defaultValue; }
}

function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("Failed to save to storage:", e);
  }
}

function LyricsPage({ currentTrack, averageColor }: { currentTrack: Track | null; averageColor: string }) {
  const [loadingLyrics, setLoadingLyrics] = useState(false);
  const [lyricsText, setLyricsText] = useState<string | null>(null);

  useEffect(() => {
    if (!currentTrack) {
      setLyricsText(null);
      return;
    }
    if (currentTrack.lyrics) {
      setLyricsText(currentTrack.lyrics);
      return;
    }
    setLyricsText(null);
    setLoadingLyrics(true);
    invoke<{ lyrics: string | null } | null>("get_audio_metadata", { path: currentTrack.path }).then(meta => {
      setLyricsText(meta?.lyrics || null);
      setLoadingLyrics(false);
    }).catch(() => setLoadingLyrics(false));
  }, [currentTrack?.path, currentTrack?.lyrics]);

  const ac = averageColor || "#f7bd48";

  return (
    <div
      className="absolute inset-0 overflow-hidden flex flex-col"
      style={{
        background: `linear-gradient(160deg, ${ac}18 0%, #0a0a0c 35%, #0a0a0c 65%, ${ac}0a 100%)`,
      }}
    >
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: currentTrack?.cover ? `url(${currentTrack.cover})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center top",
          backgroundRepeat: "no-repeat",
          filter: "blur(60px) saturate(1.8)",
          transform: "scale(1.25)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 50% 0%, ${ac}25 0%, transparent 60%), radial-gradient(ellipse at 50% 100%, ${ac}10 0%, transparent 50%)`,
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "linear-gradient(to bottom, #0a0a0c 0%, transparent 15%, transparent 75%, #0a0a0c 100%)",
        }}
      />
      <div className="relative z-10 flex flex-col h-full max-w-3xl mx-auto w-full px-12 pt-16 pb-8">
        {currentTrack && (
          <div className="flex items-center gap-5 mb-8 shrink-0">
            <div
              className="w-14 h-14 rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.6)] shrink-0"
              style={{ boxShadow: `0 0 20px ${ac}30` }}
            >
              {currentTrack.cover ? (
                <img src={currentTrack.cover} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary/20 to-secondary-container/20 flex items-center justify-center">
                  <Music className="w-7 h-7 text-white/20" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <h2
                className="text-2xl font-bold text-white truncate leading-tight"
                style={{ fontFamily: "Cormorant Garamond, Georgia, serif", fontSize: "1.6rem" }}
              >
                {currentTrack.title}
              </h2>
              <p className="text-sm truncate" style={{ color: `${ac}bb` }}>
                {currentTrack.artist}
              </p>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          {loadingLyrics ? (
            <div className="flex flex-col items-center justify-center py-24 text-outline">
              <div className="w-8 h-8 border-2 border-white/10 rounded-full animate-spin mb-4" style={{ borderTopColor: ac }} />
              <div className="text-sm">Loading lyrics...</div>
            </div>
          ) : lyricsText ? (
            <div
              className="whitespace-pre-wrap py-4"
              style={{
                color: "rgba(255,255,255,0.75)",
                fontFamily: "Cormorant Garamond, Georgia, serif",
                fontSize: "1.35rem",
                lineHeight: "2",
                textShadow: `0 2px 20px ${ac}20`,
              }}
            >
              {lyricsText}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-outline text-center">
              <FileText className="w-14 h-14 mb-5 opacity-15" />
              <div className="text-lg mb-2">No lyrics in file</div>
              <div className="text-sm text-white/20 max-w-xs">
                Embed lyrics in track metadata to display them here
              </div>
            </div>
          )}
        </div>

        <div className="h-px mt-6 shrink-0" style={{ background: `linear-gradient(to right, transparent, ${ac}30, transparent)` }} />
      </div>
    </div>
  );
}

function SearchPage({ onPlayTrack }: { onPlayTrack: (track: Track) => void }) {
  const [query, setQuery] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [results, setResults] = useState<YouTubeTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownloadUrl = async () => {
    if (!urlInput.trim()) return;
    setDownloading("url");
    try {
      const downloadPath = "E:\\onyx\\lib\\downloads";
      const result = await invoke<string>("download_youtube", { url: urlInput.trim(), outputDir: downloadPath });
      setUrlInput("");
      alert("Downloaded: " + result);
    } catch (e) {
      alert("Error: " + e);
    }
    setDownloading(null);
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const searchResults = await invoke<YouTubeTrack[]>("search_youtube", { query: query.trim() });
      setResults(searchResults);
    } catch (e) {
      console.error("Search failed:", e);
    }
    setLoading(false);
  };

  const handlePlay = (track: YouTubeTrack) => {
    onPlayTrack({
      id: Date.now(),
      path: track.url,
      title: track.title,
      artist: track.artist,
      album: 'YouTube',
      duration: track.duration_secs,
      cover: track.thumbnail
    });
  };

  const handleDownload = async (track: YouTubeTrack) => {
    setDownloading(track.id);
    try {
      const downloadPath = "E:\\onyx\\lib\\downloads";
      await invoke<string>("download_youtube", { url: track.url, outputDir: downloadPath });
      alert("Downloaded: " + track.title);
    } catch (e) {
      alert("Error: " + e);
    }
    setDownloading(null);
  };

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-6">YouTube Music</h2>
      
      <div className="mb-6 space-y-4">
        <div className="flex gap-2">
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="YouTube URL..."
            className="flex-1 bg-surface-container-high text-white px-4 py-2 rounded-lg border border-surface-container-high focus:border-primary outline-none"
          />
          <button
            onClick={handleDownloadUrl}
            disabled={downloading === "url" || !urlInput.trim()}
            className="px-4 py-2 bg-primary text-on-primary rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {downloading === "url" ? "Downloading..." : "Download"}
          </button>
        </div>
        
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search YouTube..."
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1 bg-surface-container-high text-white px-4 py-2 rounded-lg border border-surface-container-high focus:border-primary outline-none"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="px-4 py-2 bg-primary text-on-primary rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {results.map((track) => (
          <div
            key={track.id}
            className="flex items-center gap-4 p-3 bg-surface-container-high rounded-lg hover:bg-surface-container-low transition-colors group"
          >
            <div className="w-12 h-12 rounded overflow-hidden shrink-0 bg-surface-container">
              {track.thumbnail && <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />}
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
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-on-surface">Equalizer</div>
                    <div className="text-outline text-sm">10-band audio equalizer</div>
                  </div>
                  <button 
                    onClick={() => setEqEnabled(!eqEnabled)}
                    className={`w-12 h-6 rounded-full relative transition-colors ${eqEnabled ? "bg-primary-container" : "bg-surface-container-high"}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${eqEnabled ? "right-1" : "left-1"}`}></div>
                  </button>
                </div>
                {eqEnabled && (
                  <div className="space-y-4 pt-2">
                    <div className="flex gap-2 flex-wrap">
                      {Object.keys(EQ_PRESETS).map(preset => (
                        <button
                          key={preset}
                          onClick={() => { setEqPreset(preset); setEqBands(EQ_PRESETS[preset]); }}
                          className={`px-3 py-1 rounded-full text-sm transition-colors ${eqPreset === preset ? 'bg-primary text-black' : 'bg-surface-container-high text-outline hover:text-white'}`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      {eqBands.map((value, index) => (
                        <div key={index} className="flex-1 flex flex-col items-center">
                          <input
                            type="range"
                            min="-12"
                            max="12"
                            value={value}
                            onChange={(e) => {
                              const newBands = [...eqBands];
                              newBands[index] = parseInt(e.target.value);
                              setEqBands(newBands);
                              setEqPreset("Custom");
                            }}
                            className="h-32 w-4 bg-surface-container-high rounded-full appearance-none cursor-pointer vertical-slider"
                            style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                          />
                          <span className="text-[10px] text-outline mt-1">{EQ_FREQUENCIES[index] >= 1000 ? `${EQ_FREQUENCIES[index]/1000}k` : EQ_FREQUENCIES[index]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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

function PlaylistsPage({ playlists, playlistCovers, onSelectPlaylist, onCreatePlaylist, onEditPlaylist }: { 
  playlists: Playlist[];
  playlistCovers: Record<number, string>;
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
              <div className={`aspect-square rounded-lg mb-4 group-hover:scale-[1.02] transition-transform duration-300 flex items-center justify-center overflow-hidden ${playlistCovers[playlist.id] ? '' : 'bg-gradient-to-br from-primary/20 to-secondary-container/20'}`}>
                {playlistCovers[playlist.id] ? <img src={playlistCovers[playlist.id]} alt="" className="w-full h-full object-cover" /> : <PlaylistIcon className="w-12 h-12 text-white/50" />}
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
  playlistCovers,
  onSelectPlaylist,
  dominantColor,
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
  playlistCovers?: Record<number, string>;
  onSelectPlaylist?: (playlist: Playlist) => void;
  dominantColor?: string;
}) {
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
    const recentPlaylistPaths = new Set(history.slice(0, 10).filter(h => h.trackPath).map(h => h.trackPath.split('\\').slice(0, -1).join('\\')));
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
                    {playlistCovers?.[playlist.id] ? (
                      <img src={playlistCovers[playlist.id]} alt="" className="w-full h-full object-cover" />
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
                  {playlistCovers?.[playlist.id] ? (
                    <img src={playlistCovers[playlist.id]} alt="" className="w-full h-full object-cover" />
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
      {playlistCover ? (
        <div
          className="relative overflow-hidden"
          style={{
            background: `linear-gradient(to bottom, ${dominantColor || '#0e0e0e'} 0%, rgba(14,14,14,1) 100%)`
          }}
        >
          <div className="p-8 pb-40 relative z-10">
            <section className="flex gap-8 items-end">
              <div 
                className="w-52 h-52 md:w-60 md:h-60 shrink-0 rounded-lg overflow-hidden shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] group cursor-pointer"
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
        </div>
      ) : (
        <div className="p-8 pb-40 relative overflow-hidden" style={{ background: "linear-gradient(to bottom, rgba(30,30,30,1) 0%, #0a0a0c 100%)" }}>
          <section className="relative z-10 flex gap-8 items-end">
            <div className="w-52 h-52 md:w-60 md:h-60 shrink-0 rounded-lg overflow-hidden shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] group cursor-pointer" onClick={onPlayAll}>
              <div className="w-full h-full bg-gradient-to-br from-surface-container-high to-surface-container flex items-center justify-center">
                <PlaylistIcon className="w-20 h-20 text-white/30" />
              </div>
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
                <button onClick={onPlayAll} className="w-14 h-14 rounded-full bg-primary flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg">
                  <Play className="w-6 h-6 text-black ml-1" fill="currentColor" />
                </button>
                <button onClick={onShuffle} className="text-white/50 hover:text-white transition-colors">
                  <Shuffle className="w-8 h-8" />
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      
      <div className="px-8 pt-8 -mt-28 relative z-20">
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
        <div className="space-y-1 mb-12 min-h-0" style={{ background: 'transparent' }}>
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
                <div className="text-right text-outline text-[11px] flex items-center justify-end gap-2 w-full">
                  <button 
                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(track); }}
                    className="w-6 h-6 flex items-center justify-center transition-colors hover:text-white shrink-0"
                  >
                    {isFavorite ? <HeartFilled className="w-3 h-3" style={{ color: '#ef4444', fill: '#ef4444' }} /> : <Heart className={`w-3 h-3 ${currentTrack?.id === track.id ? "text-primary" : "opacity-0 group-hover:opacity-100"}`} />}
                  </button>
                  <span className="shrink-0">{formatDuration(track.duration)}</span>
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
        <HeartFilled className="w-6 h-6" style={{ color: '#ef4444', fill: '#ef4444' }} />
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

function CreatePlaylistModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div className="glass-panel rounded-2xl p-8 w-[420px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Create Playlist</h2>
          <button onClick={onClose} className="text-outline hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="mb-6">
          <label className="text-outline text-sm mb-2 block">Playlist Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="My Playlist" className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-outline focus:outline-none focus:border-primary" />
        </div>

        <button onClick={() => name.trim() && onCreate(name.trim())} disabled={!name.trim()} className="w-full py-3 bg-gradient-to-r from-primary to-purple-500 rounded-lg font-medium text-black disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity">
          Create Playlist
        </button>
      </div>
    </div>
  );
}

function EditPlaylistModal({ playlist, onClose, onSave, onDelete }: { playlist: Playlist; onClose: () => void; onSave: (updated: Playlist) => void; onDelete: () => void }) {
  const [name, setName] = useState(playlist.name);
  
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div className="glass-panel rounded-2xl p-8 w-[420px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Edit Playlist</h2>
          <button onClick={onClose} className="text-outline hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="mb-6">
          <label className="text-outline text-sm mb-2 block">Playlist Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary" />
        </div>

        <div className="flex gap-3">
          <button onClick={onDelete} className="flex-1 py-3 bg-red-500/20 text-red-400 rounded-lg font-medium hover:bg-red-500/30 transition-colors">
            Delete
          </button>
          <button onClick={() => name.trim() && onSave({ ...playlist, name: name.trim() })} disabled={!name.trim()} className="flex-1 py-3 bg-gradient-to-r from-primary to-purple-500 rounded-lg font-medium text-black disabled:opacity-50">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState<"library" | "playlists" | "favorites" | "settings" | "search" | "lyrics">("library");
  const [navHistory, setNavHistory] = useState<("library" | "playlists" | "favorites" | "settings" | "search" | "lyrics")[]>(["library"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [currentPlaylist, setCurrentPlaylist] = useState<Playlist | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [titlebarHeight, setTitlebarHeight] = useState(56);
  const [footerHeight, setFooterHeight] = useState(() => loadFromStorage("alora_footerHeight", 80));
  const [isExpanded, setIsExpanded] = useState(true);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [showQueue, setShowQueue] = useState(false);
  const [recentPlaylistIds, setRecentPlaylistIds] = useState<number[]>(() => loadFromStorage("alora_recentPlaylists", []));
  const [sidebarBg, setSidebarBg] = useState<string>('#0e0e0e');
  
  const [tracks, setTracks] = useState<Track[]>(() => loadFromStorage(STORAGE_KEYS.tracks, []));
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadFromStorage(STORAGE_KEYS.playlists, []));
  const [playlistCovers, setPlaylistCovers] = useState<Record<number, string>>({});
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
  const [dominantColor, setDominantColor] = useState<string>("");
  const [gaplessEnabled, setGaplessEnabled] = useState(true);
  const [normEnabled, setNormEnabled] = useState(() => loadFromStorage("alora_normEnabled", true));
  
  const EQ_PRESETS: Record<string, number[]> = {
    "Flat": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "Bass": [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
    "Treble": [0, 0, 0, 0, 0, 2, 4, 5, 6, 6],
    "Rock": [5, 4, 2, 0, -1, 0, 2, 4, 5, 5],
    "Pop": [-1, 0, 2, 4, 5, 4, 2, 0, -1, -2],
    "Jazz": [3, 2, 0, 1, -1, -1, 0, 1, 2, 3],
    "Classical": [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
    "Electronic": [5, 4, 1, 0, -2, -1, 0, 2, 4, 5],
    "HipHop": [6, 5, 3, 1, -1, -1, 0, 2, 3, 4],
    "Acoustic": [3, 2, 1, 1, 2, 2, 3, 3, 2, 2],
  };
  const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  
  const [eqEnabled, setEqEnabled] = useState(() => loadFromStorage("alora_eqEnabled", false));
  const [eqBands, setEqBands] = useState<number[]>(() => loadFromStorage("alora_eqBands", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const [eqPreset, setEqPreset] = useState("Flat");
  
  const [showOverlay, setShowOverlay] = useState(false);
  const [showDeviceMenu, setShowDeviceMenu] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(() => loadFromStorage("alora_device", "Default"));
  const [audioDevices, setAudioDevices] = useState<string[]>([]);

  const setupAudioWithEQ = useCallback(() => {
    if (!audioRef.current || audioContextRef.current) return;

    const ctx = new AudioContext();
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
      filter.gain.value = eqEnabled ? eqBands[i] : 0;

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
  }, [eqEnabled, eqBands]);

  useEffect(() => {
    if (eqFiltersRef.current.length > 0) {
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

  useEffect(() => { saveToStorage("alora_footerHeight", footerHeight); }, [footerHeight]);

  useEffect(() => {
    invoke<string[]>("get_audio_devices").then(devs => {
      if (devs.length > 0) setAudioDevices(devs);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showDeviceMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!document.getElementById("device-menu")?.contains(target)) setShowDeviceMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDeviceMenu]);
  
  useEffect(() => {
    if (currentTrack?.cover) {
      getAverageColor(currentTrack.cover).then(color => {
        setSidebarBg(color);
      });
    } else {
      setSidebarBg('#0e0e0e');
    }
  }, [currentTrack?.cover]);
  
  useEffect(() => {
    const loadCovers = async () => {
      const covers: Record<number, string> = {};
      for (const playlist of playlists) {
        try {
          const cover = await invoke<string | null>("get_folder_cover", { path: playlist.path });
          if (cover) covers[playlist.id] = cover;
        } catch {}
      }
      setPlaylistCovers(covers);
    };
    loadCovers();
  }, [playlists]);

  useEffect(() => {
    const cover = currentPlaylist ? playlistCovers[currentPlaylist.id] : undefined;
    if (cover) {
      getAverageColor(cover).then(setDominantColor);
    } else {
      setDominantColor("");
    }
  }, [currentPlaylist, playlistCovers]);


  setTrackLoudness;
  setGaplessEnabled;
  setNormEnabled;

  const navigateTo = (view: "library" | "playlists" | "favorites" | "settings" | "search" | "lyrics") => {
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
  const activeSrcRef = useRef<string>("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const gainNodeRef = useRef<GainNode | null>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);
  const nextTrackFnRef = useRef<(() => void) | null>(null);
  const prevTrackFnRef = useRef<(() => void) | null>(null);
  const transitioningRef = useRef(false);
  const analyzingRef = useRef<Set<number>>(new Set());
  const playlistLoadRef = useRef<{ id: number; abort: () => void } | null>(null);
  const trackOrderRef = useRef<number[]>([]);
  const currentIndexRef = useRef<number>(-1);
  const trackTriggeredRef = useRef(false);

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

  useEffect(() => {
    if (currentTrack) {
      activeSrcRef.current = "";
      setProgress(0);
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
      stopProgressTracking();
      if (isPlaying) {
        setTimeout(() => startProgressTracking(), 50);
      }
    }
  }, [currentTrack]);

  const loadLibrary = async () => {
    trackOrderRef.current = [];
    currentIndexRef.current = -1;
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
            
            playlists.push({ 
              id: playlistId++, 
              name, 
              path: fullPath, 
              track_count: trackCount
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
      saveToStorageAsync(STORAGE_KEYS.tracks, newTracks);
      setPlaylists(playlists);
      saveToStorageAsync(STORAGE_KEYS.playlists, playlists);
    } catch (e) { 
      console.error("Failed to load library:", e);
    }
  };

  const addToHistory = useCallback((track: Track) => {
    setHistory(prev => {
      const filtered = prev.filter(h => h.trackPath !== track.path);
      const updated = [{ trackPath: track.path, title: track.title, artist: track.artist, playedAt: Date.now() }, ...filtered].slice(0, 50);
      saveToStorageAsync(STORAGE_KEYS.history, updated);
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
            saveToStorageAsync(STORAGE_KEYS.tracks, updated);
            return updated;
          });
        }
      } catch (e) { console.error("Failed to load metadata:", e); }
    }
    
    if (normEnabled && !trackLoudness.has(updatedTrack.id) && !analyzingRef.current.has(updatedTrack.id)) {
      analyzingRef.current.add(updatedTrack.id);
      try {
        const loudness = await invoke<{ integrated_lufs: number; true_peak_dbtp: number; gain_db: number } | null>("get_track_loudness", { path: updatedTrack.path });
        if (loudness) {
          setTrackLoudness(prev => new Map(prev).set(updatedTrack.id, loudness.gain_db));
        }
      } catch (e) { console.error("Failed to load loudness:", e); }
      finally {
        analyzingRef.current.delete(updatedTrack.id);
      }
    }
    
    setCurrentTrack(updatedTrack);
    setIsPlaying(true);
    addToHistory(updatedTrack);
    if (audioRef.current) {
      transitioningRef.current = false;
      trackTriggeredRef.current = false;
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
        progressInterval.current = null;
      }
      try {
        const src = convertFileSrc(updatedTrack.path);
        audioRef.current.src = src;
        audioRef.current.onerror = (e) => console.error("Audio error:", e);
        audioRef.current.onloadedmetadata = () => {
          if (audioRef.current && audioRef.current.duration && !updatedTrack.duration) {
            setCurrentTrack(prev => prev ? { ...prev, duration: Math.floor(audioRef.current!.duration) } : null);
          }
        };
        audioRef.current.play().catch(e => { if (e.name !== 'AbortError') console.error("Play error:", e); });
        
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
    
    if (shuffleEnabled) {
      const nextIdx = Math.floor(Math.random() * sorted.length);
      if (sorted[nextIdx]) playTrack(sorted[nextIdx]);
      return;
    }
    
    if (trackOrderRef.current.length === 0 || !trackOrderRef.current.includes(currentTrack.id)) {
      trackOrderRef.current = sorted.map(t => t.id);
    }
    
    const currentIdx = trackOrderRef.current.indexOf(currentTrack.id);
    const nextIdx = currentIdx + 1;
    
    if (nextIdx < trackOrderRef.current.length) {
      const nextId = trackOrderRef.current[nextIdx];
      const nextT = sorted.find(t => t.id === nextId);
      if (nextT) playTrack(nextT);
    }
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
      if (!audioRef.current || !audioRef.current.src) return;
      const currentSrc = audioRef.current.src;
      if (activeSrcRef.current && currentSrc !== activeSrcRef.current) return;
      const currentTime = audioRef.current.currentTime;
      const duration = audioRef.current.duration;
      if (!duration || duration === 0 || isNaN(duration)) return;
      const currentProgress = (currentTime / duration) * 100;
      if (activeSrcRef.current) setProgress(currentProgress);
      if (!activeSrcRef.current) activeSrcRef.current = currentSrc;
      
      if (transitioningRef.current || trackTriggeredRef.current) return;
      
      if (gaplessEnabled && currentTime >= duration - 0.3) {
        trackTriggeredRef.current = true;
        transitioningRef.current = true;
        nextTrack();
      } else if (!gaplessEnabled && currentProgress >= 99) {
        trackTriggeredRef.current = true;
        transitioningRef.current = true;
        nextTrack();
      }
    }, 200);
  };

  const stopProgressTracking = () => {
    if (progressInterval.current) { clearInterval(progressInterval.current); progressInterval.current = null; }
    transitioningRef.current = false;
    trackTriggeredRef.current = false;
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

  const handleSelectPlaylist = useCallback(async (playlist: Playlist) => {
    if (playlistLoadRef.current) {
      playlistLoadRef.current.abort();
      playlistLoadRef.current = null;
    }
    trackOrderRef.current = [];
    currentIndexRef.current = -1;
    const loadId = playlist.id;
    let cancelled = false;
    playlistLoadRef.current = { id: loadId, abort: () => { cancelled = true; } };

    try {
      setCurrentPlaylist({ ...playlist, cover: undefined });
      setCurrentView("library");

      const entries = await readDir(playlist.path);
      if (cancelled || playlistLoadRef.current?.id !== loadId) return;

      const existingMeta = new Map(tracks.map((t, i) => [t.path, tracks[i]]));

      const musicFiles = entries.filter(e => isMusicFile(e.name));
      const newTracks: Track[] = musicFiles.map((entry, idx) => {
        const fullPath = playlist.path + (playlist.path.endsWith('\\') ? '' : '\\') + entry.name;
        const cached = existingMeta.get(fullPath);
        if (cached && cached.artist !== 'Unknown Artist') return cached;
        return { id: Date.now() + idx, path: fullPath, title: entry.name.replace(/\.[^.]+$/, ''), artist: 'Unknown Artist', album: 'Unknown Album', duration: 0, cover: undefined };
      });

      setTracks(newTracks);

      const folderCover = await invoke<string | null>("get_folder_cover", { path: playlist.path });
      if (cancelled || playlistLoadRef.current?.id !== loadId) return;

      setPlaylists(prev => {
        const updated = prev.map(p => p.path === playlist.path ? { ...playlist, track_count: newTracks.length, cover: folderCover || undefined } : p);
        saveToStorageAsync(STORAGE_KEYS.playlists, updated);
        return updated;
      });
      setCurrentPlaylist({ ...playlist, cover: folderCover || undefined });
      setRecentPlaylistIds(prev => {
        const updated = [playlist.id, ...prev.filter(id => id !== playlist.id)].slice(0, 6);
        saveToStorage("alora_recentPlaylists", updated);
        return updated;
      });

      setTimeout(async () => {
        if (cancelled || playlistLoadRef.current?.id !== loadId) return;
        const updatedTracks: Track[] = [];
        for (let i = 0; i < newTracks.length; i++) {
          if (cancelled || playlistLoadRef.current?.id !== loadId) return;
          const track = newTracks[i];
          const cached = existingMeta.get(track.path);
          if (cached && cached.artist !== 'Unknown Artist' && cached.cover) {
            updatedTracks.push(cached);
            continue;
          }
          if (cancelled || playlistLoadRef.current?.id !== loadId) return;
          try {
            const meta = await invoke<{ title: string; artist: string; album: string; duration: number; cover: string | null; lyrics: string | null } | null>("get_audio_metadata", { path: track.path });
            if (meta && !cancelled && playlistLoadRef.current?.id === loadId) {
              updatedTracks.push({ ...track, title: meta.title, artist: meta.artist, album: meta.album, duration: meta.duration, cover: meta.cover || undefined, lyrics: meta.lyrics || undefined });
            } else {
              updatedTracks.push(track);
            }
          } catch {
            updatedTracks.push(track);
          }
        }
        if (!cancelled && playlistLoadRef.current?.id === loadId) {
          setTracks(updatedTracks);
          saveToStorageAsync(STORAGE_KEYS.tracks, updatedTracks);
        }
      }, 50);
    } catch (e) { console.error("Failed to load playlist:", e); }
  }, [tracks]);

  const handleCreatePlaylist = () => {
    setShowCreatePlaylist(true);
  };

  const handleConfirmCreatePlaylist = (name: string) => {
    const newPlaylist: Playlist = {
      id: Date.now(),
      name,
      path: "",
      track_count: 0
    };
    setPlaylists(prev => {
      const updated = [...prev, newPlaylist];
      saveToStorageAsync(STORAGE_KEYS.playlists, updated);
      return updated;
    });
    setShowCreatePlaylist(false);
  };

  const handleSavePlaylist = (updated: Playlist) => {
    setPlaylists(prev => {
      const newList = prev.map(p => p.id === updated.id ? updated : p);
      saveToStorageAsync(STORAGE_KEYS.playlists, newList);
      return newList;
    });
    setEditingPlaylist(null);
  };

  const handleDeletePlaylist = () => {
    if (editingPlaylist) {
      setPlaylists(prev => {
        const newList = prev.filter(p => p.id !== editingPlaylist.id);
        saveToStorageAsync(STORAGE_KEYS.playlists, newList);
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
      <div className="fixed inset-0 flex flex-col items-center justify-center z-[100]">
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
    <div className="flex flex-col h-screen bg-gradient-to-br from-[#0c0507] via-[#0f0e0f] to-neutral-950 text-on-surface overflow-hidden">
      <audio
          ref={audioRef}
          crossOrigin="anonymous"
          onEnded={() => nextTrack()}
        />
      
      
      
      {showCreatePlaylist && <CreatePlaylistModal onClose={() => setShowCreatePlaylist(false)} onCreate={handleConfirmCreatePlaylist} />}
      {editingPlaylist && <EditPlaylistModal playlist={editingPlaylist} onClose={() => setEditingPlaylist(null)} onSave={handleSavePlaylist} onDelete={handleDeletePlaylist} />}
      
      <header className={`fixed top-0 left-0 right-0 z-[60] bg-black/20 backdrop-blur-xl border-b border-white/[0.04] flex items-center justify-between pl-4`} style={{ height: titlebarHeight }} data-tauri-drag-region>
        <div className="flex items-center gap-2">
          <button onClick={() => navigateTo("settings")} className="p-2 text-outline hover:text-primary transition-colors" title="Settings">
            <MoreHorizontal className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1">
            <button onClick={goBack} disabled={historyIndex === 0} className={`p-2 transition-colors ${historyIndex === 0 ? 'text-white/20 cursor-not-allowed' : 'text-outline hover:text-primary'}`}><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={goForward} disabled={historyIndex === navHistory.length - 1} className={`p-2 transition-colors ${historyIndex === navHistory.length - 1 ? 'text-white/20 cursor-not-allowed' : 'text-outline hover:text-primary'}`}><ChevronRight className="w-4 h-4" /></button>
          </div>
          <button onClick={() => { setCurrentPlaylist(null); setCurrentView("library"); }} className={`p-2 transition-colors ${currentView === "library" && !currentPlaylist ? "text-primary" : "text-outline hover:text-primary"}`} title="Home">
            <Home className="w-4 h-4" />
          </button>
        </div>
        
{titlebarHeight >= 50 && (
          <div className="flex-1 flex justify-start ml-4 md:ml-8 lg:ml-12 xl:ml-16 px-4">
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
        <aside className={`h-full bg-black/25 backdrop-blur-xl border-r border-white/[0.04] transition-all duration-300 ease-in-out flex flex-col py-6 fixed left-0 z-40 ${isExpanded ? 'w-64 px-4' : 'w-[72px] px-0'}`} style={{ top: titlebarHeight, height: `calc(100vh - ${titlebarHeight}px)` }}>
          <div className={`flex ${isExpanded ? 'justify-end' : 'justify-center'} mb-4`}>
            <button 
              onClick={() => setIsExpanded(!isExpanded)}
              className="w-6 h-6 flex items-center justify-center text-stone-500 hover:text-stone-300 transition-colors"
            >
              {isExpanded ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto">
            {isExpanded && <div className="text-stone-500 uppercase tracking-widest text-[10px] font-semibold mb-3">BROWSE</div>}
            <button onClick={() => navigateTo("playlists")} className={`w-full py-3 rounded-sm transition-all duration-300 ${currentView === "playlists" ? "border-l-2 border-primary/70 bg-gradient-to-r from-primary/20 to-transparent text-primary/90" : "text-stone-400 font-normal opacity-80 hover:text-stone-200 hover:opacity-100"}`}>
              <div className={`flex items-center ${isExpanded ? 'justify-start px-3 gap-x-4' : 'justify-center'}`}>
                <PlaylistIcon className={`w-5 h-5 shrink-0 ${currentView === "playlists" ? "text-primary" : ""}`} />
                {isExpanded && <span className="text-sm">Playlists</span>}
              </div>
            </button>
            <button onClick={() => navigateTo("search")} className={`w-full py-3 rounded-sm transition-all duration-300 ${currentView === "search" ? "border-l-2 border-primary/70 bg-gradient-to-r from-primary/20 to-transparent text-primary/90" : "text-stone-400 font-normal opacity-80 hover:text-stone-200 hover:opacity-100"}`}>
              <div className={`flex items-center ${isExpanded ? 'justify-start px-3 gap-x-4' : 'justify-center'}`}>
                <Search className={`w-5 h-5 shrink-0 ${currentView === "search" ? "text-primary" : ""}`} />
                {isExpanded && <span className="text-sm">Search</span>}
              </div>
            </button>
            <button onClick={() => {
              if (favorites.length > 0) {
                setTracks(favorites.map(f => ({ ...f, id: f.id, title: f.title, artist: f.artist, album: f.album || 'Unknown', duration: f.duration || 0, cover: f.cover })));
                setCurrentPlaylist({ id: -1, name: 'Favorites', path: '', track_count: favorites.length, cover: undefined });
                setCurrentView("library");
              } else {
                navigateTo("favorites");
              }
            }} className={`w-full py-3 rounded-sm transition-all duration-300 ${currentView === "favorites" || currentPlaylist?.id === -1 ? "border-l-2 border-primary/70 bg-gradient-to-r from-primary/20 to-transparent text-primary/90" : "text-stone-400 font-normal opacity-80 hover:text-stone-200 hover:opacity-100"}`}>
              <div className={`flex items-center ${isExpanded ? 'justify-start px-3 gap-x-4' : 'justify-center'}`}>
                <Heart className={`w-5 h-5 shrink-0 ${currentView === "favorites" || currentPlaylist?.id === -1 ? "text-primary" : ""}`} />
                {isExpanded && (
                  <div className="flex flex-col items-start">
                    <span className="text-sm">Favorites</span>
                    <span className="text-[10px] opacity-60">{favorites.length} tracks</span>
                  </div>
                )}
              </div>
            </button>
</nav>

          <div className={`mt-4 pb-24 ${isExpanded ? 'px-4' : 'px-0'}`}>
            {isExpanded && <div className="text-stone-500 uppercase tracking-widest text-[10px] font-semibold mb-3">PLAYLISTS</div>}
            
            {isExpanded ? (
                <div className="space-y-1 max-h-[300px] overflow-y-auto pr-2">
                  {favorites.length > 0 && (
                    <button 
                      onClick={() => {
                        setTracks(favorites.map(f => ({ ...f, id: f.id, title: f.title, artist: f.artist, album: f.album || 'Unknown', duration: f.duration || 0, cover: f.cover })));
                        setCurrentPlaylist({ id: -1, name: 'Favorites', path: '', track_count: favorites.length, cover: undefined });
                        setCurrentView("library");
                      }}
                      className={`w-full flex items-center gap-3 py-2 rounded-md hover:bg-white/5 transition-all group ${currentPlaylist?.id === -1 ? 'border-l-2 border-primary/70 bg-primary/10' : ''}`}
                    >
                      <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-rose-950 via-rose-900 to-red-950 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_4px_12px_rgba(159,18,57,0.2)] flex items-center justify-center">
                        <Heart className="w-5 h-5 text-rose-100" style={{ fill: '#fda4af' }} />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <div className="text-xs text-stone-200 truncate group-hover:text-primary transition-colors">Favorites</div>
                        <div className="text-[10px] text-stone-500 truncate">{favorites.length} tracks</div>
                      </div>
                    </button>
                  )}
                  {playlists.map((playlist) => (
                    <button 
                      key={playlist.id}
                      onClick={() => handleSelectPlaylist(playlist)}
                      className={`w-full flex items-center gap-3 py-2 rounded-md hover:bg-white/5 transition-all group ${currentPlaylist?.id === playlist.id ? 'border-l-2 border-primary/70 bg-primary/10' : ''}`}
                    >
                      <div className="w-11 h-11 shrink-0 rounded-xl overflow-hidden bg-neutral-800 flex items-center justify-center">
                        {playlistCovers?.[playlist.id] ? (
                          <img src={playlistCovers[playlist.id]} alt="" className="w-full h-full object-cover" />
                        ) : playlist.name.toLowerCase().includes('download') || playlist.name.toLowerCase().includes('down') ? (
                          <Download className="w-5 h-5 text-stone-500" />
                        ) : (
                          <PlaylistIcon className="w-5 h-5 text-stone-500" />
                        )}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <div className="text-xs text-stone-200 truncate group-hover:text-primary transition-colors">{playlist.name}</div>
                        <div className="text-[10px] text-stone-500 truncate">{playlist.track_count} tracks</div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  {favorites.length > 0 && (
                    <button 
                      onClick={() => {
                        setTracks(favorites.map(f => ({ ...f, id: f.id, title: f.title, artist: f.artist, album: f.album || 'Unknown', duration: f.duration || 0, cover: f.cover })));
                        setCurrentPlaylist({ id: -1, name: 'Favorites', path: '', track_count: favorites.length, cover: undefined });
                        setCurrentView("library");
                      }}
                      className="w-11 h-11 shrink-0 rounded-xl border border-white/10 bg-gradient-to-br from-rose-950 via-rose-900 to-red-950 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_4px_12px_rgba(159,18,57,0.2),0_4px_16px_rgba(0,0,0,0.4)] flex items-center justify-center hover:scale-105 transition-transform"
                    >
                      <Heart className="w-5 h-5 text-rose-100" style={{ fill: '#fda4af' }} />
                    </button>
                  )}
                  {recentPlaylistIds.map(id => playlists.find(p => p.id === id)).filter((p): p is Playlist => p !== undefined).map((playlist) => (
                    <button 
                      key={playlist.id}
                      onClick={() => handleSelectPlaylist(playlist)}
                      className="w-11 h-11 shrink-0 rounded-xl border border-white/10 overflow-hidden bg-neutral-800 shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
                    >
                      {playlistCovers?.[playlist.id] ? (
                        <img src={playlistCovers[playlist.id]} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <PlaylistIcon className="w-5 h-5 text-stone-500" />
                      )}
                    </button>
                  ))}
                </div>
              )
}
          </div>
        </aside>

        <main className="flex-1 relative h-[calc(100vh-3.5rem)] overflow-y-auto p-2 md:p-4 border-t border-white/[0.04]" style={{ marginLeft: isExpanded ? 256 : 72, marginRight: rightSidebarWidth, marginBottom: footerHeight }}>
          <div className="fixed inset-0 pointer-events-none z-[-1] opacity-40 mix-blend-overlay" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")'}}></div>
          <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary-container/5 pointer-events-none z-[-1]"></div>
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[150px] pointer-events-none z-[-1]"></div>

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
                playlistCover={currentPlaylist ? playlistCovers[currentPlaylist.id] : undefined}
                sortBy={sortBy}
                onSortBy={setSortBy}
                allPlaylists={playlists}
                playlistCovers={playlistCovers}
                onSelectPlaylist={handleSelectPlaylist}
                dominantColor={dominantColor}
              />
            )}
            {currentView === "playlists" && (
              <PlaylistsPage 
                playlists={playlists}
                playlistCovers={playlistCovers}
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
            {currentView === "search" && (
              <SearchPage onPlayTrack={playTrack} />
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
            {currentView === "lyrics" && (
              <LyricsPage currentTrack={currentTrack} averageColor={sidebarBg === '#0e0e0e' ? '#f7bd48' : sidebarBg} />
            )}
          </div>
        </main>
        
        <aside 
          className="fixed right-0 bg-black/25 backdrop-blur-xl border-l border-white/[0.04] flex flex-col z-40"
          style={{ width: rightSidebarWidth, top: titlebarHeight, height: `calc(100vh - ${titlebarHeight}px - ${footerHeight}px)`, background: `linear-gradient(180deg, ${sidebarBg} 0%, rgba(14, 14, 14, 1) 100%)` }}
        >
          <div 
            className="absolute left-0 top-0 w-1 h-full cursor-ew-resize hover:bg-primary/50"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = rightSidebarWidth;
              const onMouseMove = (moveEvent: MouseEvent) => {
                const newWidth = Math.max(200, Math.min(500, startWidth - (moveEvent.clientX - startX)));
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
          <div className="p-4 flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] uppercase tracking-widest text-zinc-300 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">{showQueue ? "Queue" : "Now Playing"}</span>
              <button onClick={() => setShowQueue(!showQueue)} className="text-[10px] uppercase tracking-wider text-outline hover:text-primary transition-colors px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 shadow-sm">
                {showQueue ? "Now Playing" : "Show Queue"}
              </button>
            </div>
              
            {showQueue ? (
              <div className="flex-1 overflow-y-auto space-y-1">
                {(() => {
                  const sorted = getSortedTracks();
                  const currentId = currentTrack?.id;
                  if (sorted.length === 0) return <div className="text-xs text-outline text-center py-8">No tracks in queue</div>;

                  let order: number[];
                  if (trackOrderRef.current.length > 0 && currentId && trackOrderRef.current.includes(currentId)) {
                    order = trackOrderRef.current;
                  } else {
                    order = sorted.map(t => t.id);
                  }

                  const currentIdx = currentId ? order.indexOf(currentId) : -1;
                  const orderedTracks = currentIdx >= 0
                    ? [...order.slice(currentIdx), ...order.slice(0, currentIdx)]
                    : order;

                  return orderedTracks.map((id) => {
                    const track = sorted.find(t => t.id === id);
                    if (!track) return null;
                    return (
                      <button
                        key={track.id}
                        onClick={() => playTrack(track)}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all text-left group ${track.id === currentId ? 'bg-white/5 text-primary' : 'text-outline hover:text-on-surface hover:bg-white/5'}`}
                      >
                        <div className="w-8 h-8 rounded overflow-hidden shrink-0 bg-surface-container">
                          {track.cover ? (
                            <img src={track.cover} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Music className="w-4 h-4 m-2 opacity-40" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs truncate ${track.id === currentId ? 'text-primary' : 'text-on-surface'}`}>{track.title}</div>
                          <div className="text-[10px] truncate opacity-60">{track.artist}</div>
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>
            ) : currentTrack ? (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="text-center mb-3">
                  <button onClick={() => { setSearchQuery(currentTrack.artist); setCurrentView("library"); }} className="text-sm text-zinc-300 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] font-medium hover:text-primary transition-colors">{currentTrack.artist}</button>
                </div>
                
                <div className="w-full aspect-square rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.5)] mb-4 bg-surface-container shrink-0">
                  {currentTrack.cover ? (
                    <img src={currentTrack.cover} alt="" className="w-full h-full object-cover" />
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
                
                <div className="flex-1 overflow-y-auto space-y-2 text-xs text-outline">
                  {currentTrack.album && currentTrack.album !== 'Unknown Album' && (
                    <div className="flex justify-between py-1.5 border-b border-white/[0.05]">
                      <span>Album</span>
                      <span className="text-on-surface truncate ml-4 text-right max-w-[120px]">{currentTrack.album}</span>
                    </div>
                  )}
                  {currentTrack.duration > 0 && (
                    <div className="flex justify-between py-1.5 border-b border-white/[0.05]">
                      <span>Duration</span>
                      <span className="text-on-surface">{formatDuration(currentTrack.duration)}</span>
                    </div>
                  )}
                  {currentTrack.path && (
                    <div className="flex justify-between py-1.5 border-b border-white/[0.05]">
                      <span>Path</span>
                      <span className="text-on-surface truncate ml-4 text-right max-w-[120px]">{currentTrack.path.split('\\').pop()}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1.5 border-b border-white/[0.05]">
                    <span>Format</span>
                    <span className="text-on-surface">{currentTrack.path?.split('.').pop()?.toUpperCase() || 'Unknown'}</span>
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

      <footer className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.04] bg-neutral-950" style={{ height: footerHeight }}>
        <div className="absolute top-0 left-0 w-full h-1 cursor-ns-resize hover:bg-primary/50 z-50" onMouseDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startH = footerHeight;
          const onMouseMove = (ev: MouseEvent) => setFooterHeight(Math.max(60, Math.min(140, startH - (ev.clientY - startY))));
          const onMouseUp = () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        }} />
        <div className="relative h-full flex items-center">
          <div className="absolute inset-0 opacity-[0.015] mix-blend-overlay pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")'}} />
          <div className="absolute top-0 left-0 w-full h-px pointer-events-none" style={{ background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.08) 20%, rgba(255,255,255,0.08) 80%, transparent)' }} />
          <div className="absolute bottom-0 left-0 w-full h-px pointer-events-none" style={{ background: 'linear-gradient(to right, transparent, rgba(247,189,72,0.05) 20%, rgba(247,189,72,0.05) 80%, transparent)' }} />

          <div className="h-full flex items-center pl-6 gap-3 flex-shrink-0" style={{ width: "280px" }}>
            {isPlaying && (
              <div className="flex items-end gap-px h-4 shrink-0 px-1.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.06]">
                <div className="w-0.5 bg-primary rounded-full animate-eq-bar-1" style={{ height: "50%" }} />
                <div className="w-0.5 bg-primary rounded-full animate-eq-bar-2" style={{ height: "80%" }} />
                <div className="w-0.5 bg-primary rounded-full animate-eq-bar-3" style={{ height: "35%" }} />
                <div className="w-0.5 bg-primary rounded-full animate-eq-bar-1" style={{ height: "65%" }} />
              </div>
            )}
            <div className="relative group shrink-0">
              {currentTrack?.cover ? (
                <img src={currentTrack.cover} alt="" className="w-10 h-10 rounded-lg object-cover cursor-pointer hover:brightness-110 transition-all" onClick={() => setShowOverlay(true)} />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-secondary-container/20 flex items-center justify-center">
                  <Music className="w-5 h-5 text-white/20" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-lg cursor-pointer transition-opacity" onClick={() => setShowOverlay(true)}>
                <Maximize2 className="w-3.5 h-3.5 text-white" />
              </div>
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="text-[11px] text-on-surface truncate leading-tight">{currentTrack?.title || "No track"}</div>
              <div className="text-[10px] text-outline truncate cursor-pointer" onClick={() => currentTrack && (setSearchQuery(currentTrack.artist), setCurrentView("library"))}>{currentTrack?.artist || "—"}</div>
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center h-full">
            <div className="flex items-center gap-1">
              <button onClick={toggleShuffle} className={`p-2 rounded-full transition-all duration-200 active:scale-90 ${shuffleEnabled ? "text-primary" : "text-white/30 hover:text-white/60 hover:bg-white/5"}`} title="Shuffle">
                <Shuffle className="w-3.5 h-3.5" />
              </button>
              <button onClick={prevTrack} className="p-2 rounded-full text-white/40 hover:text-white hover:bg-white/5 transition-all duration-200 active:scale-90" title="Previous">
                <SkipBack className="w-4.5 h-4.5" />
              </button>
              <button onClick={togglePlay} className="p-2 rounded-full hover:bg-white/5 transition-all duration-200 active:scale-90" title="Play">
                {isPlaying ? <Pause className="w-6.5 h-6.5" /> : <Play className="w-6.5 h-6.5" />}
              </button>
              <button onClick={nextTrack} className="p-2 rounded-full text-white/40 hover:text-white hover:bg-white/5 transition-all duration-200 active:scale-90" title="Next">
                <SkipForward className="w-4.5 h-4.5" />
              </button>
              <button onClick={toggleRepeat} className={`p-2 rounded-full transition-all duration-200 active:scale-90 ${repeatMode !== "none" ? "text-primary" : "text-white/30 hover:text-white/60 hover:bg-white/5"}`} title="Repeat">
                <Repeat className={`w-3.5 h-3.5 ${repeatMode === "one" ? "rotate-90" : ""}`} />
              </button>
            </div>
            <div className="w-full max-w-xl flex items-center gap-2 mt-0.5">
              <span className="text-[9px] text-outline w-8 text-right font-mono shrink-0 leading-none">{formatDuration(currentTrack ? Math.floor((progress / 100) * currentTrack.duration) : 0)}</span>
              <div className="flex-1 h-1 bg-white/[0.08] rounded-full overflow-hidden cursor-pointer relative group" onClick={handleProgressClick}>
                <div className="absolute top-0 left-0 h-full rounded-full" style={{ width: `${progress}%`, background: '#f7bd48', boxShadow: '0 0 6px rgba(247,189,72,0.5)' }} />
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-primary rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ left: `${progress}%` }} />
              </div>
              <span className="text-[9px] text-outline w-8 font-mono shrink-0 leading-none">{currentTrack ? formatDuration(currentTrack.duration) : "0:00"}</span>
            </div>
          </div>

          <div className="flex items-center justify-end pr-6 gap-1 flex-shrink-0" style={{ width: "280px" }}>
            <button onClick={() => setCurrentView(currentView === "lyrics" ? "library" : "lyrics")} className={`p-2 rounded-full transition-all duration-200 active:scale-90 ${currentView === "lyrics" ? "text-primary" : "text-white/30 hover:text-white/60 hover:bg-white/5"}`} title="Lyrics">
              <FileText className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-white/[0.06] mx-1" />
            <div className="relative" id="device-menu">
              <button onClick={() => setShowDeviceMenu(!showDeviceMenu)} className={`p-2 rounded-full transition-all duration-200 active:scale-90 ${showDeviceMenu ? "text-primary bg-white/5" : "text-white/30 hover:text-white/60 hover:bg-white/5"}`} title="Output Device">
                <Monitor className="w-3.5 h-3.5" />
              </button>
              {showDeviceMenu && (
                <div className="absolute bottom-full right-0 mb-2 w-56 bg-black/20 backdrop-blur-xl border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden z-[100]">
                  <div className="p-2">
                    <div className="text-[9px] uppercase tracking-widest text-outline px-3 py-1.5">Output Device</div>
                    {audioDevices.length > 0 ? audioDevices.map(d => (
                      <button key={d} onClick={() => { setSelectedDevice(d); saveToStorage("alora_device", d); setShowDeviceMenu(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-[11px] transition-colors truncate ${selectedDevice === d ? "text-primary bg-white/5" : "text-white/60 hover:text-white hover:bg-white/5"}`}>
                        {d}
                      </button>
                    )) : (
                      <button onClick={() => setShowDeviceMenu(false)} className="w-full text-left px-3 py-2 rounded-lg text-[11px] text-white/40">Loading...</button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="w-px h-4 bg-white/[0.06] mx-1" />
            <button onClick={toggleMute} className="p-2 rounded-full text-white/30 hover:text-white/60 hover:bg-white/5 transition-all duration-200 active:scale-90" title="Volume">
              {volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <div className="w-16 h-1 bg-white/[0.08] rounded-full overflow-hidden relative group">
              <div className="absolute top-0 left-0 h-full rounded-full" style={{ width: `${volume}%`, background: '#f7bd48', boxShadow: '0 0 4px rgba(247,189,72,0.4)' }} />
              <input type="range" min="0" max="100" value={volume} onChange={handleVolumeChange} className="absolute inset-0 w-full h-4 -translate-y-1/2 top-1/2 opacity-0 cursor-pointer" />
            </div>
            
            {currentTrack && (
              <button onClick={() => toggleFavorite(currentTrack)} className="p-2 rounded-full hover:bg-white/5 transition-all duration-200 active:scale-90" style={{ boxShadow: favorites.some(f => f.path === currentTrack?.path) ? '0 0 8px rgba(239,68,68,0.5)' : 'none' }}>
                {favorites.some(f => f.path === currentTrack?.path) ? <HeartFilled className="w-3.5 h-3.5" style={{ color: '#ef4444', fill: '#ef4444' }} /> : <Heart className="w-3.5 h-3.5" style={{ color: '#ef4444' }} />}
              </button>
            )}
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
