using NAudio.CoreAudioApi;
using NAudio.Wave;
using System.Collections.Concurrent;

public sealed class AudioEngine : IDisposable
{
    private readonly string root;
    private readonly string modelDir;
    private readonly OpenVoiceOnnx voice;
    private MMDeviceEnumerator? enumerator;
    private WasapiCapture? capture;
    private WasapiOut? output;
    private BufferedWaveProvider? outputBuffer;
    private readonly object gate = new();
    private readonly ConcurrentQueue<float[]> queue = new();
    private CancellationTokenSource? workerCts;
    private Task? worker;
    private bool running;
    private bool externalInput;
    private int inputId = -1, outputId = -1;
    private long underruns;
    private int queuedBlocks;
    private readonly List<float> captureSamples = new();

    public AudioEngine(string root)
    {
        this.root = root;
        modelDir = Path.Combine(root, "models");
        Directory.CreateDirectory(modelDir);
        voice = new OpenVoiceOnnx(modelDir);
    }

    public object Status() => new
    {
        ok = true,
        running,
        externalInput,
        models = voice.Ready,
        voice = voice.HasTarget,
        inputId = inputId < 0 ? (int?)null : inputId,
        outputId = outputId < 0 ? (int?)null : outputId,
        underruns,
        queuedBlocks
    };

    public object[] GetDevices()
    {
        enumerator ??= new MMDeviceEnumerator();
        var list = new List<object>();
        foreach (var d in enumerator.EnumerateAudioEndPoints(DataFlow.All, DeviceState.Active))
        {
            list.Add(new
            {
                id = list.Count,
                name = d.FriendlyName,
                input = d.DataFlow == DataFlow.Capture,
                output = d.DataFlow == DataFlow.Render,
                flow = d.DataFlow.ToString()
            });
        }
        return list.ToArray();
    }

    private MMDevice GetDevice(int id, DataFlow flow)
    {
        enumerator ??= new MMDeviceEnumerator();
        var devices = enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active);
        if (id >= 0 && id < devices.Count) return devices[id];

        var fallback = flow == DataFlow.Capture
            ? devices.FirstOrDefault()
            : devices.FirstOrDefault(d => d.FriendlyName.Contains("Voicemeeter", StringComparison.OrdinalIgnoreCase))
              ?? devices.FirstOrDefault();

