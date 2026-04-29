use base64::{Engine as _, engine::general_purpose};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use once_cell::sync::Lazy;

struct RPCState {
    enabled: bool,
    client_id: String,
}

static RPC_STATE: Lazy<Mutex<RPCState>> = Lazy::new(|| {
    Mutex::new(RPCState {
        enabled: false,
        client_id: String::new(),
    })
});

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
    
    let audio_path = Path::new(&path);
    let parent = audio_path.parent()?;
    
    for ext in &["jpg", "jpeg", "png", "gif"] {
        let cover_path = parent.join(format!("folder.{}", ext));
        if cover_path.exists() {
            let data = fs::read(&cover_path).ok()?;
            let base64_img = general_purpose::STANDARD.encode(&data);
            let mime = if ext == &"png" { "image/png" } else { "image/jpeg" };
            return Some(format!("data:{};base64,{}", mime, base64_img));
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
    if let Ok(mut state) = RPC_STATE.lock() {
        state.enabled = true;
        state.client_id = client_id;
        true
    } else {
        false
    }
}

#[tauri::command]
fn update_discord_rpc(title: String, artist: String, album: String, elapsed_ms: u64, duration_ms: u64) {
    if let Ok(state) = RPC_STATE.lock() {
        if !state.enabled {
            return;
        }
        eprintln!("[RPC] Playing: {} - {} ({}/{}ms)", artist, title, elapsed_ms, duration_ms);
    }
}

#[tauri::command]
fn pause_discord_rpc() {
    if let Ok(state) = RPC_STATE.lock() {
        if !state.enabled {
            return;
        }
        eprintln!("[RPC] Paused");
    }
}

#[tauri::command]
fn resume_discord_rpc(elapsed_ms: u64, duration_ms: u64) {
    if let Ok(state) = RPC_STATE.lock() {
        if !state.enabled {
            return;
        }
        eprintln!("[RPC] Resumed ({}/{}ms)", elapsed_ms, duration_ms);
    }
}

#[tauri::command]
fn clear_discord_rpc() {
    if let Ok(state) = RPC_STATE.lock() {
        if !state.enabled {
            return;
        }
        eprintln!("[RPC] Cleared");
    }
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