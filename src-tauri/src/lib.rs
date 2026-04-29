use base64::{Engine as _, engine::general_purpose};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

struct RPCState {
    enabled: bool,
    client_id: String,
    current_track: Option<String>,
    last_update: u64,
}

static RPC_STATE: Lazy<Mutex<RPCState>> = Lazy::new(|| {
    Mutex::new(RPCState {
        enabled: false,
        client_id: String::new(),
        current_track: None,
        last_update: 0,
    })
});

static APPLE_ARTWORK_CACHE: Lazy<Mutex<HashMap<String, String>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static RPC_RUNNING: AtomicBool = AtomicBool::new(false);
static RPC_CLIENT: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));
static RPC_LAST_UPDATE: AtomicU64 = AtomicU64::new(0);

fn fetch_apple_artwork(artist: &str, title: &str) -> Option<String> {
    if artist.is_empty() || title.is_empty() {
        return None;
    }
    
    let cache_key = format!("{}||{}", artist.to_lowercase(), title.to_lowercase());
    if let Ok(cache) = APPLE_ARTWORK_CACHE.lock() {
        if let Some(url) = cache.get(&cache_key) {
            return Some(url.clone());
        }
    }
    
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build() 
    {
        Ok(c) => c,
        Err(_) => return None,
    };
    
    let url = format!(
        "https://itunes.apple.com/search?term={}&entity=song&limit=1",
        urlencoding::encode(&format!("{} {}", artist, title))
    );
    
    let response = match client.get(&url).send() {
        Ok(r) => r,
        Err(_) => return None,
    };
    
    let text = match response.text() {
        Ok(t) => t,
        Err(_) => return None,
    };
    
    let json: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return None,
    };
    
    if let Some(results) = json.get("results").and_then(|v| v.as_array()) {
        if let Some(first) = results.first() {
            if let Some(artwork) = first.get("artworkUrl100").and_then(|v| v.as_str()) {
                let url = artwork.replace("100x100", "600x600");
                if let Ok(mut cache) = APPLE_ARTWORK_CACHE.lock() {
                    cache.insert(cache_key, url.clone());
                }
                return Some(url);
            }
        }
    }
    
    None
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioMetadata {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: u32,
    pub cover: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioLoudness {
    pub integrated_lufs: f32,
    pub true_peak_dbtp: f32,
    pub gain_db: f32,
}

#[tauri::command]
fn get_music_folder() -> String {
    dirs::audio_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "C:\\Music".to_string())
}

#[tauri::command]
fn get_audio_metadata(path: String) -> Option<AudioMetadata> {
    eprintln!("[METADATA] get_audio_metadata called: {}", path);
    
    if !Path::new(&path).exists() {
        eprintln!("[DEBUG] File does not exist: {}", path);
        return None;
    }
    
    let tagged_file = match Probe::open(&path) {
        Ok(p) => match p.read() {
            Ok(tf) => tf,
            Err(e) => {
                eprintln!("[DEBUG] Failed to read file: {:?}", e);
                return None;
            }
        },
        Err(e) => {
            eprintln!("[DEBUG] Failed to probe file: {:?}", e);
            return None;
        }
    };
    
    let tag = match tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
        Some(t) => t,
        None => {
            eprintln!("[DEBUG] No tags found in file");
            return None;
        }
    };
    
    let properties = tagged_file.properties();
    let duration = properties.duration().as_secs() as u32;
    
    let filename = Path::new(&path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    
    let title = tag.title().map(|s| s.to_string()).unwrap_or(filename);
    let artist = tag.artist().map(|s| s.to_string()).unwrap_or_else(|| "Unknown Artist".to_string());
    let album = tag.album().map(|s| s.to_string()).unwrap_or_else(|| "Unknown Album".to_string());
    
    eprintln!("[DEBUG] Found metadata - title: {}, artist: {}, album: {}", title, artist, album);
    
    let cover = tag.pictures().get(0).map(|picture| {
        let base64_img = general_purpose::STANDARD.encode(picture.data());
        let mime = picture.mime_type().map(|m| m.as_str()).unwrap_or("image/jpeg");
        format!("data:{};base64,{}", mime, base64_img)
    });
    
    Some(AudioMetadata { title, artist, album, duration, cover })
}

