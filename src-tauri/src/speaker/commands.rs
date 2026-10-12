// Echo AI AI Speech Detection, and capture system audio (speaker output) as a stream of f32 samples.
use crate::speaker::{AudioDevice, SpeakerInput};
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::StreamExt;
use hound::{WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_shell::ShellExt;
use tracing::{error, warn};

// VAD Configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VadConfig {
    pub enabled: bool,
    pub hop_size: usize,
    pub sensitivity_rms: f32,
    pub peak_threshold: f32,
    pub silence_chunks: usize,
    pub min_speech_chunks: usize,
    pub pre_speech_chunks: usize,
    pub noise_gate_threshold: f32,
    pub max_recording_duration_secs: u64,
}

/// Hard lower bound for the SNR gate: below this the "signal" is measurement
/// noise, not a voice, however quiet the room is.
const VAD_ABSOLUTE_FLOOR: f32 = 0.0008;

/// Maps the UI sensitivity slider (0.001..0.020 RMS) onto the live SNR ratio.
/// Higher slider = lower ratio = more sensitive. Default 0.012 → 3.0, so the
/// shipped behaviour is unchanged; the slider finally does something.
fn snr_ratio_for(sensitivity_rms: f32) -> f32 {
    (0.036 / sensitivity_rms.clamp(0.001, 0.020)).clamp(1.8, 36.0)
}

/// Target RMS the input calibration lifts the noise floor to. Keeping the
/// floor at a known level makes the sensitivity presets mean the same thing on
/// a loud USB interface and on a quiet loopback.
const AGC_TARGET_FLOOR: f32 = 0.01;

/// Highest input gain the calibration may apply. A room that quiet is
/// effectively silent; beyond this the noise itself would be amplified into
/// the speech band.
const AGC_MAX_GAIN: f32 = 60.0;

/// Frame cadence divisor for real-time speech frame streaming.
/// sr / 8 gives ~125ms frames at any sample rate (R05).
pub const FRAME_CADENCE_DIVISOR: usize = 8;

/// Updates rolling tracking window only while not in speech (R07).
pub fn update_noise_tracking_window(
    window: &mut VecDeque<f32>,
    val: f32,
    max_len: usize,
    in_speech: bool,
) -> bool {
    if in_speech {
        return false;
    }
    window.push_back(val);
    if window.len() > max_len {
        window.pop_front();
    }
    true
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            hop_size: 1024,
            sensitivity_rms: 0.012, // Much less sensitive - only real speech
            peak_threshold: 0.035,  // Higher threshold - filters clicks/noise
            silence_chunks: 12,    // ~0.28s. Measured on this engine: a 1-3s utterance returns its text in ~1.1s, while a long one waits ~12s because the recogniser re-runs its language check over the WHOLE buffer. Short utterances are therefore much faster here; the question assembler merges the fragments.
            min_speech_chunks: 7,   // ~0.16s - drops key clicks but keeps short words; 12 discarded real speech as noise and no utterance ever finished
            pre_speech_chunks: 12,  // ~0.27s - enough to catch word start
            noise_gate_threshold: 0.003, // Stronger noise filtering
            max_recording_duration_secs: 180, // 3 minutes default
        }
    }
}

