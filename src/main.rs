use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use eframe::egui;
use vc_app::{
    AudioHost, EngineController, EngineState, F0Config, LiveParams, RealtimeConfig, Smoother,
};
use vc_core::Provider;

struct VoiceChangerApp {
    engine: Arc<EngineController>,
    inputs: Vec<String>,
    outputs: Vec<String>,
    input_device: String,
    output_device: String,
    model: String,
    embedder: String,
    f0_model: String,
    pitch: f32,
    input_gain: f32,
    output_gain: f32,
    chunk_ms: u32,
    status: String,
    error: String,
}

impl VoiceChangerApp {
    fn new() -> Self {
        let engine = Arc::new(EngineController::new(LiveParams {
            pitch_shift: -3.0,
            speaker_id: 0,
            input_gain: 1.0,
            output_gain: 1.0,
            noise_gate_enabled: false,
            noise_gate_threshold: 0.01,
        }));

        let app = Self {
            engine,
            inputs: Vec::new(),
            outputs: Vec::new(),
            input_device: String::new(),
            output_device: String::new(),
            model: "models\\voice.onnx".into(),
            embedder: "models\\content_vec_500.onnx".into(),
            f0_model: "models\\rmvpe.onnx".into(),
            pitch: -3.0,
            input_gain: 1.0,
            output_gain: 1.0,
            chunk_ms: 120,
            status: "Stopped".into(),
            error: String::new(),
        };
        app.refresh_devices();
        app
    }

    fn refresh_devices(&self) {
        let _ = self.engine.refresh_devices(AudioHost::Wasapi, AudioHost::Wasapi);
    }

    fn browse_model(path: &mut String, filter: &[&str]) {
        if let Some(file) = rfd::FileDialog::new()
            .add_filter("ONNX model", filter)
            .pick_file()
        {
            *path = file.to_string_lossy().into_owned();
        }
    }

    fn start(&mut self) {
        self.error.clear();

        let config = RealtimeConfig {
            model: Some(PathBuf::from(self.model.trim())),
            embedder: Some(PathBuf::from(self.embedder.trim())),
            f0_model: Some(PathBuf::from(self.f0_model.trim())),
            provider: Provider::Cpu,
            input_host: AudioHost::Wasapi,
            output_host: AudioHost::Wasapi,
            input_device: if self.input_device.is_empty() { None } else { Some(self.input_device.clone()) },
            output_device: if self.output_device.is_empty() { None } else { Some(self.output_device.clone()) },
            chunk_ms: self.chunk_ms,
            crossfade_ms: 45,
            sola_search_ms: 8,
            smoother: Smoother::Sola,
            extra_convert_ms: 60,
            f0: F0Config::default(),
            passthrough: false,
            ..RealtimeConfig::default()
        };

        if let Err(e) = self.engine.apply_config(config) {
            self.error = format!("{e:#}");
            return;
        }

        self.engine.set_live_params(LiveParams {
            pitch_shift: self.pitch,
            speaker_id: 0,
            input_gain: self.input_gain,
            output_gain: self.output_gain,
            noise_gate_enabled: false,
            noise_gate_threshold: 0.01,
        });
    }

    fn stop(&mut self) {
        if let Err(e) = self.engine.stop() {
            self.error = format!("{e:#}");
        }
    }
}

impl eframe::App for VoiceChangerApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let (status, telemetry, devices) = self.engine.snapshot();
        self.inputs = devices.inputs;
        self.outputs = devices.outputs;
        self.status = format!("{:?}: {}", status.state, status.message);

        if status.state == EngineState::Running {
            self.engine.set_live_params(LiveParams {
                pitch_shift: self.pitch,
                speaker_id: 0,
                input_gain: self.input_gain,
                output_gain: self.output_gain,
                noise_gate_enabled: false,
                noise_gate_threshold: 0.01,
            });
        }

        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("Rust RVC Voice Changer");
            ui.label("Microphone → RVC → Voicemeeter → VRChat");
            ui.separator();

            ui.horizontal(|ui| {
                ui.label("Microphone");
                egui::ComboBox::from_id_salt("input")
                    .selected_text(if self.input_device.is_empty() { "Default".into() } else { self.input_device.clone() })
                    .show_ui(ui, |ui| {
                        ui.selectable_value(&mut self.input_device, String::new(), "Default");
                        for d in &self.inputs {
                            ui.selectable_value(&mut self.input_device, d.clone(), d);
                        }
                    });
            });

            ui.horizontal(|ui| {
                ui.label("Output");
                egui::ComboBox::from_id_salt("output")
                    .selected_text(if self.output_device.is_empty() { "Default".into() } else { self.output_device.clone() })
                    .show_ui(ui, |ui| {
                        ui.selectable_value(&mut self.output_device, String::new(), "Default");
                        for d in &self.outputs {
                            ui.selectable_value(&mut self.output_device, d.clone(), d);
                        }
                    });
            });

            ui.horizontal(|ui| {
                ui.label("RVC voice model");
                ui.text_edit_singleline(&mut self.model);
                if ui.button("Browse").clicked() {
                    Self::browse_model(&mut self.model, &["onnx"]);
                }
            });

            ui.horizontal(|ui| {
                ui.label("ContentVec");
                ui.text_edit_singleline(&mut self.embedder);
                if ui.button("Browse").clicked() {
                    Self::browse_model(&mut self.embedder, &["onnx"]);
                }
            });

            ui.horizontal(|ui| {
                ui.label("RMVPE");
                ui.text_edit_singleline(&mut self.f0_model);
                if ui.button("Browse").clicked() {
                    Self::browse_model(&mut self.f0_model, &["onnx"]);
                }
            });

            ui.add(egui::Slider::new(&mut self.pitch, -12.0..=12.0).text("Pitch shift"));
            ui.add(egui::Slider::new(&mut self.input_gain, 0.25..=2.0).text("Input gain"));
            ui.add(egui::Slider::new(&mut self.output_gain, 0.25..=2.0).text("Output gain"));
            ui.add(egui::Slider::new(&mut self.chunk_ms, 40..=300).text("Chunk ms"));

            ui.horizontal(|ui| {
                if ui.button("Refresh devices").clicked() {
                    self.refresh_devices();
                }
                if ui.button("START").clicked() {
                    self.start();
                }
                if ui.button("STOP").clicked() {
                    self.stop();
                }
            });

            ui.separator();
            ui.label(format!("Status: {}", self.status));
            ui.label(format!(
                "Chunks: {}  |  In RMS: {:.3}  |  Out RMS: {:.3}  |  Buffer: {} samples",
                telemetry.chunks, telemetry.input_rms, telemetry.output_rms, telemetry.output_buffer_samples
            ));
            if !self.error.is_empty() {
                ui.colored_label(egui::Color32::RED, &self.error);
            }

            ui.separator();
            ui.small("For VRChat: route this app's output to Voicemeeter, then select the matching Voicemeeter virtual microphone in VRChat.");
            ui.small("The realtime audio path is native Rust/WASAPI. The inference worker is separated from the audio callbacks and uses bounded queues.");
        });

        ctx.request_repaint_after(Duration::from_millis(100));
    }
}

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Rust RVC Voice Changer")
            .with_inner_size([760.0, 680.0]),
        ..Default::default()
    };

    eframe::run_native(
        "Rust RVC Voice Changer",
        options,
        Box::new(|_cc| Ok(Box::new(VoiceChangerApp::new()))),
    )
}