#[tauri::command]
fn get_audio_cover(path: String) -> Option<String> {
    eprintln!("[DEBUG] get_audio_cover called: {}", path);
    let tagged_file = Probe::open(&path).ok()?.read().ok()?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;
    let picture = tag.pictures().get(0)?;
    let base64_img = general_purpose::STANDARD.encode(picture.data());
    let mime = picture.mime_type().map(|m| m.as_str()).unwrap_or("image/jpeg");
    Some(format!("data:{};base64,{}", mime, base64_img))
}

#[tauri::command]
fn save_audio_cover(path: String) -> Option<String> {
    eprintln!("[SAVE_COVER] Saving cover for: {}", path);
    
    let audio_path = Path::new(&path);
    if !audio_path.exists() {
        eprintln!("[SAVE_COVER] File not found: {}", path);
        return None;
    }
    
    let tagged_file = Probe::open(&path).ok()?.read().ok()?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;
    let picture = tag.pictures().get(0)?;
    let ext = match picture.mime_type() {
        Some(m) => {
            let s = m.as_str();
            if s.contains("png") { "png" } else { "jpg" }
        }
        None => "jpg"
    };
    
    let parent = audio_path.parent()?;
    let filename = format!("folder.{}", ext);
    let cover_path = parent.join(&filename);
    
    fs::write(&cover_path, picture.data()).ok()?;
    eprintln!("[SAVE_COVER] Saved to: {:?}", cover_path);
    
    Some(cover_path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_folder_cover(path: String) -> Option<String> {
    eprintln!("[FOLDER_COVER] Checking: {}", path);
    
    let folder_path = PathBuf::from(&path);
    
    // Если это директория - используем её, иначе parent
    let search_dir = if folder_path.is_dir() {
        &folder_path
    } else {
        folder_path.parent().unwrap_or(&folder_path)
    };
    
    eprintln!("[FOLDER_COVER] Search dir: {:?}", search_dir);
    eprintln!("[FOLDER_COVER] Exists: {:?}", search_dir.exists());
    
    if !search_dir.exists() {
        return None;
    }
    
    let entries = fs::read_dir(search_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.starts_with("cover.") || name.starts_with("folder.") || name.starts_with("front.") || name.starts_with("album.") {
            let ext = entry.path().extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if ["jpg", "jpeg", "png", "gif"].contains(&ext.as_str()) {
                eprintln!("[FOLDER_COVER] Found: {:?}", entry.path());
                let data = fs::read(entry.path()).ok()?;
                let base64_img = general_purpose::STANDARD.encode(&data);
                let mime = if ext == "png" { "image/png" } else { "image/jpeg" };
                return Some(format!("data:{};base64,{}", mime, base64_img));
            }
        }
    }
    
    None
}

#[tauri::command]
fn get_track_loudness(path: String) -> Option<AudioLoudness> {
    eprintln!("[LOUDNESS] Analyzing: {}", path);
    
    if !Path::new(&path).exists() {
        eprintln!("[LOUDNESS] File not found: {}", path);
        return None;
    }
    
    let result = Command::new("ffmpeg")
        .args([
            "-hide_banner", "-loglevel", "error",
            "-i", &path,
            "-f", "f32le",
            "-acodec", "pcm_f32le",
            "-ar", "19200",
            "-ac", "2",
            "pipe:1",
        ])
        .output();
    
    let output = match result {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[LOUDNESS] FFmpeg not found: {}", e);
            return None;
        }
    };
    
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        eprintln!("[LOUDNESS] FFmpeg error: {}", err);
        return None;
    }
    
    let data = &output.stdout;
    let samples = data.len() / 4;
    let frames = samples / 2;
    
    if frames == 0 {
        eprintln!("[LOUDNESS] No audio data");
        return None;
    }
    
    let mut sum: f64 = 0.0;
    let mut true_peak: f32 = 0.0;
    
    for chunk in data.chunks_exact(4) {
        let a = chunk[0];
        let b = chunk[1];
        let c = chunk[2];
        let d = chunk[3];
        let sample = f32::from_le_bytes([a, b, c, d]);
        sum += (sample as f64) * (sample as f64);
        true_peak = true_peak.max(sample.abs());
    }
    
    let rms = (sum / samples as f64).sqrt();
    let integrated_lufs = if rms > 0.0 { -0.691 + 10.0 * rms.log10() } else { -100.0 };
    
    let true_peak_dbtp = if true_peak > 0.0 { 20.0 * true_peak.log10() } else { -100.0 };
    
    let target_lufs = -14.0;
    let gain_db = target_lufs - integrated_lufs;
    
    eprintln!("[LOUDNESS] {}: {:.1} LUFS, TP: {:.1} dBTP, gain: {:.1} dB", 
        path, integrated_lufs, true_peak_dbtp, gain_db);
    
    Some(AudioLoudness { 
        integrated_lufs: integrated_lufs as f32, 
        true_peak_dbtp: true_peak_dbtp as f32, 
        gain_db: gain_db as f32 
    })
}

