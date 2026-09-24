using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class Program
{
    private const int ContentRate = 16000;
    private const int TargetRate = 48000;
    private const int FeatureDim = 768;
    private const int NoiseChannels = 192;

    [STAThread]
    private static void Main()
    {
        try
        {
            ApplicationConfiguration.Initialize();

            string root = AppContext.BaseDirectory;
            string models = Path.Combine(root, "models");

            string voicePath = Path.Combine(models, "GuraTalkV2.onnx");
            string contentPath = Path.Combine(models, "vec-768-layer-12.onnx");

            if (!File.Exists(voicePath) || !File.Exists(contentPath))
            {
                MessageBox.Show(
                    "The bundled ONNX voice models are missing.\n\nExpected:\n" +
                    voicePath + "\n" + contentPath +
                    "\n\nRun VoiceChanger.bat again to download them.",
                    "VoiceChanger", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            using var dialog = new OpenFileDialog
            {
                Title = "Select one WAV file",
                Filter = "WAV audio (*.wav)|*.wav|All files (*.*)|*.*",
                CheckFileExists = true,
                Multiselect = false
            };

            if (dialog.ShowDialog() != DialogResult.OK)
                return;

            string inputPath = dialog.FileName;
            string outputPath = Path.Combine(
                Path.GetDirectoryName(inputPath)!,
                Path.GetFileNameWithoutExtension(inputPath) + "_voicechanged.wav");

            using var progress = new ProgressForm();
            progress.Show();
            progress.SetStatus("Loading WAV...");
            progress.Refresh();

            var input = Wav.Read(inputPath);

            if (input.Samples.Length < 320)
                throw new InvalidOperationException("The WAV file is too short.");

            progress.SetStatus("Resampling audio...");
            progress.Refresh();

            float[] audio16 = Resample(input.Samples, input.SampleRate, ContentRate);
            float[] padded = ReflectPad(audio16, 80);
            padded = ReflectPad(padded, ContentRate);

            progress.SetStatus("Loading ONNX Runtime...");
            progress.Refresh();

            using var sessionOptions = new SessionOptions();
            sessionOptions.GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL;
            sessionOptions.IntraOpNumThreads = Math.Max(1, Environment.ProcessorCount);
            sessionOptions.InterOpNumThreads = 1;

            using var contentSession = new InferenceSession(contentPath, sessionOptions);
            using var voiceSession = new InferenceSession(voicePath, sessionOptions);

            progress.SetStatus("Running ContentVec...");
            progress.Refresh();

            float[] features = ExtractContent(contentSession, padded);
            int featureFrames = features.Length / FeatureDim;

            if (featureFrames < 2)
                throw new InvalidOperationException("ContentVec returned too few frames.");

            int frameCount = featureFrames * 2;

            progress.SetStatus("Estimating pitch...");
            progress.Refresh();

            float[] f0 = EstimateF0(padded, frameCount);
            BuildPitch(f0, out long[] coarse, out float[] fine);

            progress.SetStatus("Running RVC voice model...");
            progress.Refresh();

            float[] converted = RunRvc(
                voiceSession,
                features,
                coarse,
                fine);

            if (converted.Length == 0)
                throw new InvalidOperationException("The RVC ONNX model returned no audio.");

            progress.SetStatus("Writing converted WAV...");
            progress.Refresh();

            // GuraTalkV2 is used here as a 48 kHz target model.
            float[] outputSamples = converted;
            if (TargetRate != input.SampleRate)
                outputSamples = Resample(outputSamples, TargetRate, input.SampleRate);

            Wav.Write(outputPath, input.SampleRate, outputSamples);

            progress.Close();
            MessageBox.Show(
                "Voice conversion complete.\n\nSaved to:\n" + outputPath,
                "VoiceChanger", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                ex.Message + "\n\n" + ex.StackTrace,
                "VoiceChanger error",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static float[] ExtractContent(InferenceSession session, float[] audio)
    {
        string inputName = session.InputMetadata.Keys.First();
        var shape = session.InputMetadata[inputName].Dimensions.ToArray();

        int[] dims = shape.Length switch
        {
            2 => new[] { 1, audio.Length },
            3 => new[] { 1, 1, audio.Length },
            _ => throw new InvalidOperationException(
                "Unsupported ContentVec input rank: " + shape.Length)
        };

        var tensor = new DenseTensor<float>(audio, dims);
        using var results = session.Run(new[]
        {
            NamedOnnxValue.CreateFromTensor(inputName, tensor)
        });

        var output = results.First().AsTensor<float>();
        var od = output.Dimensions.ToArray();
        float[] data = output.ToArray();

        if (od.Length != 3)
            throw new InvalidOperationException("ContentVec output is not rank 3.");

        if (od[2] == FeatureDim)
        {
            return data;
        }

        if (od[1] == FeatureDim)
        {
            int frames = od[2];
            float[] transposed = new float[frames * FeatureDim];

            for (int t = 0; t < frames; t++)
            {
                for (int d = 0; d < FeatureDim; d++)
                    transposed[t * FeatureDim + d] = data[d * frames + t];
            }

            return transposed;
        }

        throw new InvalidOperationException(
            "ContentVec output does not contain 768-D features.");
    }

    private static float[] RunRvc(
        InferenceSession session,
        float[] features,
        long[] coarse,
        float[] fine)
    {
        if (features.Length < FeatureDim)
            throw new InvalidOperationException("Content feature buffer is empty.");

        int sourceFrames = features.Length / FeatureDim;
        int frames = Math.Min(coarse.Length, fine.Length);

        if (frames < 2)
            throw new InvalidOperationException("Not enough RVC frames.");

        // RVC ONNX exporters commonly use [1,T,768] for phone.
        // Some older/custom exports use [1,768,T], so support both.
        float[] phoneTcf = new float[frames * FeatureDim];
        for (int t = 0; t < frames; t++)
        {
            int src = Math.Min(t / 2, sourceFrames - 1);
            Array.Copy(features, src * FeatureDim,
                       phoneTcf, t * FeatureDim, FeatureDim);
        }

        float[] phoneCtf = new float[frames * FeatureDim];
        for (int t = 0; t < frames; t++)
            for (int d = 0; d < FeatureDim; d++)
                phoneCtf[d * frames + t] = phoneTcf[t * FeatureDim + d];

        float[] noiseT = new float[NoiseChannels * frames];
        float[] noiseC = new float[NoiseChannels * frames];

        uint state = 0x12345678;
        for (int i = 0; i < noiseT.Length; i++)
            noiseT[i] = NextGaussian(ref state);

        for (int t = 0; t < frames; t++)
            for (int c = 0; c < NoiseChannels; c++)
                noiseC[t * NoiseChannels + c] = noiseT[c * frames + t];

        string? phoneName = null;
        string? noiseName = null;

        foreach (string name in session.InputMetadata.Keys)
        {
            string n = name.ToLowerInvariant();
            if (n is "phone" or "features" or "feats")
                phoneName = name;
            else if (n is "rnd" or "noise")
                noiseName = name;
        }

        bool phoneChannelFirst = false;
        if (phoneName != null)
        {
            var d = session.InputMetadata[phoneName].Dimensions.ToArray();
            if (d.Length == 3)
            {
                if (d[1] == FeatureDim && d[2] != FeatureDim)
                    phoneChannelFirst = true;
                else if (d[2] == FeatureDim && d[1] != FeatureDim)
                    phoneChannelFirst = false;
            }
        }

        bool noiseChannelFirst = true;
        if (noiseName != null)
        {
            var d = session.InputMetadata[noiseName].Dimensions.ToArray();
            if (d.Length == 3)
            {
                if (d[1] == NoiseChannels && d[2] != NoiseChannels)
                    noiseChannelFirst = true;
                else if (d[2] == NoiseChannels && d[1] != NoiseChannels)
                    noiseChannelFirst = false;
            }
        }

        Exception? firstError = null;
        var attempts = new[]
        {
            (PhoneChannelFirst: phoneChannelFirst, NoiseChannelFirst: noiseChannelFirst),
            (PhoneChannelFirst: !phoneChannelFirst, NoiseChannelFirst: noiseChannelFirst),
            (PhoneChannelFirst: phoneChannelFirst, NoiseChannelFirst: !noiseChannelFirst),
            (PhoneChannelFirst: !phoneChannelFirst, NoiseChannelFirst: !noiseChannelFirst)
        };

        var seen = new HashSet<string>();

        foreach (var attempt in attempts)
        {
            string attemptKey = attempt.PhoneChannelFirst + "/" + attempt.NoiseChannelFirst;
            if (!seen.Add(attemptKey))
                continue;

            try
            {
                var inputs = new List<NamedOnnxValue>();

                foreach (string name in session.InputMetadata.Keys)
                {
                    string n = name.ToLowerInvariant();

                    if (n is "phone" or "features" or "feats")
                    {
                        int[] shape = attempt.PhoneChannelFirst
                            ? new[] { 1, FeatureDim, frames }
                            : new[] { 1, frames, FeatureDim };

                        inputs.Add(NamedOnnxValue.CreateFromTensor(
                            name,
                            new DenseTensor<float>(
                                attempt.PhoneChannelFirst ? phoneCtf : phoneTcf,
                                shape)));
                    }
                    else if (n is "phone_lengths" or "lengths")
                    {
                        inputs.Add(NamedOnnxValue.CreateFromTensor(
                            name,
                            new DenseTensor<long>(
                                new[] { (long)frames }, new[] { 1 })));
                    }
                    else if (n is "pitch" or "coarse")
                    {
                        inputs.Add(NamedOnnxValue.CreateFromTensor(
                            name,
                            new DenseTensor<long>(
                                coarse.Take(frames).ToArray(),
                                new[] { 1, frames })));
                    }
                    else if (n is "pitchf" or "nsff0" or "f0")
                    {
                        inputs.Add(NamedOnnxValue.CreateFromTensor(
                            name,
                            new DenseTensor<float>(
                                fine.Take(frames).ToArray(),
                                new[] { 1, frames })));
                    }
                    else if (n is "sid" or "ds" or "speaker")
                    {
                        inputs.Add(NamedOnnxValue.CreateFromTensor(
                            name,
                            new DenseTensor<long>(new[] { 0L }, new[] { 1 })));
                    }
                    else if (n is "rnd" or "noise")
                    {
                        inputs.Add(NamedOnnxValue.CreateFromTensor(
                            name,
                            new DenseTensor<float>(
                                attempt.NoiseChannelFirst ? noiseT : noiseC,
                                attempt.NoiseChannelFirst
                                    ? new[] { 1, NoiseChannels, frames }
                                    : new[] { 1, frames, NoiseChannels })));
                    }
                    else
                    {
                        throw new InvalidOperationException(
                            "Unsupported RVC ONNX input: " + name);
                    }
                }

                using var results = session.Run(inputs);
                return results.First().AsTensor<float>().ToArray();
            }
            catch (Exception ex)
            {
                firstError ??= ex;
            }
        }

        throw new InvalidOperationException(
            "GuraTalkV2.onnx rejected every supported RVC tensor layout." +
            "\n\nThe local model may be stale/corrupt or may not be a standard " +
            "RVC synthesizer export." +
            "\n\nFirst ONNX error:\n" + firstError?.Message);
    }

    private static void BuildPitch(
        float[] f0,
        out long[] coarse,
        out float[] fine)
    {
        const float minHz = 50f;
        const float maxHz = 1100f;

        float melMin = 1127f * MathF.Log(1f + minHz / 700f);
        float melMax = 1127f * MathF.Log(1f + maxHz / 700f);

        coarse = new long[f0.Length];
        fine = new float[f0.Length];

        float last = 100f;

        for (int i = 0; i < f0.Length; i++)
        {
            if (f0[i] > 0f)
                last = f0[i];

            float hz = Math.Clamp(last, minHz, maxHz);
            fine[i] = hz;

            float mel = 1127f * MathF.Log(1f + hz / 700f);
            int q = (int)MathF.Round(
                (mel - melMin) * 254f / (melMax - melMin) + 1f);

            coarse[i] = Math.Clamp(q, 1, 255);
        }
    }

    private static float[] EstimateF0(float[] audio, int frameCount)
    {
        const int hop = 160;
        const int window = 1024;
        const int minLag = 8;
        const int maxLag = 500;

        float[] result = new float[frameCount];

        for (int frame = 0; frame < frameCount; frame++)
        {
            int center = frame * hop;
            double energy = 0.0;

            for (int n = 0; n < window; n++)
            {
                int index = center + n - window / 2;
                if ((uint)index >= (uint)audio.Length)
                    continue;

                double v = audio[index];
                energy += v * v;
            }

            if (energy < 1e-5)
                continue;

            double best = 0.0;
            int bestLag = 0;

            for (int lag = minLag; lag <= maxLag; lag++)
            {
                double corr = 0.0;
                double e1 = 1e-8;
                double e2 = 1e-8;

                for (int n = 0; n < window - lag; n += 2)
                {
                    int a = center + n - window / 2;
                    int b = a + lag;

                    if ((uint)a >= (uint)audio.Length ||
                        (uint)b >= (uint)audio.Length)
                        continue;

                    double x = audio[a];
                    double y = audio[b];

                    corr += x * y;
                    e1 += x * x;
                    e2 += y * y;
                }

                double normalized = corr / Math.Sqrt(e1 * e2);

                if (normalized > best)
                {
                    best = normalized;
                    bestLag = lag;
                }
            }

            if (bestLag > 0 && best > 0.35)
                result[frame] = 16000f / bestLag;
        }

        int last = -1;

        for (int i = 0; i < result.Length; i++)
        {
            if (result[i] <= 0f)
                continue;

            if (last >= 0 && i - last <= 6)
            {
                for (int j = last + 1; j < i; j++)
                {
                    float t = (j - last) / (float)(i - last);
                    result[j] = result[last] +
                                (result[i] - result[last]) * t;
                }
            }

            last = i;
        }

        return result;
    }

    private static float NextGaussian(ref uint state)
    {
        state = 1664525u * state + 1013904223u;
        double u1 = ((state >> 1) + 1.0) / 2147483649.0;

        state = 1664525u * state + 1013904223u;
        double u2 = ((state >> 1) + 1.0) / 2147483649.0;

        return (float)(
            Math.Sqrt(-2.0 * Math.Log(u1)) *
            Math.Cos(2.0 * Math.PI * u2));
    }

    private static float[] ReflectPad(float[] input, int pad)
    {
        if (input.Length == 0)
            return new float[pad * 2];

        float[] output = new float[input.Length + pad * 2];

        for (int i = 0; i < output.Length; i++)
        {
            int q = i - pad;

            while (q < 0 || q >= input.Length)
            {
                if (input.Length <= 1)
                {
                    q = 0;
                    break;
                }

                if (q < 0)
                    q = -q;
                else
                    q = 2 * input.Length - 2 - q;
            }

            output[i] = input[q];
        }

        return output;
    }

    private static float[] Resample(float[] input, int fromRate, int toRate)
    {
        if (input.Length == 0 || fromRate == toRate)
            return input;

        int outputLength = Math.Max(
            1,
            (int)Math.Round(input.Length * (double)toRate / fromRate));

        float[] output = new float[outputLength];
        double scale = (double)fromRate / toRate;

        for (int i = 0; i < output.Length; i++)
        {
            double pos = i * scale;
            int left = (int)Math.Floor(pos);
            double t = pos - left;

            if (left >= input.Length - 1)
                output[i] = input[^1];
            else
                output[i] = (float)(
                    input[left] * (1.0 - t) +
                    input[left + 1] * t);
        }

        return output;
    }

    private sealed class ProgressForm : Form
    {
        private readonly Label _label;
        private readonly ProgressBar _bar;

        public ProgressForm()
        {
            Text = "VoiceChanger";
            Width = 430;
            Height = 120;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;

            _label = new Label
            {
                AutoSize = false,
                Dock = DockStyle.Top,
                Height = 42,
                TextAlign = ContentAlignment.MiddleCenter,
                Text = "Starting..."
            };

            _bar = new ProgressBar
            {
                Dock = DockStyle.Fill,
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 25
            };

            Controls.Add(_bar);
            Controls.Add(_label);
        }

        public void SetStatus(string text) => _label.Text = text;
    }

    private static class Wav
    {
        public static (int SampleRate, float[] Samples) Read(string path)
        {
            using var br = new BinaryReader(File.OpenRead(path));

            string riff = new string(br.ReadChars(4));
            if (riff != "RIFF")
                throw new InvalidDataException("Not a RIFF WAV file.");

            br.ReadInt32();

            string wave = new string(br.ReadChars(4));
            if (wave != "WAVE")
                throw new InvalidDataException("Not a WAVE file.");

            short format = 0;
            short channels = 0;
            short bits = 0;
            short blockAlign = 0;
            int sampleRate = 0;

            byte[]? data = null;

            while (br.BaseStream.Position + 8 <= br.BaseStream.Length)
            {
                string chunk = new string(br.ReadChars(4));
                uint size = br.ReadUInt32();

                if (chunk == "fmt ")
                {
                    format = br.ReadInt16();
                    channels = br.ReadInt16();
                    sampleRate = br.ReadInt32();
                    br.ReadInt32();
                    blockAlign = br.ReadInt16();
                    bits = br.ReadInt16();

                    if (size > 16)
                        br.ReadBytes((int)size - 16);
                }
                else if (chunk == "data")
                {
                    data = br.ReadBytes((int)size);
                }
                else
                {
                    br.BaseStream.Seek(size, SeekOrigin.Current);
                }

                if ((size & 1) != 0)
                    br.BaseStream.Seek(1, SeekOrigin.Current);
            }

            if (data == null || data.Length == 0)
                throw new InvalidDataException("WAV data chunk is missing.");

            if (channels < 1)
                throw new InvalidDataException("WAV has no audio channels.");

            if (sampleRate < 8000 || sampleRate > 192000)
                throw new InvalidDataException("Unsupported WAV sample rate.");

            int bytesPerSample = bits / 8;
            if (bytesPerSample < 2 || bytesPerSample > 4)
                throw new InvalidDataException("Use PCM16/24/32 or float32 WAV.");

            int frames = data.Length / blockAlign;
            float[] mono = new float[frames];

            using var ms = new MemoryStream(data);
            using var d = new BinaryReader(ms);

            for (int i = 0; i < frames; i++)
            {
                double sum = 0;

                for (int c = 0; c < channels; c++)
                {
                    float value;

                    if (format == 1 && bits == 16)
                    {
                        value = d.ReadInt16() / 32768f;
                    }
                    else if (format == 1 && bits == 24)
                    {
                        int b0 = d.ReadByte();
                        int b1 = d.ReadByte();
                        int b2 = d.ReadByte();
                        int sample = b0 | (b1 << 8) | (b2 << 16);
                        if ((sample & 0x800000) != 0)
                            sample |= unchecked((int)0xFF000000);
                        value = sample / 8388608f;
                    }
                    else if (format == 1 && bits == 32)
                    {
                        value = d.ReadInt32() / 2147483648f;
                    }
                    else if (format == 3 && bits == 32)
                    {
                        value = d.ReadSingle();
                    }
                    else
                    {
                        throw new InvalidDataException(
                            "Use PCM16/24/32 or float32 WAV.");
                    }

                    sum += float.IsFinite(value) ? value : 0;
                }

                mono[i] = (float)(sum / channels);
            }

            return (sampleRate, mono);
        }

        public static void Write(string path, int sampleRate, float[] samples)
        {
            using var bw = new BinaryWriter(File.Create(path));

            int dataBytes = samples.Length * 2;

            bw.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
            bw.Write(36 + dataBytes);
            bw.Write(System.Text.Encoding.ASCII.GetBytes("WAVE"));

            bw.Write(System.Text.Encoding.ASCII.GetBytes("fmt "));
            bw.Write(16);
            bw.Write((short)1);
            bw.Write((short)1);
            bw.Write(sampleRate);
            bw.Write(sampleRate * 2);
            bw.Write((short)2);
            bw.Write((short)16);

            bw.Write(System.Text.Encoding.ASCII.GetBytes("data"));
            bw.Write(dataBytes);

            foreach (float value in samples)
            {
                float v = Math.Clamp(value, -1f, 1f);
                bw.Write((short)Math.Round(v * 32767f));
            }
        }
    }
}
