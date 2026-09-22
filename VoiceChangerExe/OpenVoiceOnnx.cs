using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using NAudio.Wave;
using System.Net.Http.Json;
using System.Numerics;

public sealed class OpenVoiceOnnx : IDisposable
{
    private const int Rate = 22050;
    private readonly string modelDir;
    private readonly string refPath;
    private readonly string convPath;
    private InferenceSession? refModel;
    private InferenceSession? convModel;
    private float[]? target;
    private readonly SemaphoreSlim loadLock = new(1, 1);
    private static readonly HttpClient http = new() { Timeout = TimeSpan.FromMinutes(20) };

    public bool Ready => refModel != null && convModel != null;
    public bool HasTarget => target != null;

    public OpenVoiceOnnx(string dir)
    {
        modelDir = dir;
        Directory.CreateDirectory(dir);
        refPath = Path.Combine(dir, "tone_ref_encoder_q8.onnx");
        convPath = Path.Combine(dir, "tone_converter_q8.onnx");
    }

    public async Task LoadAsync()
    {
        if (Ready) return;
        await loadLock.WaitAsync();
        try
        {
            if (Ready) return;
            await DownloadIfMissing(refPath, "tone_ref_encoder_q8.onnx");
            await DownloadIfMissing(convPath, "tone_converter_q8.onnx");
            var opts = new SessionOptions { GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL, IntraOpNumThreads = Math.Max(1, Environment.ProcessorCount - 1), InterOpNumThreads = 1 };
            refModel = new InferenceSession(refPath, opts);
            convModel = new InferenceSession(convPath, opts);
            Console.WriteLine("OpenVoice V2 ONNX models ready.");
        }
        finally { loadLock.Release(); }
    }

    private static async Task DownloadIfMissing(string path, string file)
    {
        if (File.Exists(path) && new FileInfo(path).Length > 1024) return;
        var url = $"https://huggingface.co/TigreGotico/voiceclonnx-openvoice-v2/resolve/main/{file}?download=true";
        Console.WriteLine("Downloading " + file + "...");
        await using var src = await http.GetStreamAsync(url);
        var tmp = path + ".tmp";
        await using (var dst = File.Create(tmp)) await src.CopyToAsync(dst);
        File.Move(tmp, path, true);
    }

    public async Task SetTargetAsync(byte[] wav)
    {
        await LoadAsync();
        var samples = DecodeWav(wav, out var rate);
        target = await EmbedAsync(Resample(samples, rate, Rate));
    }

    public async Task<float[]> ConvertAsync(float[] input48)
    {
        await LoadAsync();
        var x = Resample(input48, 48000, Rate);
        var spec = Spectrogram(x, out int frames);

        var src = await EmbedSpecAsync(spec, frames);
        var srcTensor = new DenseTensor<float>(new[] { 1, 256, 1 });
        for (int i = 0; i < Math.Min(256, src.Length); i++) srcTensor[0, i, 0] = src[i];

        var tgtTensor = new DenseTensor<float>(new[] { 1, 256, 1 });
        if (target == null) throw new Exception("No reference voice selected.");
        for (int i = 0; i < Math.Min(256, target.Length); i++) tgtTensor[0, i, 0] = target[i];

        var specTensor = new DenseTensor<float>(spec, new[] { 1, 513, frames });
        var lengths = new DenseTensor<long>(new[] { 1 }) { [0] = frames };

        using var results = convModel!.Run(new[]
        {
            NamedOnnxValue.CreateFromTensor("spec", specTensor),
            NamedOnnxValue.CreateFromTensor("spec_lengths", lengths),
            NamedOnnxValue.CreateFromTensor("src_g", srcTensor),
            NamedOnnxValue.CreateFromTensor("tgt_g", tgtTensor)
        });
        var output = results.First().AsEnumerable<float>().ToArray();
        return Resample(output, Rate, 48000);
    }