#[tauri::command]
fn init_discord_rpc(client_id: String) -> bool {
    eprintln!("[RPC] Initialized with client_id: {}", client_id);
    
    let mut state = match RPC_STATE.lock() {
        Ok(s) => s,
        Err(_) => return false,
    };
    
    if state.enabled && RPC_RUNNING.load(Ordering::SeqCst) {
        return true;
    }
    
state.enabled = true;
        state.client_id = client_id.clone();
        
        start_rpc_process(&client_id);
    
    true
}

fn start_rpc_process(client_id: &str) {
    eprintln!("[RPC] Starting with client_id: {}", client_id);
    
    if let Ok(mut client) = RPC_CLIENT.lock() {
        *client = Some(client_id.to_string());
        eprintln!("[RPC] Client saved to state");
    }
    RPC_RUNNING.store(true, Ordering::SeqCst);
    eprintln!("[RPC] Started successfully");
}

fn send_rpc_update(title: &str, artist: &str, _image: Option<&str>, start_ts: Option<i64>, end_ts: Option<i64>) {
    eprintln!("[RPC] send_rpc_update called: {} - {}", title, artist);
    
    let client_id = match RPC_CLIENT.lock() {
        Ok(c) => c.clone(),
        Err(_) => { eprintln!("[RPC] Failed to lock client"); return; }
    };
    let client_id = match client_id {
        Some(id) => { eprintln!("[RPC] Using client_id: {}", id); id }
        None => { eprintln!("[RPC] No client_id configured"); return; }
    };
    
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as u64;
    
    let last = RPC_LAST_UPDATE.load(Ordering::SeqCst);
    if now - last < 2 {
        eprintln!("[RPC] Throttled");
        return;
    }
    eprintln!("[RPC] Updating");
    RPC_LAST_UPDATE.store(now, Ordering::SeqCst);
    
    let title_owned = title.to_string();
    let artist_owned = artist.to_string();
    
    let mut opts_vec: Vec<String> = vec![
        format!("\"details\": \"{}\"", &title_owned[..title_owned.len().min(128)]),
        format!("\"state\": \"{}\"", &artist_owned[..artist_owned.len().min(128)])
    ];
    
    if let Some(start) = start_ts {
        opts_vec.push(format!("\"start\": {}", start));
    }
    if let Some(end) = end_ts {
        opts_vec.push(format!("\"end\": {}", end));
    }
    
    let opts_str = opts_vec.join(", ");
    let python_code = format!(r#"
import time, os, sys
from pypresence import Presence

client_id = '{}'

try:
    rpc = Presence(client_id)
    rpc.connect()
    time.sleep(0.2)
    
    pid = os.getpid()
    rpc.update(pid=pid, details='{}', state='{}', start={}, end={})
    print('Updated OK')
    time.sleep(1)
except Exception as e:
    print('Error: ' + str(e), file=sys.stderr)
"#, client_id, 
        &title_owned[..title_owned.len().min(128)].replace("'", "\\'"),
        &artist_owned[..artist_owned.len().min(128)].replace("'", "\\'"),
        start_ts.unwrap_or(0),
        end_ts.unwrap_or(0)
    );
    
    let output = std::process::Command::new("python")
            .args(["-c", &python_code])
            .output();
        
        match output {
            Ok(o) => {
                if !o.status.success() {
                    eprintln!("[RPC] Error: {}", String::from_utf8_lossy(&o.stderr));
                } else {
                    eprintln!("[RPC] Updated: {} - {}", title_owned, artist_owned);
                }
            }
            Err(e) => eprintln!("[RPC] Failed to start: {}", e),
        }
}

