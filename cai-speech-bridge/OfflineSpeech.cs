using System.IO.Compression;
using System.Text.Json;
using NAudio.Wave;
using Vosk;

sealed class OfflineSpeech : IDisposable
{
    const string ModelUrl = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip";
    readonly string modelDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CAISpeechBridge", "vosk-model");
    Model? model;
    VoskRecognizer? recognizer;
    WaveInEvent? input;
    public event Action<string>? Phrase;
    public event Action<string>? Status;
    public bool IsListening => input != null;

    public async Task StartAsync()
    {
        if (input != null) return;
        Status?.Invoke("Preparing offline speech model… (first run downloads ~40 MB)");
        await EnsureModelAsync();
        model ??= new Model(modelDir);
        recognizer = new VoskRecognizer(model, 16000f);
        recognizer.SetWords(false);
        input = new WaveInEvent { WaveFormat = new WaveFormat(16000, 16, 1), BufferMilliseconds = 100 };
        input.DataAvailable += OnAudio;
        input.RecordingStopped += (_,__) => Status?.Invoke("Offline microphone stopped.");
        input.StartRecording();
        Status?.Invoke("Listening offline — Vosk");
    }
    async Task EnsureModelAsync()
    {
        if (File.Exists(Path.Combine(modelDir, "am", "final.mdl"))) return;
        Directory.CreateDirectory(Path.GetDirectoryName(modelDir)!);
        string zip=Path.Combine(Path.GetDirectoryName(modelDir)!, "vosk-model.zip");
        using(var http=new HttpClient()){http.Timeout=TimeSpan.FromMinutes(10);Status?.Invoke("Downloading Vosk model…");using var response=await http.GetAsync(ModelUrl,HttpCompletionOption.ResponseHeadersRead);response.EnsureSuccessStatusCode();await using var fs=File.Create(zip);await response.Content.CopyToAsync(fs);}
        string temp=modelDir+"_extract";if(Directory.Exists(temp))Directory.Delete(temp,true);ZipFile.ExtractToDirectory(zip,temp);
        string root=Directory.GetDirectories(temp).FirstOrDefault()??throw new Exception("Vosk model archive is empty");
        if(Directory.Exists(modelDir))Directory.Delete(modelDir,true);Directory.Move(root,modelDir);Directory.Delete(temp,true);File.Delete(zip);
    }
    void OnAudio(object? sender,WaveInEventArgs e)
    {
        try{if(recognizer==null)return;if(recognizer.AcceptWaveform(e.Buffer,e.BytesRecorded)){var json=JsonDocument.Parse(recognizer.Result());var text=json.RootElement.GetProperty("text").GetString();if(!string.IsNullOrWhiteSpace(text))Phrase?.Invoke(text.Trim());}}
        catch(Exception ex){Status?.Invoke("Offline recognition error: "+ex.Message);}
    }
    public void Stop(){if(input==null)return;var w=input;input=null;w.DataAvailable-=OnAudio;try{w.StopRecording();}catch{}w.Dispose();recognizer?.Dispose();recognizer=null;Status?.Invoke("Offline dictation stopped.");}
    public void Dispose(){Stop();model?.Dispose();model=null;}
}