use eframe::egui;
use std::{path::PathBuf, process::{Child, Command, Stdio}};

struct VoiceApp {
    reference: Option<PathBuf>,
    input_device: String,
    output_device: String,
    engine: String,
    babiniku_exe: String,
    status: String,
    child: Option<Child>,
    log: String,
}

impl Default for VoiceApp {
    fn default() -> Self {
        Self {
            reference: None,
            input_device: String::new(),
            output_device: "VoiceMeeter Input".into(),
            engine: "meanvc".into(),
            babiniku_exe: "babiniku.exe".into(),
            status: "Ready — choose a WAV reference and audio devices.".into(),
            child: None,
            log: String::new(),
        }
    }
}

impl VoiceApp {
    fn start(&mut self) {
        if self.child.is_some() { return; }
        let Some(reference) = self.reference.as_ref() else {
            self.status = "Choose a reference WAV first.".into();
            return;
        };
        if !reference.is_file() {
            self.status = "The selected reference file no longer exists.".into();
            return;
        }
        let mut cmd = Command::new(&self.babiniku_exe);
        cmd.arg("--reference").arg(reference)
            .arg("--engine").arg(&self.engine)
            .arg("--monitor").arg("--denoise")
            .stdout(Stdio::null()).stderr(Stdio::null());
        if !self.input_device.trim().is_empty() {
            cmd.arg("--input-device").arg(self.input_device.trim());
        }
        if !self.output_device.trim().is_empty() {
            cmd.arg("--output-device").arg(self.output_device.trim());
        }
        match cmd.spawn() {
            Ok(child) => {
                self.child = Some(child);
                self.status = "Starting conversion… Check the engine console if startup takes a while.".into();
            }
            Err(e) => self.status = format!("Could not launch babiniku.exe: {e}. Put it beside this GUI or enter its full path."),
        }
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            match child.kill() {
                Ok(()) => self.status = "Conversion stopped.".into(),
                Err(e) => self.status = format!("Stop request failed: {e}"),
            }
            let _ = child.wait();
        } else {
            self.status = "Conversion is not running.".into();
        }
    }
}

impl eframe::App for VoiceApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let child_state = self.child.as_mut().map(|child| child.try_wait());
        match child_state {
            Some(Ok(Some(exit))) => {
                self.status = format!("Engine exited ({exit}). Check device names, model checkpoints, and reference WAV.");
                self.child = None;
            }
            Some(Ok(None)) => self.status = "Conversion process is running.".into(),
            Some(Err(e)) => self.status = format!("Could not read engine status: {e}"),
            None => {}
        }
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("Rust WAV Reference Voice Changer");
            ui.label("Live microphone conversion • Local processing • Windows");
            ui.add_space(12.0);

            ui.group(|ui| {
                ui.heading("1. Target voice");
                ui.horizontal(|ui| {
                    if ui.button("Choose reference WAV…").clicked() {
                        if let Some(path) = rfd::FileDialog::new()
                            .add_filter("WAV audio", &["wav"])
                            .pick_file() {
                            self.reference = Some(path);
                        }
                    }
                    if ui.button("Clear").clicked() { self.reference = None; }
                });
                ui.label(self.reference.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "No WAV selected".into()));
                ui.small("Use a clean recording of the target speaker, ideally several seconds of clear speech.");
            });

            ui.add_space(8.0);
            ui.group(|ui| {
                ui.heading("2. Audio routing");
                ui.label("Microphone device (blank = Windows default)");
                ui.text_edit_singleline(&mut self.input_device);
                ui.label("Output / virtual-cable playback device");
                ui.text_edit_singleline(&mut self.output_device);
                ui.small("For VoiceMeeter Banana, output to VoiceMeeter Input, then choose VoiceMeeter Output as the microphone in VRChat.");
            });

            ui.add_space(8.0);
            ui.group(|ui| {
                ui.heading("3. Conversion engine");
                ui.horizontal(|ui| {
                    ui.selectable_value(&mut self.engine, "meanvc".into(), "MeanVC (CPU)");
                    ui.selectable_value(&mut self.engine, "xvc".into(), "X-VC (multilingual; CPU may lag)");
                });
                ui.label("Babiniku executable path");
                ui.text_edit_singleline(&mut self.babiniku_exe);
                ui.small("This GUI launches the separate Babiniku engine. Install/build it with the wavlm feature; do not enable Seed-VC.");
            });

            ui.add_space(12.0);
            ui.horizontal(|ui| {
                let running = self.child.is_some();
                if ui.add_enabled(!running, egui::Button::new("Start conversion")).clicked() { self.start(); }
                if ui.add_enabled(running, egui::Button::new("Stop")).clicked() { self.stop(); }
            });
            ui.separator();
            ui.label(format!("Status: {}", self.status));
            ui.hyperlink_to("Babiniku engine setup (Windows)", "https://github.com/m96-chan/babiniku.rs/blob/main/docs/windows.md");
            ui.hyperlink_to("Voice changer project branch", "https://github.com/nezoko45-dev/voicechanger/tree/feature/rust-wav-reference-voicechanger");
        });
        ctx.request_repaint_after(std::time::Duration::from_millis(500));
    }
}

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([620.0, 650.0]).with_min_inner_size([560.0, 580.0]),
        ..Default::default()
    };
    eframe::run_native("Rust WAV Reference Voice Changer", options, Box::new(|_cc| Ok(Box::new(VoiceApp::default()))))
}
