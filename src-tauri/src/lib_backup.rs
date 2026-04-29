use base64::{Engine as _, engine::general_purpose};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_music_folder, get_audio_cover, get_audio_metadata, get_track_loudness])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}