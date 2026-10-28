using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

ApplicationConfiguration.Initialize();
Application.Run(new ReaderForm());

sealed class ReaderForm : Form
{
    private readonly TextBox apiKey = new() { UseSystemPasswordChar = true, PlaceholderText = "Paste OpenRouter API key (sk-or-…)", Dock = DockStyle.Top };
    private readonly TextBox textBox = new() { Multiline = true, ScrollBars = ScrollBars.Vertical, AcceptsReturn = true, AcceptsTab = true, PlaceholderText = "Click here, then use Windows voice typing (Win+H) to dictate…", Font = new System.Drawing.Font("Segoe UI", 11), Dock = DockStyle.Fill };
    private readonly ComboBox model = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 300 };
    private readonly ComboBox voice = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 220 };
    private readonly Button dictateButton = new() { Text = "Prepare Dictation", AutoSize = true };
    private readonly Button pasteButton = new() { Text = "Paste Text", AutoSize = true };
    private readonly Button generateButton = new() { Text = "Generate & Play", AutoSize = true };
    private readonly Button clearButton = new() { Text = "Clear Text", AutoSize = true };
    private readonly Label status = new() { Text = "Click Start Dictation, then press Win+H to speak into the text box. Click Generate & Play to read it aloud.", AutoSize = true, MaximumSize = new System.Drawing.Size(780, 0) };
    private static readonly HttpClient client = new() { Timeout = TimeSpan.FromMinutes(3) };
    private static readonly Dictionary<string, (string Id, string Label)[]> Voices = new()
    {
        ["x-ai/grok-voice-tts-1.0"] = new[] { ("eve", "Eve — feminine"), ("ara", "Ara"), ("rex", "Rex"), ("sal", "Sal"), ("leo", "Leo") },
        ["mistralai/voxtral-mini-tts-2603"] = new[] { ("en_paul_neutral", "Paul — neutral English") },
        ["microsoft/mai-voice-2"] = new[] { ("en-US-Harper:MAI-Voice-2", "Harper — US English") }
    };

    public ReaderForm()
    {
        Text = "OpenRouter TTS Reader";
        Width = 880; Height = 700; MinimumSize = new System.Drawing.Size(650, 500);
        StartPosition = FormStartPosition.CenterScreen;
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1, RowCount = 6 };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize)); root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize)); root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        Controls.Add(root);
        root.Controls.Add(new Label { Text = "OpenRouter API key (kept in memory only)", AutoSize = true }, 0, 0);
        root.Controls.Add(apiKey, 0, 1);
        var options = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, WrapContents = true, Padding = new Padding(0, 10, 0, 10) };
        options.Controls.Add(new Label { Text = "Model:", AutoSize = true, Padding = new Padding(0, 7, 0, 0) });
        options.Controls.Add(model); options.Controls.Add(new Label { Text = "Voice:", AutoSize = true, Padding = new Padding(8, 7, 0, 0) }); options.Controls.Add(voice);
        root.Controls.Add(options, 0, 2);
        root.Controls.Add(new Label { Text = "Speech transcript / text to read aloud", AutoSize = true, Padding = new Padding(0, 5, 0, 5) }, 0, 3);
        root.Controls.Add(textBox, 0, 4);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(0, 10, 0, 10) };
        buttons.Controls.Add(dictateButton); buttons.Controls.Add(pasteButton); buttons.Controls.Add(generateButton); buttons.Controls.Add(clearButton);
        root.Controls.Add(buttons, 0, 5);
        root.Controls.Add(status, 0, 6);
        root.RowCount = 7; root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        foreach (var item in Voices.Keys) model.Items.Add(item);
        model.SelectedIndex = 0; UpdateVoices(); model.SelectedIndexChanged += (_, _) => UpdateVoices();
        dictateButton.Click += (_, _) => PrepareDictation();
        pasteButton.Click += (_, _) => PasteClipboard();
        clearButton.Click += (_, _) => textBox.Clear();
        generateButton.Click += async (_, _) => await GenerateAsync();
    }

    private void UpdateVoices()
    {
        voice.Items.Clear();
        foreach (var item in Voices[model.SelectedItem?.ToString() ?? Voices.Keys.First()]) voice.Items.Add(new VoiceItem(item.Id, item.Label));
        voice.DisplayMember = nameof(VoiceItem.Label);
        if (voice.Items.Count > 0) voice.SelectedIndex = 0;
    }

    private void PrepareDictation()
    {
        textBox.Focus();
        textBox.SelectionStart = textBox.TextLength;
        status.Text = "Text box focused. Now press Windows key + H to start Windows Voice Typing; your speech will appear here as text.";
    }

    private void PasteClipboard()
    {
        try
        {
            if (!Clipboard.ContainsText()) { status.Text = "Clipboard has no text to paste."; return; }
            textBox.Text = Clipboard.GetText(); textBox.Focus(); textBox.SelectionStart = textBox.TextLength;
            status.Text = "Pasted text. Click Generate & Play when ready.";
        }
        catch (Exception ex) { status.Text = "Clipboard paste failed: " + ex.Message + " Try Ctrl+V in the text box."; }
    }

    private async Task GenerateAsync()
    {
        var key = apiKey.Text.Trim(); var input = textBox.Text.Trim();
        if (!key.StartsWith("sk-or-", StringComparison.Ordinal) || key.Length < 20) { status.Text = "Paste your OpenRouter API key into the key field first."; apiKey.Focus(); return; }
        if (string.IsNullOrWhiteSpace(input)) { status.Text = "Speak into the text box using Windows voice typing (Win+H), or type/paste text first."; textBox.Focus(); return; }
        if (input.Length > 20000) { status.Text = "Text is too long. Split it into shorter replies (20,000 characters maximum)."; return; }
        generateButton.Enabled = false; pasteButton.Enabled = false; dictateButton.Enabled = false;
        try
        {
            status.Text = "Generating speech…";
            var payload = JsonSerializer.Serialize(new { model = model.SelectedItem?.ToString(), input, voice = (voice.SelectedItem as VoiceItem)?.Id, response_format = "mp3" });
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://openrouter.ai/api/v1/audio/speech");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
            request.Headers.TryAddWithoutValidation("HTTP-Referer", "https://nezoko45-dev.github.io");
            request.Headers.TryAddWithoutValidation("X-OpenRouter-Title", "OpenRouter TTS Reader");
            request.Content = new StringContent(payload, Encoding.UTF8, "application/json");
            using var response = await client.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                var detail = await response.Content.ReadAsStringAsync();
                try { using var doc = JsonDocument.Parse(detail); if (doc.RootElement.TryGetProperty("error", out var err)) detail = err.ValueKind == JsonValueKind.Object && err.TryGetProperty("message", out var msg) ? msg.GetString() ?? detail : err.ToString(); } catch { }
                status.Text = $"OpenRouter error {(int)response.StatusCode}: {detail}"; return;
            }
            var audio = await response.Content.ReadAsByteArrayAsync();
            if (audio.Length == 0) { status.Text = "OpenRouter returned an empty audio file."; return; }
            var file = Path.Combine(Path.GetTempPath(), "OpenRouterTTS-" + Guid.NewGuid().ToString("N") + ".mp3");
            await File.WriteAllBytesAsync(file, audio);
            Process.Start(new ProcessStartInfo(file) { UseShellExecute = true });
            status.Text = "Speech generated and opened in your default audio player. Dictate or enter more text whenever ready.";
        }
        catch (Exception ex) { status.Text = "Could not generate speech: " + ex.Message; }
        finally { generateButton.Enabled = true; pasteButton.Enabled = true; dictateButton.Enabled = true; }
    }

    private sealed record VoiceItem(string Id, string Label) { public override string ToString() => Label; }
}