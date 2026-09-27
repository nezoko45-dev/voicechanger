use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use eframe::egui;

struct VoiceChangerApp {
    reference_wav: String,
    status: String,
    error: String,
    child: Mutex<Option<Child>>,
}

impl VoiceChangerApp {
    fn new() -> Self {
        Self { reference_wav: String::new(), status: "Stopped".into(), error: String::new(), child: Mutex::new(None) }
    }

    fn backend_dir() -> PathBuf { PathBuf::from("seed-vc-realtime") }

    fn start(&mut self) {
        self.error.clear();
        let wav = self.reference_wav.trim();
        if wav.is_empty() { self.error = "Choose your WAV reference voice first.".into(); return; }
        if !Path::new(wav).exists() { self.error = "The selected WAV file no longer exists.".into(); return; }

        let gui = Self::backend_dir().join("real-time-gui.py");
        if !gui.exists() { self.error = "Seed-VC is not installed yet. Run setup_seedvc.bat first.".into(); return; }

        self.stop();

        let mut command = Command::new("python");
        command.current_dir(Self::backend_dir())
            .arg("real-time-gui.py")
            .arg("--reference-path")
            .arg(wav)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());

        match command.spawn() {
            Ok(child) => { *self.child.lock().unwrap() = Some(child); self.status = "Seed-VC realtime engine started".into(); }
            Err(e) => { self.error = format!("Could not start Python/Seed-VC: {e}"); }
        }
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.status = "Stopped".into();
    }
}

impl Drop for VoiceChangerApp { fn drop(&mut self) { self.stop(); } }

impl eframe::App for VoiceChangerApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("WAV Reference Voice Changer");
            ui.label("Mic -> zero-shot voice conversion -> Voicemeeter -> VRChat");
            ui.separator();

            ui.horizontal(|ui| {
                ui.label("Reference WAV");
                ui.text_edit_singleline(&mut self.reference_wav);
                if ui.button("Choose WAV").clicked() {
                    if let Some(path) = rfd::FileDialog::new().add_filter("WAV audio", &["wav"]).pick_file() {
                        self.reference_wav = path.to_string_lossy().into_owned();
                    }
                }
            });

            ui.add_space(8.0);
            ui.label("Your WAV is the target voice. No RVC voice.onnx, ContentVec, or RMVPE files are required.");
            ui.label("Use a clean 1-30 second recording of the target speaker.");

            ui.add_space(12.0);
            ui.horizontal(|ui| {
                if ui.button("START").clicked() { self.start(); }
                if ui.button("STOP").clicked() { self.stop(); }
            });

            ui.separator();
            ui.label(format!("Status: {}", self.status));
            if !self.error.is_empty() { ui.colored_label(egui::Color32::RED, &self.error); }
            ui.separator();
            ui.small("The zero-shot Seed-VC engine handles microphone/output device selection and realtime buffering.");
            ui.small("For VRChat, send the converted output to Voicemeeter and select the matching Voicemeeter virtual microphone in VRChat.");
        });
        ctx.request_repaint_after(std::time::Duration::from_millis(250));
    }
}

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_title("WAV Reference Voice Changer").with_inner_size([760.0, 360.0]),
        ..Default::default()
    };
    eframe::run_native("WAV Reference Voice Changer", options, Box::new(|_cc| Ok(Box::new(VoiceChangerApp::new()))))
}