        return fallback ?? throw new Exception($"No {flow} audio device found.");
    }

    public int? FindVoicemeeter()
    {
        enumerator ??= new MMDeviceEnumerator();
        var devices = enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
        for (int i = 0; i < devices.Count; i++)
            if (devices[i].FriendlyName.Contains("Voicemeeter", StringComparison.OrdinalIgnoreCase))
                return i;
        return null;
    }

    public async Task SetTargetAsync(byte[] wav) => await voice.SetTargetAsync(wav);

    public async Task StartAsync(int? requestedInput, int? requestedOutput)
    {
        Stop();
        if (!voice.HasTarget) throw new Exception("Choose a reference WAV voice first.");
        await voice.LoadAsync();

        var inDev = GetDevice(requestedInput ?? -1, DataFlow.Capture);
        await StartOutputAsync(requestedOutput);

        inputId = DeviceIndex(inDev, DataFlow.Capture);
        externalInput = false;

        capture = new WasapiCapture(inDev);
        capture.DataAvailable += Capture_DataAvailable;
        capture.RecordingStopped += (_, e) =>
        {
            if (e.Exception != null) Console.WriteLine("[Capture] " + e.Exception.Message);
        };

        running = true;
        capture.StartRecording();
        Console.WriteLine($"Audio started. Input={inDev.FriendlyName} OutputId={outputId}");
    }

    public async Task StartExternalAsync(int? requestedOutput)
    {
        Stop();
        if (!voice.HasTarget) throw new Exception("Choose a reference WAV voice first.");
        await voice.LoadAsync();
        await StartOutputAsync(requestedOutput);
        externalInput = true;
        running = true;
        Console.WriteLine($"External audio started. OutputId={outputId}");
    }

    private async Task StartOutputAsync(int? requestedOutput)
    {
        var outDev = GetDevice(requestedOutput ?? FindVoicemeeter() ?? -1, DataFlow.Render);
        outputId = DeviceIndex(outDev, DataFlow.Render);

        const int rate = 48000;
        outputBuffer = new BufferedWaveProvider(new WaveFormat(rate, 16, 1))
        {
            DiscardOnBufferOverflow = true,
            BufferDuration = TimeSpan.FromMilliseconds(1200)
        };

        output = new WasapiOut(outDev, AudioClientShareMode.Shared, true, 30);
        output.Init(outputBuffer);
        workerCts = new CancellationTokenSource();
        worker = Task.Run(() => ProcessLoop(workerCts.Token));
        output.Play();
    }

    private int DeviceIndex(MMDevice selected, DataFlow flow)
    {
        enumerator ??= new MMDeviceEnumerator();
        var devices = enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active);
        for (int i = 0; i < devices.Count; i++)
            if (devices[i].ID == selected.ID) return i;
        return -1;
    }

    private void Capture_DataAvailable(object? sender, WaveInEventArgs e)
    {
        if (!running || externalInput) return;
        var mono48 = CaptureToMono48(e.Buffer, e.BytesRecorded, capture!.WaveFormat);
        PushSamples(mono48);
    }

    public void PushPcm16(byte[] pcm)
    {
        if (!running || !externalInput || pcm.Length < 2) return;
        var samples = new float[pcm.Length / 2];
        for (int i = 0; i < samples.Length; i++)
            samples[i] = BitConverter.ToInt16(pcm, i * 2) / 32768f;
        PushSamples(samples);
    }

    private void PushSamples(float[] samples)
    {
        lock (gate)
        {
            captureSamples.AddRange(samples);
            const int chunk = 28800; // 600 ms at 48 kHz
            while (captureSamples.Count >= chunk)
            {
                var block = captureSamples.Take(chunk).ToArray();
                captureSamples.RemoveRange(0, chunk);
                queue.Enqueue(block);
                Interlocked.Increment(ref queuedBlocks);
            }
        }
    }

    private async Task ProcessLoop(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            if (!queue.TryDequeue(out var block))
            {
                await Task.Delay(2, token).ConfigureAwait(false);
                continue;
            }

            Interlocked.Decrement(ref queuedBlocks);
            try
            {
                var converted = await voice.ConvertAsync(block);
                if (outputBuffer != null)
                {
                    var pcm = FloatToPcm16(converted);
                    outputBuffer.AddSamples(pcm, 0, pcm.Length);
                    if (outputBuffer.BufferedDuration < TimeSpan.FromMilliseconds(30))
                        Interlocked.Increment(ref underruns);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("[OpenVoice] " + ex.Message);
            }
        }
    }

    private static float[] CaptureToMono48(byte[] data, int bytes, WaveFormat f)
    {
        int channels = Math.Max(1, f.Channels);
        var mono = new List<float>(bytes / Math.Max(1, f.BitsPerSample / 8) / channels);

        if (f.Encoding == WaveFormatEncoding.IeeeFloat && f.BitsPerSample == 32)
        {
            for (int p = 0; p + 4 * channels <= bytes; p += 4 * channels)
            {
                float s = 0;
                for (int c = 0; c < channels; c++) s += BitConverter.ToSingle(data, p + c * 4);
                mono.Add(Math.Clamp(s / channels, -1f, 1f));
            }
        }
        else if (f.Encoding == WaveFormatEncoding.Pcm && f.BitsPerSample == 16)
        {
            for (int p = 0; p + 2 * channels <= bytes; p += 2 * channels)
            {
                int s = 0;
                for (int c = 0; c < channels; c++) s += BitConverter.ToInt16(data, p + c * 2);
                mono.Add(Math.Clamp((s / (float)channels) / 32768f, -1f, 1f));
            }
        }
        else throw new Exception($"Unsupported microphone format: {f.Encoding} {f.BitsPerSample}-bit.");

        if (f.SampleRate == 48000) return mono.ToArray();

        int n = Math.Max(1, (int)Math.Round(mono.Count * 48000.0 / f.SampleRate));
        var outp = new float[n];
        for (int i = 0; i < n; i++)
        {
            double q = i * (mono.Count - 1.0) / Math.Max(1, n - 1);
            int j = (int)Math.Floor(q);
            double frac = q - j;
            outp[i] = (float)(mono[Math.Min(j, mono.Count - 1)] * (1 - frac) +
                              mono[Math.Min(j + 1, mono.Count - 1)] * frac);
        }
        return outp;
    }

    private static byte[] FloatToPcm16(float[] x)
    {
        var b = new byte[x.Length * 2];
        for (int i = 0; i < x.Length; i++)
        {
            var v = Math.Clamp(x[i], -1f, 1f);
            short s = (short)Math.Round(v < 0 ? v * 32768 : v * 32767);
            BitConverter.TryWriteBytes(b.AsSpan(i * 2, 2), s);
        }
        return b;
    }

    public void Stop()
    {
        running = false;
        try { capture?.StopRecording(); } catch { }
        capture?.Dispose(); capture = null;
        try { output?.Stop(); } catch { }
        output?.Dispose(); output = null;
        outputBuffer = null;
        workerCts?.Cancel();
        try { worker?.Wait(500); } catch { }
        workerCts?.Dispose(); workerCts = null; worker = null;
        while (queue.TryDequeue(out _)) { }
        lock (gate) captureSamples.Clear();
        inputId = outputId = -1;
        externalInput = false;
    }

    public void Dispose()
    {
        Stop();
        voice.Dispose();
        enumerator?.Dispose();
    }
}
