use msedge_tts::{tts::client::connect, tts::SpeechConfig, voice::get_voices_list};
use std::{env, error::Error, fs, path::PathBuf};

fn arg_value(args: &[String], name: &str) -> Result<String, Box<dyn Error>> {
    let index = args.iter().position(|value| value == name)
        .ok_or_else(|| format!("Missing required argument: {name}"))?;
    args.get(index + 1).cloned().ok_or_else(|| format!("Missing value for {name}").into())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    let voice_name = arg_value(&args, "--voice")?;
    let text = arg_value(&args, "--text")?;
    let output = PathBuf::from(arg_value(&args, "--output")?);
    if text.trim().is_empty() {
        return Err("Text is empty".into());
    }

    let voices = get_voices_list()?;
    let voice = voices.iter().find(|voice| voice.name == voice_name)
        .ok_or_else(|| format!("Microsoft Edge voice not found: {voice_name}"))?;
    let config = SpeechConfig::from(voice);
    let mut client = connect()?;
    let audio = client.synthesize(&text, &config)?;
    if audio.audio_bytes.is_empty() {
        return Err("Microsoft Edge returned no audio bytes".into());
    }
    fs::write(&output, audio.audio_bytes)?;
    Ok(())
}