#[tauri::command]
pub async fn start_system_audio_capture(
    app: AppHandle,
    vad_config: Option<VadConfig>,
    device_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<crate::AudioState>();

    // Idempotency guard: a fast double-toggle (UI + shortcut) or a stream
    // task that never yielded (idle loopback) leaves stream_task=Some and
    // every later start fails with 'Capture already running'. Abort any
    // previous task here and reset the slot before proceeding.
    {
        let mut guard = state
            .stream_task
            .lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;
        if let Some(prev) = guard.take() {
            warn!("Capture already running - aborting previous task");
            prev.abort();
        }
    }

    // Update VAD config if provided
    if let Some(config) = vad_config {
        let mut vad_cfg = state
            .vad_config
            .lock()
            .map_err(|e| format!("Failed to acquire VAD config lock: {}", e))?;
        *vad_cfg = config;
    }

    let input = SpeakerInput::new_with_device(device_id).map_err(|e| {
        error!("Failed to create speaker input: {}", e);
        format!("Failed to access system audio: {}", e)
    })?;

    let stream = input.stream();
    let sr = stream.sample_rate();

    // Validate sample rate
    if !(8000..=96000).contains(&sr) {
        error!("Invalid sample rate: {}", sr);
        return Err(format!(
            "Invalid sample rate: {}. Expected 8000-96000 Hz",
            sr
        ));
    }

    let app_clone = app.clone();

    // Mark as capturing BEFORE spawning task
    *state
        .is_capturing
        .lock()
        .map_err(|e| format!("Failed to set capturing state: {}", e))? = true;

    // Claim this capture's generation. The task below only clears shared state
    // while it still owns it (see `AudioState::capture_generation`).
    let my_generation = {
        let mut gen_guard = state
            .capture_generation
            .lock()
            .map_err(|e| format!("Failed to bump capture generation: {}", e))?;
        *gen_guard = gen_guard.wrapping_add(1);
        *gen_guard
    };

    // Emit capture started event
    let _ = app_clone.emit("capture-started", sr);

    let state_clone = app.state::<crate::AudioState>();
    let vad_config_shared = state_clone.inner().vad_config.clone();
    let vad_config = vad_config_shared
        .lock()
        .map_err(|e| format!("Failed to read VAD config: {}", e))?
        .clone();
    let task = tokio::spawn(async move {
        if vad_config.enabled {
            run_vad_capture(app_clone.clone(), stream, sr, vad_config, vad_config_shared).await;
        } else {
            run_continuous_capture(app_clone.clone(), stream, sr, vad_config).await;
        }

        let state = app_clone.state::<crate::AudioState>();
        // Only the CURRENT capture may clear the state. A previous task that
        // finishes after a new capture started would otherwise wipe the new
        // capture's `stream_task` and `is_capturing`, leaving a task that
        // `stop_system_audio_capture` can no longer find or abort.
        let still_owner = match state.capture_generation.lock() {
            Ok(guard) => *guard == my_generation,
            // Recover a poisoned lock instead of giving up. The generation value
            // is still intact after a panic elsewhere (poisoning marks the lock,
            // it does not clear the data), and reporting "not owner" here left
            // `is_capturing` stuck `true` forever — the app believed the engine
            // was recording while every caller wanted it stopped. Reading the real
            // value is both safer and more correct, and matches the convention
            // used by the shortcut handlers.
            Err(poisoned) => *poisoned.into_inner() == my_generation,
        };
        if still_owner {
            if let Ok(mut guard) = state.stream_task.lock() {
                *guard = None;
            };
            if let Ok(mut cap) = state.is_capturing.lock() {
                *cap = false;
            }
            let _ = app_clone.emit("capture-stopped", ());
        }
    });

    *state_clone
        .stream_task
        .lock()
        .map_err(|e| format!("Failed to store task: {}", e))? = Some(task);

    Ok(())
}

// Borrow only the suffix; periodic frames and the final drain share one cursor.
fn flush_pending_speech_frame(
    samples: &[f32],
    emitted_len: &mut usize,
    emit: impl FnOnce(&[f32]),
) {
    let start = (*emitted_len).min(samples.len());
    *emitted_len = samples.len();
    if start < samples.len() {
        emit(&samples[start..]);
    }
}

fn finish_speech_segment(
    samples: &[f32],
    emitted_len: &mut usize,
    emit_frame: impl FnOnce(&[f32]),
    emit_final: impl FnOnce(&[f32]),
) {
    flush_pending_speech_frame(samples, emitted_len, emit_frame);
    emit_final(samples);
}
/// Applies slider changes from shared state into the running capture loop.
/// Non-blocking: a contended lock skips this refresh, the next chunk retries.
fn refresh_live_config(
    config: &mut VadConfig,
    live_config: &std::sync::Arc<std::sync::Mutex<VadConfig>>,
) {
    if let Ok(fresh) = live_config.try_lock() {
        config.sensitivity_rms = fresh.sensitivity_rms;
        config.peak_threshold = fresh.peak_threshold;
        config.silence_chunks = fresh.silence_chunks;
        config.min_speech_chunks = fresh.min_speech_chunks;
        config.pre_speech_chunks = fresh.pre_speech_chunks;
        config.noise_gate_threshold = fresh.noise_gate_threshold;
        config.hop_size = fresh.hop_size;
    }
}