fn send_rpc_clear() {
    let client_id = match RPC_CLIENT.lock() {
        Ok(c) => c.clone(),
        Err(_) => return,
    };
    let client_id = match client_id {
        Some(id) => id,
        None => return,
    };
    
    let python_code = format!(r#"
from pypresence import Presence
rpc = Presence('{}')
rpc.connect()
rpc.clear()
rpc.close()
"#, client_id);
    
    std::thread::spawn(move || {
        let _ = std::process::Command::new("python")
            .args(["-c", &python_code])
            .output();
        eprintln!("[RPC] Cleared");
    });
}

#[tauri::command]
fn update_discord_rpc(title: String, artist: String, album: String, elapsed_ms: u64, duration_ms: u64) {
    let (enabled, client_id) = {
        let state = match RPC_STATE.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        (state.enabled, state.client_id.clone())
    };
    
    if !enabled || !RPC_RUNNING.load(Ordering::SeqCst) {
        return;
    }
    
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as u64;
    
    let track_key = format!("{} - {}", artist, title);
    let should_update = {
        let state = match RPC_STATE.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        state.current_track.as_ref() != Some(&track_key) || now - state.last_update > 10
    };
    
    if !should_update {
        return;
    }
    
    {
        let mut state = match RPC_STATE.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        state.current_track = Some(track_key);
        state.last_update = now;
    }
    
    let artwork_url = fetch_apple_artwork(&artist, &title);
    let image_key = artwork_url.unwrap_or_else(|| "ashen".to_string());
    
    let start_ts = (elapsed_ms / 1000) as i64;
    let end_ts: Option<i64> = if duration_ms > 0 { Some(start_ts + (duration_ms / 1000) as i64) } else { None };
    
    eprintln!("[RPC] Playing: {} - {} ({}/{}ms)", artist, title, elapsed_ms, duration_ms);
    
    send_rpc_update(&title, &artist, None, Some(start_ts), end_ts);
}

#[tauri::command]
fn pause_discord_rpc() {
    let (enabled, client_id) = {
        let state = match RPC_STATE.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        (state.enabled, state.client_id.clone())
    };
    
    if !enabled || !RPC_RUNNING.load(Ordering::SeqCst) {
        return;
    }
    
    eprintln!("[RPC] Paused");
    send_rpc_clear();
}

#[tauri::command]
fn resume_discord_rpc(elapsed_ms: u64, duration_ms: u64) {
    let (enabled, client_id) = {
        let state = match RPC_STATE.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        (state.enabled, state.client_id.clone())
    };
    
    if !enabled {
        return;
    }
    
    eprintln!("[RPC] Resumed ({}/{}ms)", elapsed_ms, duration_ms);
}

#[tauri::command]
fn clear_discord_rpc() {
    let (enabled, client_id) = {
        let state = match RPC_STATE.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        (state.enabled, state.client_id.clone())
    };
    
    if !enabled {
        return;
    }
    
    {
        let mut state = match RPC_STATE.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        state.current_track = None;
    }
    
    eprintln!("[RPC] Cleared");
    send_rpc_clear();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct YouTubeResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub duration_secs: u32,
    pub thumbnail: String,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub progress: f32,
    pub status: String,
    pub file_path: Option<String>,
}

#[tauri::command]
async fn search_youtube(query: String) -> Vec<YouTubeResult> {
    eprintln!("[YOUTUBE] Searching: {}", query);
    
    let search_query = format!("ytsearch20:{}", query);
    let output = tokio::process::Command::new("python")
        .args([
            "-m",
            "yt_dlp",
            "--no-warnings",
            "--dump-json",
            "--no-download",
            "--no-playlist",
            "--limit=20",
            &search_query,
        ])
        .output()
        .await;
    
    let output = match output {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[YOUTUBE] yt-dlp not found: {}", e);
            return vec![];
        }
    };
    
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        eprintln!("[YOUTUBE] Search error: {}", err);
        return vec![];
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = vec![];
    
    for line in stdout.lines() {
        if let Ok(track) = serde_json::from_str::<serde_json::Value>(line) {
            let id = track.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let title = track.get("title").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string();
            let artist = track.get("channel").and_then(|v| v.as_str()).unwrap_or("Unknown Artist").to_string();
            let duration = track.get("duration").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let thumbnail = track.get("thumbnail")
                .and_then(|v| v.as_str())
                .map(|s| s.replace("jpg", "webp"))
                .unwrap_or_default();
            let url = track.get("url").and_then(|v| v.as_str()).unwrap_or(&format!("https://youtube.com/watch?v={}", id)).to_string();
            
            results.push(YouTubeResult {
                id,
                title,
                artist,
                duration_secs: duration,
                thumbnail,
                url,
            });
        }
    }
    
    eprintln!("[YOUTUBE] Found {} results", results.len());
    results
}

