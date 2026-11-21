using System.Diagnostics;
using System.Globalization;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Speech.Recognition;
using NAudio.Wave;

namespace PocketEcho;

public sealed class MainForm : Form
{
    private readonly TextBox referencePath = new() { ReadOnly = true, Dock = DockStyle.Fill, PlaceholderText = "Choose a WAV, MP3, FLAC, OGG, or M4A voice sample…" };
    private readonly TextBox referenceTranscript = new() { Dock = DockStyle.Fill, PlaceholderText = "Type the exact words spoken in your reference recording…" };
    private readonly ProgressBar setupProgress = new() { Dock = DockStyle.Fill, Style = ProgressBarStyle.Continuous, Minimum = 0, Maximum = 100, Value = 0 };
    private readonly ComboBox outputDevices = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
    private readonly Button chooseButton = new() { Text = "Choose voice sample…", AutoSize = true };
    private readonly Button prepareButton = new() { Text = "Prepare cloned voice", AutoSize = true, Enabled = false };
    private readonly Button startButton = new() { Text = "Start listening", AutoSize = true, Enabled = false };
    private readonly Button stopButton = new() { Text = "Stop", AutoSize = true, Enabled = false };
    private readonly Label statusLabel = new() { Text = "Choose a reference recording to begin.", AutoSize = true, ForeColor = Color.FromArgb(190, 185, 210) };
    private readonly TextBox transcript = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, BackColor = Color.FromArgb(29, 26, 43), ForeColor = Color.White, BorderStyle = BorderStyle.FixedSingle };
    private SpeechRecognitionEngine? recognizer;
    private string? selectedReference;
    private string? preparedVoice;
    private string? pendingPhrase;
    private bool listening;
    private bool preparing;
    private int outputDevice;
    private readonly string sevenZipExe = Path.Combine(AppContext.BaseDirectory, "7zr.exe");
    private readonly string ffmpegExe = Path.Combine(AppContext.BaseDirectory, "ffmpeg.exe");
    private readonly string workDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PocketEcho");
    private readonly string engineDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PocketEcho", "GPT-SoVITS");
    private readonly HttpClient http = new() { Timeout = Timeout.InfiniteTimeSpan };
    private Process? pocketServer;
    private readonly StringBuilder serverLog = new();
    private const string ServerUrl = "http://127.0.0.1:9880";

    public MainForm()
    {
        Text = "Pocket Echo · Live Voice Clone";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(690, 570);
        Size = new Size(820, 690);
        BackColor = Color.FromArgb(19, 17, 30);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10F);
        BuildLayout();
        LoadOutputDevices();
        chooseButton.Click += ChooseReference;
        prepareButton.Click += async (_, _) => await PrepareVoiceAsync();
        startButton.Click += StartListening;
        stopButton.Click += StopListening;
        outputDevices.SelectedIndexChanged += (_, _) =>
        {
            if (outputDevices.SelectedItem is OutputChoice choice) outputDevice = choice.Index;
        };
        FormClosing += (_, _) =>
        {
            listening = false;
            try { recognizer?.Dispose(); } catch { }
            try { if (pocketServer is { HasExited: false }) pocketServer.Kill(true); } catch { }
            pocketServer?.Dispose();
            http.Dispose();
        };
        Directory.CreateDirectory(workDir);
    }

    private void BuildLayout()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 10 };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        Controls.Add(root);

        var heading = new Label { Text = "♫  POCKET ECHO", Font = new Font("Segoe UI Semibold", 22F), ForeColor = Color.FromArgb(244, 151, 211), Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
        root.Controls.Add(heading, 0, 0);
        root.Controls.Add(new Label { Text = "Reference voice", ForeColor = Color.Gainsboro, Dock = DockStyle.Fill, TextAlign = ContentAlignment.BottomLeft }, 0, 1);

        var fileRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        fileRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        fileRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        fileRow.Controls.Add(referencePath, 0, 0);
        fileRow.Controls.Add(chooseButton, 1, 0);
        root.Controls.Add(fileRow, 0, 2);
        root.Controls.Add(new Label { Text = "Reference transcript (required for accurate cloning)", ForeColor = Color.Gainsboro, Dock = DockStyle.Fill, TextAlign = ContentAlignment.BottomLeft }, 0, 3);
        root.Controls.Add(referenceTranscript, 0, 4);

        var outputRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        outputRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 145));
        outputRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        outputRow.Controls.Add(new Label { Text = "Audio output", ForeColor = Color.Gainsboro, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 0);
        outputRow.Controls.Add(outputDevices, 1, 0);
        root.Controls.Add(outputRow, 0, 5);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight };
        StyleButton(prepareButton, Color.FromArgb(111, 83, 153));
        StyleButton(startButton, Color.FromArgb(223, 125, 190));
        StyleButton(stopButton, Color.FromArgb(65, 60, 82));
        buttons.Controls.Add(prepareButton);
        buttons.Controls.Add(startButton);
        buttons.Controls.Add(stopButton);
        root.Controls.Add(buttons, 0, 6);
        root.Controls.Add(setupProgress, 0, 7);

        var logPanel = new Panel { Dock = DockStyle.Fill };
        var logTitle = new Label { Text = "Recognized speech", ForeColor = Color.Gainsboro, Dock = DockStyle.Top, Height = 28 };
        logPanel.Controls.Add(transcript);
        logPanel.Controls.Add(logTitle);
        root.Controls.Add(logPanel, 0, 8);
        root.Controls.Add(statusLabel, 0, 9);
    }

    private static void StyleButton(Button button, Color color)
    {
        button.BackColor = color;
        button.ForeColor = Color.White;
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 0;
        button.Padding = new Padding(12, 5, 12, 5);
        button.Cursor = Cursors.Hand;
    }

    private void LoadOutputDevices()
    {
        outputDevices.Items.Clear();
        for (int i = 0; i < WaveOut.DeviceCount; i++)
        {
            var caps = WaveOut.GetCapabilities(i);
            outputDevices.Items.Add(new OutputChoice(i, caps.ProductName));
        }
        if (outputDevices.Items.Count > 0) outputDevices.SelectedIndex = 0;
        else outputDevices.Items.Add(new OutputChoice(-1, "Windows default output"));
    }

    private void ChooseReference(object? sender, EventArgs e)
    {
        using var dialog = new OpenFileDialog
        {
            Title = "Choose a voice reference recording",
            Filter = "Audio files|*.wav;*.mp3;*.flac;*.ogg;*.m4a;*.aac;*.wma;*.aiff;*.aif;*.opus;*.webm;*.mp4|All files|*.*",
            CheckFileExists = true
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        selectedReference = dialog.FileName;
        referencePath.Text = selectedReference;
        preparedVoice = null;
        prepareButton.Enabled = true;
        startButton.Enabled = false;
        SetStatus("Reference selected. Prepare the cloned voice once before listening.");
    }

    private async Task PrepareVoiceAsync()
    {
        if (string.IsNullOrWhiteSpace(selectedReference) || preparing) return;
        if (string.IsNullOrWhiteSpace(referenceTranscript.Text))
        {
            MessageBox.Show(this, "Enter the exact words spoken in your reference recording. GPT-SoVITS uses both the audio and its transcript.", "Reference transcript required", MessageBoxButtons.OK, MessageBoxIcon.Information);
            referenceTranscript.Focus();
            return;
        }

        preparing = true;
        prepareButton.Enabled = false;
        chooseButton.Enabled = false;
        setupProgress.Style = ProgressBarStyle.Continuous;
        setupProgress.Value = 0;
        SetStatus("Preparing your local GPT-SoVITS voice engine…");
        try
        {
            if (!File.Exists(ffmpegExe)) throw new FileNotFoundException("ffmpeg.exe is missing from this Pocket Echo package.", ffmpegExe);
            if (!File.Exists(sevenZipExe)) throw new FileNotFoundException("7zr.exe is missing from this Pocket Echo package.", sevenZipExe);

            var normalizedAudio = Path.Combine(workDir, "voice-reference.wav");
            if (File.Exists(normalizedAudio)) File.Delete(normalizedAudio);
            SetStatus("Converting reference audio…");
            await RunFfmpegAsync(selectedReference!, normalizedAudio);
            if (!File.Exists(normalizedAudio) || new FileInfo(normalizedAudio).Length < 4096)
                throw new Exception("The selected recording could not be converted to a usable WAV file.");

            await EnsureGptSoVitsAsync();
            preparedVoice = normalizedAudio;
            await StartGptServerAsync();
            startButton.Enabled = true;
            setupProgress.Value = 100;
            SetStatus("GPT-SoVITS is loaded locally! Start listening when you're ready.");
        }
        catch (Exception ex)
        {
            setupProgress.Style = ProgressBarStyle.Continuous;
            SetStatus("Voice preparation failed. See details.");
            MessageBox.Show(this, ex.ToString(), "Pocket Echo — GPT-SoVITS setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            prepareButton.Enabled = true;
        }
        finally
        {
            preparing = false;
            chooseButton.Enabled = true;
        }
    }

    private async Task EnsureGptSoVitsAsync()
    {
        var apiFile = Directory.Exists(engineDir)
            ? Directory.GetFiles(engineDir, "api_v2.py", SearchOption.AllDirectories).FirstOrDefault()
            : null;
        var pythonFile = apiFile is null ? null : Directory.GetFiles(Path.GetDirectoryName(apiFile)!, "python.exe", SearchOption.AllDirectories).FirstOrDefault();
        if (apiFile is not null && pythonFile is not null) return;

        Directory.CreateDirectory(engineDir);
        var archive = Path.Combine(workDir, "GPT-SoVITS-v2pro-20250604.7z");
        const string packageUrl = "https://www.modelscope.cn/models/FlowerCry/gpt-sovits-7z-pacakges/resolve/master/GPT-SoVITS-v2pro-20250604.7z";
        SetStatus("Downloading GPT-SoVITS package from ModelScope…");
        await DownloadPackageWithProgressAsync(packageUrl, archive);

        setupProgress.Style = ProgressBarStyle.Marquee;
        SetStatus("Extracting the local voice engine (this can take several minutes)…");
        var extract = new ProcessStartInfo(sevenZipExe)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true,
            RedirectStandardError = true, WorkingDirectory = engineDir
        };
        extract.ArgumentList.Add("x");
        extract.ArgumentList.Add(archive);
        extract.ArgumentList.Add("-o" + engineDir);
        extract.ArgumentList.Add("-y");
        using var unzip = new Process { StartInfo = extract };
        unzip.Start();
        var outTask = unzip.StandardOutput.ReadToEndAsync();
        var errTask = unzip.StandardError.ReadToEndAsync();
        await unzip.WaitForExitAsync();
        var extractionLog = (await outTask) + Environment.NewLine + (await errTask);
        if (unzip.ExitCode != 0) throw new Exception("GPT-SoVITS extraction failed: " + extractionLog);
        try { File.Delete(archive); } catch { }

        apiFile = Directory.GetFiles(engineDir, "api_v2.py", SearchOption.AllDirectories).FirstOrDefault();
        if (apiFile is null) throw new FileNotFoundException("The downloaded package did not contain api_v2.py.");
        pythonFile = Directory.GetFiles(Path.GetDirectoryName(apiFile)!, "python.exe", SearchOption.AllDirectories).FirstOrDefault();
        if (pythonFile is null) throw new FileNotFoundException("The GPT-SoVITS package did not contain its bundled runtime/python.exe.");
        setupProgress.Style = ProgressBarStyle.Continuous;
        setupProgress.Value = 85;
    }

    private async Task DownloadPackageWithProgressAsync(string url, string destination)
    {
        using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        var total = response.Content.Headers.ContentLength;
        await using var source = await response.Content.ReadAsStreamAsync();
        await using var target = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 128, true);
        var buffer = new byte[1024 * 128];
        long received = 0;
        int count;
        while ((count = await source.ReadAsync(buffer)) > 0)
        {
            await target.WriteAsync(buffer.AsMemory(0, count));
            received += count;
            if (total is > 0)
            {
                var percent = (int)Math.Clamp(received * 100d / total.Value, 0, 100);
                if (!IsDisposed) BeginInvoke(new Action(() =>
                {
                    setupProgress.Style = ProgressBarStyle.Continuous;
                    setupProgress.Value = percent;
                    SetStatus($"Downloading GPT-SoVITS: {received / 1048576d:0} MB / {total.Value / 1048576d:0} MB ({percent}%)");
                }));
            }
            else if (!IsDisposed) BeginInvoke(new Action(() => SetStatus($"Downloading GPT-SoVITS: {received / 1048576d:0} MB")));
        }
    }

    private async Task StartGptServerAsync()
    {
        try { if (pocketServer is { HasExited: false }) pocketServer.Kill(true); } catch { }
        pocketServer?.Dispose();
        pocketServer = null;
        lock (serverLog) serverLog.Clear();

        var apiFile = Directory.GetFiles(engineDir, "api_v2.py", SearchOption.AllDirectories).FirstOrDefault()
            ?? throw new FileNotFoundException("GPT-SoVITS api_v2.py is missing.");
        var root = Path.GetDirectoryName(apiFile)!;
        var python = Directory.GetFiles(root, "python.exe", SearchOption.AllDirectories).FirstOrDefault()
            ?? throw new FileNotFoundException("Bundled GPT-SoVITS python.exe is missing.");
        var psi = new ProcessStartInfo(python)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true,
            RedirectStandardError = true, WorkingDirectory = root
        };
        psi.Environment["PYTHONIOENCODING"] = "utf-8";
        psi.ArgumentList.Add(apiFile);
        psi.ArgumentList.Add("-a"); psi.ArgumentList.Add("127.0.0.1");
        psi.ArgumentList.Add("-p"); psi.ArgumentList.Add("9880");

        pocketServer = new Process { StartInfo = psi, EnableRaisingEvents = true };
        pocketServer.OutputDataReceived += (_, e) => { if (e.Data is not null) { lock (serverLog) serverLog.AppendLine(e.Data); if (e.Data.Contains("Loading", StringComparison.OrdinalIgnoreCase)) SetStatus("Loading GPT-SoVITS model weights into GPU memory…"); } };
        pocketServer.ErrorDataReceived += (_, e) => { if (e.Data is not null) lock (serverLog) serverLog.AppendLine(e.Data); };
        pocketServer.Start();
        pocketServer.BeginOutputReadLine();
        pocketServer.BeginErrorReadLine();

        setupProgress.Style = ProgressBarStyle.Marquee;
        SetStatus("Starting GPT-SoVITS and loading model weights…");
        for (var i = 0; i < 600; i++)
        {
            if (pocketServer.HasExited)
            {
                string log; lock (serverLog) log = serverLog.ToString();
                throw new Exception("GPT-SoVITS stopped during startup. " + log);
            }
            try
            {
                using var response = await http.GetAsync(ServerUrl + "/docs");
                if (response.IsSuccessStatusCode) { setupProgress.Style = ProgressBarStyle.Continuous; setupProgress.Value = 100; return; }
            }
            catch { }
            await Task.Delay(1000);
        }
        string lastLog; lock (serverLog) lastLog = serverLog.ToString();
        throw new TimeoutException("GPT-SoVITS did not finish loading within ten minutes. " + lastLog);
    }

    private void StartListening(object? sender, EventArgs e)
    {
        if (string.IsNullOrWhiteSpace(preparedVoice) || !File.Exists(preparedVoice)) return;
        if (pocketServer is null || pocketServer.HasExited)
        {
            SetStatus("GPT-SoVITS server is not running. Prepare the cloned voice again.");
            startButton.Enabled = true;
            return;
        }
        try
        {
            recognizer?.Dispose();
            recognizer = new SpeechRecognitionEngine(new CultureInfo("en-US"));
            recognizer.LoadGrammar(new DictationGrammar());
            recognizer.EndSilenceTimeout = TimeSpan.FromMilliseconds(420);
            recognizer.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(650);
            recognizer.BabbleTimeout = TimeSpan.FromSeconds(3);
            recognizer.SetInputToDefaultAudioDevice();
            recognizer.SpeechRecognized += OnSpeechRecognized;
            recognizer.RecognizeCompleted += OnRecognizeCompleted;
            listening = true;
            startButton.Enabled = false;
            stopButton.Enabled = true;
            SetStatus("Listening on your Windows default microphone… speak naturally.");
            recognizer.RecognizeAsync(RecognizeMode.Multiple);
        }
        catch (Exception ex)
        {
            listening = false;
            startButton.Enabled = true;
            stopButton.Enabled = false;
            SetStatus("Speech recognition couldn't start: " + ex.Message + " Check that Windows has an English speech recognizer installed.");
        }
    }

    private void OnSpeechRecognized(object? sender, SpeechRecognizedEventArgs e)
    {
        if (!listening || e.Result.Confidence < 0.52 || string.IsNullOrWhiteSpace(e.Result.Text)) return;
        if (pendingPhrase is not null) return;
        pendingPhrase = e.Result.Text.Trim();
        try { recognizer?.RecognizeAsyncCancel(); } catch { }
    }

    private void OnRecognizeCompleted(object? sender, RecognizeCompletedEventArgs e)
    {
        var phrase = pendingPhrase;
        pendingPhrase = null;
        if (!listening || string.IsNullOrWhiteSpace(phrase)) return;
        _ = Task.Run(async () =>
        {
            try
            {
                BeginInvoke(new Action(() => AppendTranscript("You: " + phrase)));
                var wav = Path.Combine(workDir, "speech-" + Guid.NewGuid().ToString("N") + ".wav");
                await GenerateAudioAsync(phrase, wav);
                if (File.Exists(wav))
                {
                    await PlayAudioAsync(wav);
                    try { File.Delete(wav); } catch { }
                }
            }
            catch (Exception ex)
            {
                BeginInvoke(new Action(() => SetStatus("Speech generation error: " + ex.Message)));
            }
            finally
            {
                if (listening && !IsDisposed)
                {
                    try
                    {
                        BeginInvoke(new Action(() =>
                        {
                            if (!listening || recognizer is null) return;
                            try { recognizer.RecognizeAsync(RecognizeMode.Multiple); }
                            catch (Exception ex) { SetStatus("Couldn't resume listening: " + ex.Message); }
                        }));
                    }
                    catch { }
                }
            }
        });
    }


    private async Task GenerateAudioAsync(string phrase, string outputPath)
    {
        var request = new
        {
            text = phrase,
            text_lang = "en",
            ref_audio_path = preparedVoice,
            prompt_text = referenceTranscript.Text.Trim(),
            prompt_lang = "en",
            text_split_method = "cut5",
            batch_size = 1,
            media_type = "wav",
            streaming_mode = false
        };
        using var content = new StringContent(JsonSerializer.Serialize(request), Encoding.UTF8, "application/json");
        using var response = await http.PostAsync(ServerUrl + "/tts", content);
        if (!response.IsSuccessStatusCode)
        {
            var detail = await response.Content.ReadAsStringAsync();
            throw new Exception("GPT-SoVITS returned HTTP " + (int)response.StatusCode + ": " + detail);
        }
        await using var input = await response.Content.ReadAsStreamAsync();
        await using var output = File.Create(outputPath);
        await input.CopyToAsync(output);
    }

    private async Task RunFfmpegAsync(string inputPath, string outputPath)
    {
        var psi = new ProcessStartInfo(ffmpegExe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = AppContext.BaseDirectory
        };
        foreach (var arg in new[] { "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-t", "30", "-vn", "-ac", "1", "-ar", "24000", "-sample_fmt", "s16", outputPath })
            psi.ArgumentList.Add(arg);

        using var process = new Process { StartInfo = psi };
        process.Start();
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        var error = await stderr;
        _ = await stdout;
        if (process.ExitCode != 0)
            throw new Exception("Audio conversion failed. " + (string.IsNullOrWhiteSpace(error) ? "The file may be damaged or use an unsupported codec." : error.Trim()));
    }

    private async Task PlayAudioAsync(string path)
    {
        using var reader = new AudioFileReader(path);
        using var player = new WaveOutEvent { DeviceNumber = outputDevice, DesiredLatency = 100 };
        var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        player.PlaybackStopped += (_, e) =>
        {
            if (e.Exception is not null) done.TrySetException(e.Exception);
            else done.TrySetResult(true);
        };
        player.Init(reader);
        player.Play();
        await done.Task;
    }

    private void StopListening(object? sender, EventArgs e)
    {
        listening = false;
        pendingPhrase = null;
        try { recognizer?.RecognizeAsyncCancel(); } catch { }
        startButton.Enabled = preparedVoice is not null;
        stopButton.Enabled = false;
        SetStatus("Stopped.");
    }

    private void AppendTranscript(string line)
    {
        if (IsDisposed) return;
        transcript.AppendText(line + Environment.NewLine);
        transcript.SelectionStart = transcript.TextLength;
        transcript.ScrollToCaret();
    }

    private void SetStatus(string message)
    {
        if (IsDisposed) return;
        if (InvokeRequired) { try { BeginInvoke(new Action(() => SetStatus(message))); } catch { } return; }
        statusLabel.Text = message;
    }

    private sealed record OutputChoice(int Index, string Name)
    {
        public override string ToString() => Name;
    }
}