// VAD-enabled capture - OPTIMIZED for real-time speech detection
async fn run_vad_capture(
    app: AppHandle,
    stream: impl StreamExt<Item = f32> + Unpin,
    sr: u32,
    initial_config: VadConfig,
    live_config: std::sync::Arc<std::sync::Mutex<VadConfig>>,
) {
    let mut config = initial_config;
    let mut stream = stream;
    let mut buffer: VecDeque<f32> = VecDeque::new();
    let mut pre_speech: VecDeque<f32> =
        VecDeque::with_capacity(config.pre_speech_chunks * config.hop_size);
    let mut speech_buffer = Vec::new();
    let mut in_speech = false;
    let mut silence_chunks = 0;
    let mut speech_chunks = 0;
    let mut frame_emitted_len = 0usize;
    let mut frames_since_frame = 0usize;
    let max_samples = sr as usize * 30; // 30s safety cap per utterance
    let mut noise_floor_window: VecDeque<f32> = VecDeque::with_capacity(90);
    // Input calibration. Loopback and capture gains differ wildly between
    // devices: the same voice arrives at rms 0.30 through one interface and
    // 0.002 through another, and an absolute threshold tuned for the first
    // never fires on the second (measured: peak 0.004 where the gate wanted
    // 0.035). Track the loudest recent level and lift the signal so the
    // presets mean the same thing everywhere. The gain only moves once a
    // second and is capped, so it cannot pump on a single loud word.
    let mut level_peak_window: VecDeque<f32> = VecDeque::with_capacity(45);
    let mut input_gain: f32 = 1.0;
    let mut gain_cooldown: u32 = 0;

    let emit_frame = |samples: &[f32]| {
        let pcm = if sr == 16000 {
            std::borrow::Cow::Borrowed(samples)
        } else {
            std::borrow::Cow::Owned(resample_to_16k(samples, sr))
        };
        let mut bytes = Vec::with_capacity(pcm.len() * 4);
        for sample in pcm.iter() {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        let _ = app.emit("speech-frame", bytes);
    };
    let emit_final = |samples: &[f32]| {
        let normalized = normalize_audio_level(samples, 0.1);
        let resampled = if sr == 16000 {
            std::borrow::Cow::Borrowed(normalized.as_slice())
        } else {
            std::borrow::Cow::Owned(resample_to_16k(&normalized, sr))
        };
        match samples_to_wav_b64(16000, &resampled) {
            Ok(b64) => { let _ = app.emit("speech-detected", b64); }
            Err(_) => {
                error!("Failed to encode speech to WAV");
                let _ = app.emit("audio-encoding-error", "Failed to encode speech");
            }
        }
    };
    while let Some(sample) = stream.next().await {
        // Live config refresh (see refresh_live_config): slider changes apply
        // without restarting the capture.
        refresh_live_config(&mut config, &live_config);
        buffer.push_back(sample);
        // Process in fixed chunks for VAD analysis
        while buffer.len() >= config.hop_size {
            let mut mono = Vec::with_capacity(config.hop_size);
            for _ in 0..config.hop_size {
                if let Some(v) = buffer.pop_front() {
                    mono.push(v);
                }
            }

            // Calibrate before the gate: everything downstream (gate, metrics,
            // utterance buffers, streamed frames, WAV fallback) then carries the
            // same normalized level.
            //
            // The gain follows the NOISE FLOOR, never the peak. Normalizing to
            // the loudest recent level was measured to destroy the very thing
            // the VAD needs: a quiet room and quiet speech were both lifted to
            // the same band, so every ambient sound became "speech". Pushing the
            // floor to a known level instead keeps the speech-to-noise distance
            // intact — a device whose room noise sits at 0.0001 gets the same
            // effective sensitivity as one at 0.01.
            let (pre_rms, _) = calculate_audio_metrics(&mono);
            if update_noise_tracking_window(&mut level_peak_window, pre_rms, 200, in_speech) {
                if gain_cooldown > 0 {
                    gain_cooldown -= 1;
                } else if let Some(&quietest) = level_peak_window
                    .iter()
                    .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                {
                    // Below the measurable floor there is nothing to calibrate.
                    let desired = if quietest > 1e-6 {
                        (AGC_TARGET_FLOOR / quietest).clamp(1.0, AGC_MAX_GAIN)
                    } else {
                        input_gain
                    };
                    // Ease toward the target so the level never jumps audibly.
                    input_gain += (desired - input_gain) * 0.25;
                    gain_cooldown = 40; // ~1s at 1024-sample chunks of 44.1kHz
                }
            }

            let mut mono = if (input_gain - 1.0).abs() > 0.01 {
                let g = input_gain;
                mono.iter()
                    .map(|s| {
                        let amplified = s * g;
                        if amplified.abs() > 1.0 {
                            amplified.signum()
                        } else {
                            amplified
                        }
                    })
                    .collect::<Vec<f32>>()
            } else {
                mono
            };

            // Apply noise gate BEFORE VAD (critical for accuracy)
            mono = apply_noise_gate(&mono, config.noise_gate_threshold);

            let (rms, peak) = calculate_audio_metrics(&mono);
            // Rolling noise floor over ~2s sliding window (capped at ~90 chunks)
            update_noise_tracking_window(&mut noise_floor_window, rms, 90, in_speech);
            // Speech is decided on the PRE-gain signal-to-noise ratio, not on
            // the amplified absolute level. Measured failure of the absolute
            // rule: the calibration lifted room noise until it crossed the
            // speech threshold, so the detector stayed "in speech" through
            // silence — one utterance ran 30s and its text arrived only at the
            // end. A ratio is immune to the gain: speech stands well above the
            // room's own floor on every device, quiet or loud.
            let pre_floor = level_peak_window
                .iter()
                .copied()
                .fold(f32::INFINITY, f32::min);
            let pre_floor = if pre_floor.is_infinite() { 0.0 } else { pre_floor };
            let snr_threshold = (pre_floor * snr_ratio_for(config.sensitivity_rms)).max(VAD_ABSOLUTE_FLOOR);
            let is_speech = (pre_rms > snr_threshold || peak > config.peak_threshold)
                && pre_rms > pre_floor * 1.2;

            if is_speech {
                if !in_speech {
                    // Speech START detected
                    in_speech = true;
                    speech_chunks = 0;
                    frame_emitted_len = 0;
                    frames_since_frame = 0;

                    // Include pre-speech buffer for natural sound
                    speech_buffer.extend(pre_speech.drain(..));

                    let _ = app.emit("speech-start", ());
                }

                speech_chunks += 1;
                speech_buffer.extend_from_slice(&mono);
                silence_chunks = 0; // Reset silence counter on any speech

                // Live PCM for the streaming socket: the audio since the last
                // frame, f32 LE @16 kHz, every ~250 ms. Sent as raw bytes - the
                // renderer pipes it straight into the socket, and the older
                // base64 hop only added a decode per frame.
                frames_since_frame += mono.len();
                if frames_since_frame >= sr as usize / FRAME_CADENCE_DIVISOR {
                    flush_pending_speech_frame(
                        &speech_buffer, &mut frame_emitted_len, emit_frame,
                    );
                    frames_since_frame = 0;
                }


                // Safety cap: force emit if exceeds 30s
                if speech_buffer.len() > max_samples {
                    finish_speech_segment(
                        &speech_buffer, &mut frame_emitted_len, emit_frame, emit_final,
                    );
                    speech_buffer.clear();
                    in_speech = false;
                    speech_chunks = 0;
                    frame_emitted_len = 0;
                    frames_since_frame = 0;
                }
            } else {
                // Silence detected
                if in_speech {
                    silence_chunks += 1;

                    // Continue collecting during silence (important for natural speech)
                    speech_buffer.extend_from_slice(&mono);

                    // Check if silence duration exceeds threshold
                    if silence_chunks >= config.silence_chunks {
                        // Verify minimum speech duration
                        if speech_chunks >= config.min_speech_chunks && !speech_buffer.is_empty() {
                            // Trim trailing silence (keep ~0.15s for natural ending)
                            let silence_duration_samples = silence_chunks * config.hop_size;
                            let keep_silence_samples = (sr as usize) * 15 / 100; // 0.15s
                            let trim_amount =
                                silence_duration_samples.saturating_sub(keep_silence_samples);

                            if speech_buffer.len() > trim_amount {
                                speech_buffer.truncate(speech_buffer.len() - trim_amount);
                            }

                            finish_speech_segment(
                                &speech_buffer, &mut frame_emitted_len, emit_frame, emit_final,
                            );
                        } else {
                            let _ = app.emit(
                                "speech-discarded",
                                "Audio too short (likely background noise)",
                            );
                        }

                        // Reset for next speech detection
                        speech_buffer.clear();
                        in_speech = false;
                        silence_chunks = 0;
                        speech_chunks = 0;
                        frame_emitted_len = 0;
                        frames_since_frame = 0;
                    }
                } else {
                    // Not in speech yet - maintain rolling pre-speech buffer
                    pre_speech.extend(mono);

                    // Trim excess (maintain fixed size)
                    while pre_speech.len() > config.pre_speech_chunks * config.hop_size {
                        pre_speech.pop_front();
                    }

                    // Periodically shrink capacity to prevent memory bloat
                    if pre_speech.len() == config.pre_speech_chunks * config.hop_size {
                        pre_speech.shrink_to_fit();
                    }
                }
            }
        }
    }
}

// Continuous capture (VAD disabled)
async fn run_continuous_capture(
    app: AppHandle,
    stream: impl StreamExt<Item = f32> + Unpin,
    sr: u32,
    config: VadConfig,
) {
    let mut stream = stream;
    let max_samples = (sr as u64 * config.max_recording_duration_secs) as usize;

    // Pre-allocate buffer to prevent reallocations
    let mut audio_buffer = Vec::with_capacity(max_samples);
    let start_time = Instant::now();
    let max_duration = Duration::from_secs(config.max_recording_duration_secs);

    // Atomic flag for manual stop
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_for_listener = stop_flag.clone();

    // Listen for manual stop event
    let stop_listener = app.listen("manual-stop-continuous", move |_| {
        stop_flag_for_listener.store(true, Ordering::Release);
    });

    // Emit recording started
    let _ = app.emit(
        "continuous-recording-start",
        config.max_recording_duration_secs,
    );

    // Accumulate audio - check stop flag on EVERY sample for immediate response
    loop {
        // Check stop flag FIRST on every iteration for immediate stopping
        if stop_flag.load(Ordering::Acquire) {
            break;
        }

        tokio::select! {
            sample_opt = stream.next() => {
                match sample_opt {
                    Some(sample) => {
                        if stop_flag.load(Ordering::Acquire) {
                            break;
                        }

                        audio_buffer.push(sample);

                        let elapsed = start_time.elapsed();

                        // Emit progress every second
                        if audio_buffer.len() % (sr as usize) == 0 {
                            let _ = app.emit("recording-progress", elapsed.as_secs());
                        }

                        // Check size limit (safety)
                        if audio_buffer.len() >= max_samples {
                            break;
                        }

                        // Check time limit
                        if elapsed >= max_duration {
                            break;
                        }
                    },
                    None => {
                        warn!("Audio stream ended unexpectedly");
                        break;
                    }
                }
            }
            _ = tokio::time::sleep(tokio::time::Duration::from_millis(10)) => {
            }
        }
    }

    // Clean up event listener (CRITICAL)
    app.unlisten(stop_listener);

    // Process and emit audio
    if !audio_buffer.is_empty() {
        // let duration = start_time.elapsed().as_secs_f32();

        // Apply noise gate
        let cleaned_audio = apply_noise_gate(&audio_buffer, config.noise_gate_threshold);
        let cleaned_audio = normalize_audio_level(&cleaned_audio, 0.1);

        let resampled = resample_to_16k(&cleaned_audio, sr);
        match samples_to_wav_b64(16000, &resampled) {
            Ok(b64) => {
                let _ = app.emit("speech-detected", b64);
            }
            Err(e) => {
                error!("Failed to encode continuous audio: {}", e);
                let _ = app.emit("audio-encoding-error", e);
            }
        }
    } else {
        warn!("No audio captured in continuous mode");
        let _ = app.emit("audio-encoding-error", "No audio recorded");
    }

    let _ = app.emit("continuous-recording-stopped", ());
}

// Apply noise gate
/// Monotonic gain calculation for noise gate envelope follower / RMS multiplier (R10).
pub fn envelope_gain(level: f32, threshold: f32) -> f32 {
    if threshold <= 0.0 {
        return 1.0;
    }
    if level >= threshold {
        1.0
    } else {
        (level / threshold).clamp(0.0, 1.0)
    }
}

/// Apply noise gate via RMS multiplier / envelope follower.
/// Scales blocks linearly by RMS-derived envelope gain instead of per-sample powf
/// waveshaping, avoiding harmonic distortion on quiet consonants (/s/, /f/).
pub fn apply_noise_gate(samples: &[f32], threshold: f32) -> Vec<f32> {
    if threshold <= 0.0 || samples.is_empty() {
        return samples.to_vec();
    }

    const BLOCK_SIZE: usize = 256;
    let mut out = Vec::with_capacity(samples.len());

    for chunk in samples.chunks(BLOCK_SIZE) {
        let (rms, _) = calculate_audio_metrics(chunk);
        let gain = envelope_gain(rms, threshold);
        for &s in chunk {
            out.push(s * gain);
        }
    }

    out
}

// Calculate RMS and peak (optimized)
fn calculate_audio_metrics(chunk: &[f32]) -> (f32, f32) {
    let mut sumsq = 0.0f32;
    let mut peak = 0.0f32;

    for &v in chunk {
        let a = v.abs();
        peak = peak.max(a);
        sumsq += v * v;
    }

    let rms = (sumsq / chunk.len() as f32).sqrt();
    (rms, peak)
}

fn normalize_audio_level(samples: &[f32], target_rms: f32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    let sum_squares: f32 = samples.iter().map(|&s| s * s).sum();
    let current_rms = (sum_squares / samples.len() as f32).sqrt();

    if current_rms < 0.001 {
        return samples.to_vec();
    }

    let gain = (target_rms / current_rms).min(10.0);

    samples
        .iter()
        .map(|&s| {
            let amplified = s * gain;
            if amplified.abs() > 1.0 {
                amplified.signum() * (1.0 - (-amplified.abs()).exp())
            } else {
                amplified
            }
        })
        .collect()
}

// Downsample to 16 kHz via linear interpolation (STT needs at most 16 kHz)
fn resample_to_16k(samples: &[f32], from_rate: u32) -> Vec<f32> {
    const TARGET_RATE: u32 = 16000;

    if from_rate == TARGET_RATE || samples.is_empty() {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / TARGET_RATE as f64;
    let out_len = (samples.len() as f64 / ratio) as usize;
    let mut out = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let src_pos = i as f64 * ratio;
        let idx = src_pos as usize;
        let frac = (src_pos - idx as f64) as f32;
        let s0 = samples[idx];
        let s1 = if idx + 1 < samples.len() {
            samples[idx + 1]
        } else {
            s0
        };
        out.push(s0 + (s1 - s0) * frac);
    }

    out
}

// Convert samples to WAV base64 (with proper error handling)
fn samples_to_wav_b64(sample_rate: u32, mono_f32: &[f32]) -> Result<String, String> {
    // Validate sample rate
    if !(8000..=96000).contains(&sample_rate) {
        error!("Invalid sample rate: {}", sample_rate);
        return Err(format!(
            "Invalid sample rate: {}. Expected 8000-96000 Hz",
            sample_rate
        ));
    }

    // Validate buffer
    if mono_f32.is_empty() {
        return Err("Empty audio buffer".to_string());
    }

    let mut cursor = Cursor::new(Vec::new());
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = WavWriter::new(&mut cursor, spec).map_err(|e| {
        error!("Failed to create WAV writer: {}", e);
        e.to_string()
    })?;

    for &s in mono_f32 {
        let clamped = s.clamp(-1.0, 1.0);
        let sample_i16 = (clamped * i16::MAX as f32) as i16;
        writer.write_sample(sample_i16).map_err(|e| e.to_string())?;
    }

    writer.finalize().map_err(|e| e.to_string())?;

    Ok(B64.encode(cursor.into_inner()))
}

#[tauri::command]
pub async fn stop_system_audio_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<crate::AudioState>();

    // Which capture we are stopping. A start that lands during the delays below
    // claims a NEWER generation, and this stop must then leave its state alone.
    let stopping_generation = *state
        .capture_generation
        .lock()
        .map_err(|e| format!("Failed to read capture generation: {}", e))?;

    // Abort task in separate scope (Send trait fix)
    {
        let mut guard = state
            .stream_task
            .lock()
            .map_err(|e| format!("Failed to acquire task lock: {}", e))?;

        if let Some(task) = guard.take() {
            task.abort();
        }
    }

    // Brief delay for proper cleanup (was 300+200ms - halved for snappier
    // capture restarts during interviews).
    tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

    // Mark as not capturing — but ONLY if no new capture started meanwhile.
    //
    // These delays are 250ms in total, and the UI restarts capture right after
    // stopping it (the interview flow does exactly that). Writing `false`
    // unconditionally therefore wiped the state of a capture that had already
    // begun: the engine was recording while every caller believed it was not.
    let still_ours = {
        let guard = state
            .capture_generation
            .lock()
            .map_err(|e| format!("Failed to read capture generation: {}", e))?;
        *guard == stopping_generation
    };
    if still_ours {
        *state
            .is_capturing
            .lock()
            .map_err(|e| format!("Failed to update capturing state: {}", e))? = false;
    }

    // Additional cleanup delay (CRITICAL for mic indicator)
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Emit stopped event only for the capture this call actually stopped.
    if still_ours {
        let _ = app.emit("capture-stopped", ());
    }
    Ok(())
}

