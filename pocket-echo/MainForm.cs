using System.Diagnostics;
using System.Globalization;
using System.Speech.Recognition;
using NAudio.Wave;

namespace PocketEcho;

public sealed class MainForm : Form
{
    private readonly TextBox referencePath = new() { ReadOnly = true, Dock = DockStyle.Fill, PlaceholderText = "Choose a WAV, MP3, FLAC, OGG, or M4A voice sample…" };
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
    private readonly string pocketExe = Path.Combine(AppContext.BaseDirectory, "pocket-tts.exe");
    private readonly string workDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PocketEcho");

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
        FormClosing += (_, _) => { listening = false; try { recognizer?.Dispose(); } catch { } };
        Directory.CreateDirectory(workDir);
    }

    private void BuildLayout()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 7 };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 70));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 45));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
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

        var outputRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        outputRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 145));
        outputRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        outputRow.Controls.Add(new Label { Text = "Audio output", ForeColor = Color.Gainsboro, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 0);
        outputRow.Controls.Add(outputDevices, 1, 0);
        root.Controls.Add(outputRow, 0, 3);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight };
        StyleButton(prepareButton, Color.FromArgb(111, 83, 153));
        StyleButton(startButton, Color.FromArgb(223, 125, 190));
        StyleButton(stopButton, Color.FromArgb(65, 60, 82));
        buttons.Controls.Add(prepareButton);
        buttons.Controls.Add(startButton);
        buttons.Controls.Add(stopButton);
        root.Controls.Add(buttons, 0, 4);

        var logPanel = new Panel { Dock = DockStyle.Fill };
        var logTitle = new Label { Text = "Recognized speech", ForeColor = Color.Gainsboro, Dock = DockStyle.Top, Height = 28 };
        logPanel.Controls.Add(transcript);
        logPanel.Controls.Add(logTitle);
        root.Controls.Add(logPanel, 0, 5);
        root.Controls.Add(statusLabel, 0, 6);
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
            Filter = "Supported audio|*.wav;*.mp3;*.flac;*.ogg;*.m4a|All files|*.*",
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
        if (!File.Exists(pocketExe))
        {
            SetStatus("Pocket TTS engine is missing. Download the Pocket Echo release package.");
            return;
        }
        preparing = true;
        prepareButton.Enabled = false;
        chooseButton.Enabled = false;
        SetStatus("Cloning voice reference… this can take a little while.");
        try
        {
            var output = Path.Combine(workDir, "reference-voice.safetensors");
            if (File.Exists(output)) File.Delete(output);
            await RunPocketAsync("export-voice", selectedReference!, output);
            if (!File.Exists(output)) throw new Exception("Pocket TTS did not create the voice profile.");
            preparedVoice = output;
            startButton.Enabled = true;
            SetStatus("Voice is ready! Start listening when you're ready.");
        }
        catch (Exception ex)
        {
            SetStatus("Voice preparation failed: " + ex.Message);
            prepareButton.Enabled = true;
        }
        finally
        {
            preparing = false;
            chooseButton.Enabled = true;
        }
    }

    private void StartListening(object? sender, EventArgs e)
    {
        if (string.IsNullOrWhiteSpace(preparedVoice) || !File.Exists(preparedVoice)) return;
        if (!File.Exists(pocketExe))
        {
            SetStatus("Pocket TTS engine is missing from the app folder.");
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
                BeginInvoke(() => AppendTranscript("You: " + phrase));
                var wav = Path.Combine(workDir, "speech-" + Guid.NewGuid().ToString("N") + ".wav");
                await RunPocketAsync("generate", "--text", phrase, "--voice", preparedVoice!, "--output-path", wav, "--quiet");
                if (File.Exists(wav))
                {
                    await PlayAudioAsync(wav);
                    try { File.Delete(wav); } catch { }
                }
            }
            catch (Exception ex)
            {
                BeginInvoke(() => SetStatus("Speech generation error: " + ex.Message));
            }
            finally
            {
                if (listening && !IsDisposed)
                {
                    try
                    {
                        BeginInvoke(() =>
                        {
                            if (!listening || recognizer is null) return;
                            try { recognizer.RecognizeAsync(RecognizeMode.Multiple); }
                            catch (Exception ex) { SetStatus("Couldn't resume listening: " + ex.Message); }
                        });
                    }
                    catch { }
                }
            }
        });
    }

    private async Task RunPocketAsync(params string[] args)
    {
        var psi = new ProcessStartInfo(pocketExe) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = AppContext.BaseDirectory };
        foreach (var arg in args) psi.ArgumentList.Add(arg);
        using var process = new Process { StartInfo = psi };
        process.Start();
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        var error = await stderr;
        _ = await stdout;
        if (process.ExitCode != 0) throw new Exception(string.IsNullOrWhiteSpace(error) ? "Pocket TTS exited with code " + process.ExitCode : error.Trim());
    }

    private async Task PlayAudioAsync(string path)
    {
        using var reader = new AudioFileReader(path);
        using var player = new WaveOutEvent { DeviceNumber = outputDevice, DesiredLatency = 100 };
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        player.PlaybackStopped += (_, e) =>
        {
            if (e.Exception is not null) done.TrySetException(e.Exception);
            else done.TrySetResult();
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
        if (InvokeRequired) { try { BeginInvoke(() => SetStatus(message)); } catch { } return; }
        statusLabel.Text = message;
    }

    private sealed record OutputChoice(int Index, string Name)
    {
        public override string ToString() => Name;
    }
}
