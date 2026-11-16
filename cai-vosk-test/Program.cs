using System.Text.Json;
using NAudio.Wave;
using Vosk;

Vosk.Vosk.SetLogLevel(0);
var modelPath = Path.Combine(AppContext.BaseDirectory, "model");
if (!Directory.Exists(modelPath))
{
    Console.WriteLine("Missing model folder. Run setup-model.bat first.");
    return;
}

Console.WriteLine("Loading Vosk small English model...");
using var model = new Model(modelPath);
using var recognizer = new VoskRecognizer(model, 16000.0f);
recognizer.SetWords(true);

using var input = new WaveInEvent
{
    DeviceNumber = -1,
    WaveFormat = new WaveFormat(16000, 16, 1),
    BufferMilliseconds = 100
};

input.DataAvailable += (_, e) =>
{
    if (recognizer.AcceptWaveform(e.Buffer, e.BytesRecorded))
    {
        var json = recognizer.Result();
        var text = JsonDocument.Parse(json).RootElement.GetProperty("text").GetString();
        if (!string.IsNullOrWhiteSpace(text))
            Console.WriteLine("YOU: " + text);
    }
};
input.RecordingStopped += (_, e) =>
{
    if (e.Exception != null) Console.WriteLine("Mic error: " + e.Exception.Message);
};

Console.WriteLine("Vosk ready. Speak now (Ctrl+C to stop).");
input.StartRecording();
using var stop = new ManualResetEventSlim();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; input.StopRecording(); stop.Set(); };
stop.Wait();