/// Manual stop for continuous recording
#[tauri::command]
pub async fn manual_stop_continuous(app: AppHandle) -> Result<(), String> {
    let _ = app.emit("manual-stop-continuous", ());

    tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;

    Ok(())
}

#[tauri::command]
pub fn check_system_audio_access(_app: AppHandle) -> Result<bool, String> {
    match SpeakerInput::new() {
        Ok(_) => Ok(true),
        Err(e) => {
            error!("System audio access check failed: {}", e);
            Ok(false)
        }
    }
}

#[tauri::command]
pub async fn request_system_audio_access(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.shell()
            .command("open")
            .args(["x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture"])
            .spawn()
            .map_err(|e| {
                error!("Failed to open system preferences: {}", e);
                e.to_string()
            })?;
    }
    #[cfg(target_os = "windows")]
    {
        app.shell()
            .command("ms-settings:sound")
            .spawn()
            .map_err(|e| {
                error!("Failed to open sound settings: {}", e);
                e.to_string()
            })?;
    }
    #[cfg(target_os = "linux")]
    {
        let commands = ["pavucontrol", "gnome-control-center sound"];
        let mut opened = false;

        for cmd in &commands {
            if app.shell().command(cmd).spawn().is_ok() {
                opened = true;
                break;
            }
        }

        if !opened {
            warn!("Failed to open audio settings on Linux");
        }
    }

    Ok(())
}