    private async Task<float[]> EmbedAsync(float[] x)
    {
        var spec = Spectrogram(x, out int frames);
        return await EmbedSpecAsync(spec, frames);
    }

    private Task<float[]> EmbedSpecAsync(float[] spec, int frames)
    {
        var tensor = new DenseTensor<float>(spec, new[] { 1, frames, 513 });
        using var results = refModel!.Run(new[] { NamedOnnxValue.CreateFromTensor("spec", tensor) });
        return Task.FromResult(results.First().AsEnumerable<float>().ToArray());
    }

    private static float[] DecodeWav(byte[] data, out int rate)
    {
        using var ms = new MemoryStream(data);
        using var r = new WaveFileReader(ms);
        rate = r.WaveFormat.SampleRate;
        var provider = r.ToSampleProvider();
        var buf = new float[r.WaveFormat.SampleRate * Math.Max(1, r.WaveFormat.Channels)];
        var list = new List<float>();
        int read;
        while ((read = provider.Read(buf, 0, buf.Length)) > 0)
        {
            int ch = Math.Max(1, r.WaveFormat.Channels);
            for (int i = 0; i < read; i += ch)
            {
                float s = 0;
                for (int c = 0; c < ch && i + c < read; c++) s += buf[i + c];
                list.Add(s / ch);
            }
        }
        return list.ToArray();
    }

    private static float[] Resample(float[] x, int a, int b)
    {
        if (a == b) return x;
        int n = Math.Max(1, (int)Math.Round(x.Length * b / (double)a));
        var y = new float[n];
        for (int i = 0; i < n; i++)
        {
            double q = i * (x.Length - 1.0) / Math.Max(1, n - 1);
            int j = (int)Math.Floor(q);
            double f = q - j;
            y[i] = (float)(x[Math.Min(j, x.Length - 1)] * (1 - f) + x[Math.Min(j + 1, x.Length - 1)] * f);
        }
        return y;
    }

    private static float[] Spectrogram(float[] x, out int frames)
    {
        const int N = 1024, H = 256, P = 384;
        var padded = new float[x.Length + P * 2];
        Array.Copy(x, 0, padded, P, x.Length);
        frames = Math.Max(1, (int)Math.Floor((padded.Length - N) / (double)H) + 1);
        var outp = new float[frames * 513];
        var re = new double[N];
        var im = new double[N];
        var w = new double[N];
        for (int i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (N - 1));

        for (int f = 0; f < frames; f++)
        {
            int off = f * H;
            Array.Clear(im);
            for (int n = 0; n < N; n++) re[n] = padded[Math.Min(off + n, padded.Length - 1)] * w[n];
            FFT(re, im);
            for (int k = 0; k <= 512; k++)
                outp[f * 513 + k] = (float)Math.Sqrt(re[k] * re[k] + im[k] * im[k] + 1e-6);
        }
        return outp;
    }

    private static void FFT(double[] re, double[] im)
    {
        int n = re.Length;
        for (int i = 1, j = 0; i < n; i++)
        {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) (re[i], re[j]) = (re[j], re[i]);
        }
        for (int len = 2; len <= n; len <<= 1)
        {
            int half = len >> 1;
            double ang = -2 * Math.PI / len, wr0 = Math.Cos(ang), wi0 = Math.Sin(ang);
            for (int i = 0; i < n; i += len)
            {
                double wr = 1, wi = 0;
                for (int j = 0; j < half; j++)
                {
                    int u = i + j, v = u + half;
                    double tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v];
                    re[v] = re[u] - tr; im[v] = im[u] - ti;
                    re[u] += tr; im[u] += ti;
                    double nr = wr * wr0 - wi * wi0;
                    wi = wr * wi0 + wi * wr0; wr = nr;
                }
            }
        }
    }

    public void Dispose()
    {
        refModel?.Dispose();
        convModel?.Dispose();
        loadLock.Dispose();
    }
}