#[tauri::command]
async fn download_youtube(url: String, output_dir: String) -> Result<String, String> {
    eprintln!("[YOUTUBE] Downloading: {}", url);
    
    let output_path = Path::new(&output_dir);
    if !output_path.exists() {
        fs::create_dir_all(output_path).map_err(|e| e.to_string())?;
    }
    
    let result = tokio::process::Command::new("python")
        .args([
            "-m",
            "yt_dlp",
            "--no-warnings",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "--embed-thumbnail",
            "--add-metadata",
            "-o",
            &format!("{}/%(title)s.%(ext)s", output_dir),
            "--no-playlist",
            "--print",
            "after_move:%(filepath)s",
            &url,
        ])
        .output()
        .await;
    
    match result {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.ends_with(".mp3") || trimmed.ends_with(".m4a") {
                        eprintln!("[YOUTUBE] Downloaded to: {}", trimmed);
                        return Ok(trimmed.to_string());
                    }
                }
                eprintln!("[YOUTUBE] Download complete");
                Ok("Downloaded".to_string())
            } else {
                let err = String::from_utf8_lossy(&output.stderr);
                eprintln!("[YOUTUBE] Download error: {}", err);
                Err(err.to_string())
            }
        }
        Err(e) => {
            eprintln!("[YOUTUBE] yt-dlp error: {}", e);
            Err(e.to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_music_folder, get_audio_cover, get_audio_metadata, get_track_loudness, save_audio_cover, get_folder_cover, init_discord_rpc, update_discord_rpc, pause_discord_rpc, resume_discord_rpc, clear_discord_rpc, search_youtube, download_youtube])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}