// VAD Configuration Management
#[tauri::command]
pub async fn get_vad_config(app: AppHandle) -> Result<VadConfig, String> {
    let state = app.state::<crate::AudioState>();
    let config = state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to get VAD config: {}", e))?
        .clone();
    Ok(config)
}

#[tauri::command]
pub async fn update_vad_config(app: AppHandle, config: VadConfig) -> Result<(), String> {
    // Validate config
    if config.sensitivity_rms < 0.0 || config.sensitivity_rms > 1.0 {
        return Err("Invalid sensitivity_rms: must be 0.0-1.0".to_string());
    }
    if config.max_recording_duration_secs > 3600 {
        return Err("Invalid max_recording_duration_secs: must be <= 3600 (1 hour)".to_string());
    }

    let state = app.state::<crate::AudioState>();
    *state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to update VAD config: {}", e))? = config;

    Ok(())
}

#[tauri::command]
pub async fn get_capture_status(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<crate::AudioState>();
    let is_capturing = *state
        .is_capturing
        .lock()
        .map_err(|e| format!("Failed to get capture status: {}", e))?;
    Ok(is_capturing)
}

#[tauri::command]
pub fn get_input_devices() -> Result<Vec<AudioDevice>, String> {
    crate::speaker::list_input_devices().map_err(|e| {
        error!("Failed to get input devices: {}", e);
        format!("Failed to get input devices: {}", e)
    })
}

