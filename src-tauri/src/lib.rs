#![windows_subsystem = "windows"]

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn FreeConsole() -> i32;
}

const CREATE_NO_WINDOW: u32 = 0x08000000;

use base64::{engine::general_purpose, Engine as _};
use image::imageops::FilterType;
use image::GenericImageView;
use lofty::config::ParseOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey};
use cpal::traits::{HostTrait, DeviceTrait};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::io::Cursor;




#[derive(Debug, Serialize, Deserialize)]
pub struct AudioMetadata {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: u32,
    pub cover: Option<String>,
    pub lyrics: Option<String>,
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
    
    if !Path::new(&path).exists() {
            return None;
    }
    
    let tagged_file = match Probe::open(&path) {
        Ok(p) => match p.read() {
            Ok(tf) => tf,
            Err(_) => {
                            return None;
            }
        },
        Err(_) => {
                    return None;
        }
    };
    
    let tag = match tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
        Some(t) => t,
        None => {
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
    
    
    let cover = tag.pictures().get(0).map(|picture| {
        let base64_img = general_purpose::STANDARD.encode(picture.data());
        let mime = picture.mime_type().map(|m| m.as_str()).unwrap_or("image/jpeg");
        format!("data:{};base64,{}", mime, base64_img)
    });

    let lyrics = tag.get_string(ItemKey::UnsyncLyrics).map(|s| s.to_string());
    
    Some(AudioMetadata { title, artist, album, duration, cover, lyrics })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioMetadataNocover {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: u32,
    pub lyrics: Option<String>,
}

#[tauri::command]
fn get_audio_metadata_no_cover(path: String) -> Option<AudioMetadataNocover> {
    if !Path::new(&path).exists() {
        return None;
    }
    let tagged_file = Probe::open(&path)
        .ok()?
        .options(ParseOptions::new().read_cover_art(false))
        .read()
        .ok()?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;
    let properties = tagged_file.properties();
    let duration = properties.duration().as_secs() as u32;
    let filename = Path::new(&path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    let title = tag.title().map(|s| s.to_string()).unwrap_or(filename);
    let artist = tag.artist().map(|s| s.to_string()).unwrap_or_else(|| "Unknown Artist".to_string());
    let album = tag.album().map(|s| s.to_string()).unwrap_or_else(|| "Unknown Album".to_string());
    let lyrics = tag.get_string(ItemKey::UnsyncLyrics).map(|s| s.to_string());
    Some(AudioMetadataNocover { title, artist, album, duration, lyrics })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct YandexBio {
    pub bio: String,
    pub genres: Vec<String>,
}

#[tauri::command]
async fn get_yandex_bio(artist: String) -> Option<YandexBio> {
    let client = reqwest::Client::new();
    let url = format!("https://api.music.yandex.net/search?text={}&type=artist", urlencoding::encode(&artist));

    let resp = client.get(&url).send().await.ok()?;
    let data: serde_json::Value = resp.json().await.ok()?;

    let result = data["result"]["artists"]["results"].as_array()?.first()?.clone();

    let bio = result["description"]["text"].as_str().unwrap_or("").to_string();
    let genres: Vec<String> = result["genres"].as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    if bio.is_empty() && genres.is_empty() {
        return None;
    }

    Some(YandexBio { bio, genres })
}

#[tauri::command]
fn get_audio_cover(path: String) -> Option<String> {
    let tagged_file = Probe::open(&path).ok()?.read().ok()?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;
    let picture = tag.pictures().get(0)?;
    let base64_img = general_purpose::STANDARD.encode(picture.data());
    let mime = picture.mime_type().map(|m| m.as_str()).unwrap_or("image/jpeg");
    Some(format!("data:{};base64,{}", mime, base64_img))
}

#[tauri::command]
fn get_audio_cover_thumbnail(path: String, max_size: u32) -> Option<String> {
    let tagged_file = Probe::open(&path).ok()?.read().ok()?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;
    let picture = tag.pictures().get(0)?;
    
    let img = image::load_from_memory(picture.data()).ok()?;
    let (w, h) = img.dimensions();
    
    let thumb = if w > h {
        img.resize(max_size, max_size * h / w, FilterType::Triangle)
    } else {
        img.resize(max_size * w / h, max_size, FilterType::Triangle)
    };
    
    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    thumb.write_to(&mut cursor, image::ImageFormat::Jpeg).ok()?;
    
    let base64_img = general_purpose::STANDARD.encode(&buf);
    Some(format!("data:image/jpeg;base64,{}", base64_img))
}

#[tauri::command]
fn save_audio_cover(path: String) -> Option<String> {
    
    let audio_path = Path::new(&path);
    if !audio_path.exists() {
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
    
    Some(cover_path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_folder_cover(path: String) -> Option<String> {
    
    let folder_path = PathBuf::from(&path);
    
    // Если это директория - используем её, иначе parent
    let search_dir = if folder_path.is_dir() {
        &folder_path
    } else {
        folder_path.parent().unwrap_or(&folder_path)
    };
    
    
    if !search_dir.exists() {
        return None;
    }
    
    let entries = fs::read_dir(search_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.starts_with("cover.") || name.starts_with("folder.") || name.starts_with("front.") || name.starts_with("album.") {
            let ext = entry.path().extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if ["jpg", "jpeg", "png", "gif"].contains(&ext.as_str()) {
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
fn get_folder_cover_thumbnail(path: String, max_size: u32) -> Option<String> {
    let folder_path = PathBuf::from(&path);
    let search_dir = if folder_path.is_dir() {
        &folder_path
    } else {
        folder_path.parent().unwrap_or(&folder_path)
    };
    
    if !search_dir.exists() {
        return None;
    }
    
    let entries = fs::read_dir(search_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.starts_with("cover.") || name.starts_with("folder.") || name.starts_with("front.") || name.starts_with("album.") {
            let ext = entry.path().extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if ["jpg", "jpeg", "png", "gif"].contains(&ext.as_str()) {
                let data = fs::read(entry.path()).ok()?;
                
                if let Ok(img) = image::load_from_memory(&data) {
                    let (w, h) = img.dimensions();
                    let thumb = if w > h {
                        img.resize(max_size, max_size * h / w, FilterType::Triangle)
                    } else {
                        img.resize(max_size * w / h, max_size, FilterType::Triangle)
                    };
                    
                    let mut buf = Vec::new();
                    let mut cursor = Cursor::new(&mut buf);
                    thumb.write_to(&mut cursor, image::ImageFormat::Jpeg).ok()?;
                    
                    let base64_img = general_purpose::STANDARD.encode(&buf);
                    return Some(format!("data:image/jpeg;base64,{}", base64_img));
                }
                
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
    
    if !Path::new(&path).exists() {
            return None;
    }
    
    let result = Command::new("ffmpeg")
        .creation_flags(CREATE_NO_WINDOW)
        .stderr(std::process::Stdio::null())
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
        Err(_) => {
                    return None;
        }
    };
    
    if !output.status.success() {
        let _err = String::from_utf8_lossy(&output.stderr);
            return None;
    }
    
    let data = &output.stdout;
    let samples = data.len() / 4;
    let frames = samples / 2;
    
    if frames == 0 {
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
    
    let search_query = format!("ytsearch20:{}", query);
    let output = tokio::process::Command::new("python")
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
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
        Err(_) => {
                    return vec![];
        }
    };
    
    if !output.status.success() {
        let _err = String::from_utf8_lossy(&output.stderr);
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
    
    results
}

#[tauri::command]
async fn download_youtube(url: String, output_dir: String) -> Result<String, String> {
    
    let output_path = Path::new(&output_dir);
    if !output_path.exists() {
        fs::create_dir_all(output_path).map_err(|e| e.to_string())?;
    }
    
    let result = tokio::process::Command::new("python")
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
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
                                            return Ok(trimmed.to_string());
                    }
                }
                            Ok("Downloaded".to_string())
            } else {
                let err = String::from_utf8_lossy(&output.stderr);
                            Err(err.to_string())
            }
        }
        Err(e) => {
                    Err(e.to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    unsafe { FreeConsole(); }
#[tauri::command]
fn get_audio_devices() -> Vec<String> {
    let host = cpal::default_host();
    let mut devices: Vec<String> = Vec::new();
    
    if let Ok(outputs) = host.output_devices() {
        for device in outputs {
            if let Ok(name) = device.name() {
                if device.default_output_config().is_ok() {
                    devices.push(name);
                }
            }
        }
    }
    
    if devices.is_empty() {
        vec!["Default Output".to_string()]
    } else {
        devices
    }
}

#[tauri::command]
fn apply_vibrancy(window: tauri::Window) {
    #[cfg(target_os = "windows")]
    {
        let _ = window_vibrancy::apply_mica(&window, Some(true));
    }
}

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_music_folder, get_audio_cover, get_audio_cover_thumbnail, get_audio_metadata, get_audio_metadata_no_cover, get_yandex_bio, get_track_loudness, save_audio_cover, get_folder_cover, get_folder_cover_thumbnail, search_youtube, download_youtube, get_audio_devices, apply_vibrancy])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}