#[tauri::command]
pub fn get_output_devices() -> Result<Vec<AudioDevice>, String> {
    crate::speaker::list_output_devices().map_err(|e| {
        error!("Failed to get output devices: {}", e);
        format!("Failed to get output devices: {}", e)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_live_config_refresh_applies_sliders() {
        use std::sync::{Arc, Mutex};
        let mut running = VadConfig::default();
        let shared = Arc::new(Mutex::new(VadConfig::default()));
        {
            let mut fresh = shared.lock().unwrap();
            fresh.silence_chunks = 30;
            fresh.noise_gate_threshold = 0.009;
            fresh.enabled = false; // must NOT leak into a running loop
        }
        refresh_live_config(&mut running, &shared);
        assert_eq!(running.silence_chunks, 30);
        assert_eq!(running.noise_gate_threshold, 0.009);
        assert!(running.enabled, "enabled stays a stop/start operation");
    }

    #[test]
    fn test_snr_ratio_for_sensitivity() {
        assert!((snr_ratio_for(0.012) - 3.0).abs() < 1e-6, "default slider keeps shipped behaviour");
        assert!(snr_ratio_for(0.020) < snr_ratio_for(0.012), "higher slider = more sensitive");
        assert!(snr_ratio_for(0.001) > snr_ratio_for(0.012), "lower slider = less sensitive");
    }

    #[test]
    fn test_vad_config_defaults() {
        let cfg = VadConfig::default();
        assert_eq!(cfg.silence_chunks, 12, "silence_chunks default must be 12 (~0.28s)");
        assert_eq!(cfg.sensitivity_rms, 0.012);
        assert_eq!(cfg.peak_threshold, 0.035);
    }

    #[test]
    fn test_adaptive_threshold_calculation() {
        let sensitivity_rms = 0.012f32;
        // Very quiet floor: 0.001 -> 0.001 * 3.0 + 0.004 = 0.007 < 0.012 => effective is 0.012
        let floor_quiet = 0.001f32;
        let eff_quiet = sensitivity_rms.max((floor_quiet * 3.0 + 0.004).min(sensitivity_rms * 1.8));
        assert_eq!(eff_quiet, 0.012);

        // Elevated noise floor: 0.005 -> raw 0.019, but the boost is capped at
        // 1.8x the user's sensitivity (0.0216), so 0.019 stands.
        let floor_noisy = 0.005f32;
        let eff_noisy = sensitivity_rms.max((floor_noisy * 3.0 + 0.004).min(sensitivity_rms * 1.8));
        assert!((eff_noisy - 0.019).abs() < 1e-6);

        // Very noisy floor: 0.010 -> raw 0.034 is capped to 0.012 * 1.8 = 0.0216;
        // the user's chosen sensitivity must not be silently overridden further.
        let floor_very_noisy = 0.010f32;
        let eff_capped =
            sensitivity_rms.max((floor_very_noisy * 3.0 + 0.004).min(sensitivity_rms * 1.8));
        assert!((eff_capped - 0.0216).abs() < 1e-6);
    }

    #[test]
    fn test_cadence_constant() {
        assert_eq!(FRAME_CADENCE_DIVISOR, 8, "frame cadence must be sr/8 (125ms) per R05");
    }

    #[test]
    fn test_envelope_gain_monotonic() {
        let threshold = 0.01f32;
        let mut prev_gain = -1.0f32;
        for i in 0..=100 {
            let level = (i as f32) * 0.0002;
            let gain = envelope_gain(level, threshold);
            assert!(
                gain >= prev_gain,
                "envelope gain must be monotonically non-decreasing: level {}, gain {}, prev {}",
                level, gain, prev_gain
            );
            assert!(gain >= 0.0 && gain <= 1.0);
            prev_gain = gain;
        }
        assert_eq!(envelope_gain(threshold, threshold), 1.0);
        assert_eq!(envelope_gain(threshold * 2.0, threshold), 1.0);
    }

    #[test]
    fn test_noise_floor_frozen_during_speech() {
        let mut level_window = VecDeque::new();
        for _ in 0..50 {
            update_noise_tracking_window(&mut level_window, 0.001, 200, false);
        }
        assert_eq!(level_window.len(), 50);

        for _ in 0..300 {
            let updated = update_noise_tracking_window(&mut level_window, 0.05, 200, true);
            assert!(!updated, "must freeze noise floor tracking when in_speech");
        }
        assert_eq!(level_window.len(), 50);
        let min = level_window.iter().copied().fold(f32::INFINITY, f32::min);
        assert_eq!(min, 0.001, "noise floor must not be contaminated by speech");
    }

    #[test]
    fn test_apply_noise_gate_preserves_linearity() {
        let threshold = 0.01f32;
        let mut block = Vec::with_capacity(256);
        for i in 0..256 {
            let s = 0.005f32 * ((i as f32) * 0.1).sin();
            block.push(s);
        }
        let gated = apply_noise_gate(&block, threshold);
        assert_eq!(gated.len(), block.len());
        let (rms, _) = calculate_audio_metrics(&block);
        let expected_gain = envelope_gain(rms, threshold);
        for (i, (&orig, &g)) in block.iter().zip(gated.iter()).enumerate() {
            let expected = orig * expected_gain;
            assert!(
                (g - expected).abs() < 1e-6,
                "sample {} differs from linear envelope scale: got {}, expected {}",
                i, g, expected
            );
        }
    }

    #[test]
    fn test_long_utterance_does_not_fragment() {
        let config = VadConfig::default();
        let mut level_peak_window: VecDeque<f32> = VecDeque::new();
        for _ in 0..50 {
            update_noise_tracking_window(&mut level_peak_window, 0.001, 200, false);
        }
        let pre_floor_initial = level_peak_window.iter().copied().fold(f32::INFINITY, f32::min);
        assert_eq!(pre_floor_initial, 0.001);

        let in_speech = true;
        let speech_rms = 0.025f32;
        let speech_peak = 0.06f32;

        for chunk_idx in 0..350 {
            let updated = update_noise_tracking_window(&mut level_peak_window, speech_rms, 200, in_speech);
            assert!(!updated);

            let pre_floor = level_peak_window.iter().copied().fold(f32::INFINITY, f32::min);
            let snr_threshold = (pre_floor * snr_ratio_for(config.sensitivity_rms)).max(VAD_ABSOLUTE_FLOOR);
            let is_speech = (speech_rms > snr_threshold || speech_peak > config.peak_threshold)
                && speech_rms > pre_floor * 1.2;

            assert!(
                is_speech,
                "speech must not be extinguished at chunk {} (>4.6s) because noise floor must remain frozen",
                chunk_idx
            );
        }
    }
}

#[cfg(test)]
mod audio_tail_tests {
    use super::{finish_speech_segment, flush_pending_speech_frame};
    use std::cell::RefCell;

    #[test]
    fn r11_tail_once_before_final_for_silence_and_cap() {
        for (samples, emitted) in [
            (vec![0.1, 0.2, 0.3, 0.4], 2),
            (vec![0.5, 0.6], 0),
            (vec![0.7, 0.8, 0.9], 3),
            (vec![0.7, 0.8], 3), // Silence trimming can remove already sent samples.
        ] {
            let events = RefCell::new(Vec::new());
            let mut cursor = emitted;
            let frame = |tail: &[f32]| {
                assert_eq!(tail.as_ptr(), samples[emitted.min(samples.len())..].as_ptr());
                events.borrow_mut().push(("frame", tail.to_vec()));
            };
            finish_speech_segment(&samples, &mut cursor, frame, |whole| {
                events.borrow_mut().push(("final", whole.to_vec()));
            });
            flush_pending_speech_frame(&samples, &mut cursor, |_| panic!("duplicate tail"));
            let mut expected = Vec::new();
            if emitted < samples.len() {
                expected.push(("frame", samples[emitted..].to_vec()));
            }
            expected.push(("final", samples.clone()));
            assert_eq!(*events.borrow(), expected);
            assert_eq!(cursor, samples.len());
        }
    }

    #[test]
    fn r11_periodic_prefix_and_final_tail_have_no_overlap() {
        let mut samples = vec![0.1, 0.2];
        let frames = RefCell::new(Vec::new());
        let mut cursor = 0;
        flush_pending_speech_frame(&samples, &mut cursor, |pcm| {
            frames.borrow_mut().extend_from_slice(pcm);
        });
        samples.extend_from_slice(&[0.3, 0.4]);
        finish_speech_segment(&samples, &mut cursor, |pcm| {
            frames.borrow_mut().extend_from_slice(pcm);
        }, |whole| {
            assert_eq!(*frames.borrow(), whole);
        });
        assert_eq!(*frames.borrow(), samples);
    }
}
