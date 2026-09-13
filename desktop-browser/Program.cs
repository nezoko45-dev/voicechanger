using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Speech.Synthesis;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace VoiceChanger;

internal static class Program
{
    private const int SampleRate = 22050;
    private const int FftSize = 1024;
    private const int Hop = 256;
    private const string ModelBase = "https://huggingface.co/Hinotsuba/OpenVoice-ONNX-v2/resolve/main/";
    private static readonly string ModelDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VoiceChanger", "models");
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(20) };
    private static readonly object ModelLock = new();
    private static InferenceSession? Extractor;
    private static InferenceSession? Converter;
    private static int Port;

    private sealed record CloneRequest(string Text, string ReferenceWavBase64, float Tau = 0.8f);

    [STAThread]
    private static void Main()
    {
        Directory.CreateDirectory(ModelDir);
        Port = GetFreePort();
        var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
        listener.Start();
        var url = $"http://127.0.0.1:{Port}/";
        ListenAsync(listener);
        LaunchBrowser(url);
        Application.Run(new System.Windows.Forms.ApplicationContext());
    }

    private static async Task ListenAsync(HttpListener listener)
    {
        while (listener.IsListening)
        {
            try
            {
                var ctx = await listener.GetContextAsync();
                _ = Task.Run(() => Handle(ctx));
            }
            catch
            {
                break;
            }
        }
    }

    private static int GetFreePort()
    {
        var l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var p = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return p;
    }

    private static void LaunchBrowser(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { }
    }

    private static async Task Handle(HttpListenerContext ctx)
    {
        try
        {
            ctx.Response.Headers["Cache-Control"] = "no-store";
            var path = ctx.Request.Url?.AbsolutePath ?? "/";
            if (path == "/api/clone" && ctx.Request.HttpMethod == "POST") await Clone(ctx);
            else if (path == "/api/models" && ctx.Request.HttpMethod == "GET") Json(ctx, 200, new { ready = File.Exists(Path.Combine(ModelDir, "tone_extract.onnx")) && File.Exists(Path.Combine(ModelDir, "tone_color.onnx")), model_dir = ModelDir });
            else if (path == "/api/voices" && ctx.Request.HttpMethod == "GET") Voices(ctx);
            else ServeIndex(ctx);
        }
        catch (Exception ex) { Json(ctx, 500, new { error = ex.Message }); }
        finally { try { ctx.Response.Close(); } catch { } }
    }

    private static void Voices(HttpListenerContext ctx)
    {
        using var synth = new SpeechSynthesizer();
        var voices = synth.GetInstalledVoices().Select(v => v.VoiceInfo.Name).ToArray();
        Json(ctx, 200, new { voices });
    }

    private static async Task Clone(HttpListenerContext ctx)
    {
        var req = await JsonSerializer.DeserializeAsync<CloneRequest>(ctx.Request.InputStream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (req is null || string.IsNullOrWhiteSpace(req.Text) || string.IsNullOrWhiteSpace(req.ReferenceWavBase64)) { Json(ctx, 400, new { error = "Text and reference audio are required." }); return; }

        var reference = Convert.FromBase64String(req.ReferenceWavBase64);
        var referenceSamples = ReadWav(reference, out var refRate);
        referenceSamples = Resample(referenceSamples, refRate, SampleRate);
        if (referenceSamples.Length < SampleRate * 2) { Json(ctx, 400, new { error = "Use a voice reference of at least 2 seconds." }); return; }

        var baseWav = Synthesize(req.Text);
        var baseSamples = ReadWav(baseWav, out var baseRate);
        baseSamples = Resample(baseSamples, baseRate, SampleRate);

        EnsureModels();
        var targetEmbedding = ExtractEmbedding(referenceSamples);
        var sourceEmbedding = ExtractEmbedding(baseSamples);
        var result = ConvertTone(baseSamples, sourceEmbedding, targetEmbedding, Math.Clamp(req.Tau, 0.2f, 1.2f));
        var wav = WriteWav(result, SampleRate);
        ctx.Response.ContentType = "audio/wav";
        ctx.Response.StatusCode = 200;
        await ctx.Response.OutputStream.WriteAsync(wav);
    }

    private static byte[] Synthesize(string text)
    {
        var path = Path.Combine(Path.GetTempPath(), "vc_" + Guid.NewGuid().ToString("N") + ".wav");
        try
        {
            using (var synth = new SpeechSynthesizer())
            {
                synth.Rate = 0;
                synth.Volume = 100;
                synth.SetOutputToWaveFile(path);
                synth.Speak(text);
                synth.SetOutputToNull();
            }
            return File.ReadAllBytes(path);
        }
        finally { try { File.Delete(path); } catch { } }
    }

    private static void EnsureModels()
    {
        lock (ModelLock)
        {
            if (Extractor is not null && Converter is not null) return;
            Directory.CreateDirectory(ModelDir);
            var extractPath = Path.Combine(ModelDir, "tone_extract.onnx");
            var convertPath = Path.Combine(ModelDir, "tone_color.onnx");
            if (!File.Exists(extractPath)) Download(ModelBase + "tone_extract.onnx?download=true", extractPath);
            if (!File.Exists(convertPath)) Download(ModelBase + "tone_color.onnx?download=true", convertPath);
            Extractor = new InferenceSession(extractPath);
            Converter = new InferenceSession(convertPath);
        }
    }

    private static void Download(string url, string path)
    {
        using var response = Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult();
        response.EnsureSuccessStatusCode();
        var part = path + ".part";
        try
        {
            if (File.Exists(part)) File.Delete(part);
            using (var input = response.Content.ReadAsStream())
            using (var output = File.Create(part))
            {
                input.CopyTo(output);
                output.Flush(true);
            }
            File.Move(part, path, true);
        }
        finally
        {
            try { if (File.Exists(part)) File.Delete(part); } catch { }
        }
    }

    private static float[] ExtractEmbedding(float[] samples)
    {
        var spec = Spectrogram(samples);
        const int targetFrames = 128;
        var data = new DenseTensor<float>(new[] { 1, targetFrames, FftSize / 2 + 1 });
        var frames = spec.GetLength(0);
        var start = Math.Max(0, (frames - targetFrames) / 2);
        for (var t = 0; t < targetFrames; t++)
        {
            var src = Math.Min(frames - 1, start + t);
            for (var f = 0; f <= FftSize / 2; f++) data[0, t, f] = spec[src, f];
        }
        var inputName = Extractor!.InputMetadata.Keys.First();
        using var result = Extractor.Run(new[] { NamedOnnxValue.CreateFromTensor(inputName, data) });
        return result.First().AsEnumerable<float>().ToArray();
    }

    private static float[] ConvertTone(float[] baseAudio, float[] source, float[] target, float tau)
    {
        var spec = Spectrogram(baseAudio);
        var frames = spec.GetLength(0);
        var audio = new DenseTensor<float>(new[] { 1, FftSize / 2 + 1, frames });
        for (var t = 0; t < frames; t++) for (var f = 0; f <= FftSize / 2; f++) audio[0, f, t] = spec[t, f];
        var src = new DenseTensor<float>(new[] { 1, 256, 1 });
        var dst = new DenseTensor<float>(new[] { 1, 256, 1 });
        for (var i = 0; i < 256; i++) { src[0, i, 0] = source[Math.Min(i, source.Length - 1)]; dst[0, i, 0] = target[Math.Min(i, target.Length - 1)]; }
        var len = new DenseTensor<long>(new[] { 1 }); len[0] = frames;
        var temp = new DenseTensor<float>(new[] { 1 }); temp[0] = tau;
        var names = Converter!.InputMetadata.Keys.ToArray();
        var inputs = new List<NamedOnnxValue>();
        foreach (var n in names)
        {
            var l = n.ToLowerInvariant();
            if (l.Contains("audio") && !l.Contains("length")) inputs.Add(NamedOnnxValue.CreateFromTensor(n, audio));
            else if (l.Contains("length")) inputs.Add(NamedOnnxValue.CreateFromTensor(n, len));
            else if (l.Contains("src")) inputs.Add(NamedOnnxValue.CreateFromTensor(n, src));
            else if (l.Contains("dest") || l.Contains("tgt")) inputs.Add(NamedOnnxValue.CreateFromTensor(n, dst));
            else if (l.Contains("tau")) inputs.Add(NamedOnnxValue.CreateFromTensor(n, temp));
        }
        using var result = Converter.Run(inputs);
        var output = result.First().AsEnumerable<float>().ToArray();
        var peak = output.Select(Math.Abs).DefaultIfEmpty(1).Max();
        if (peak > 0.98f) { var gain = 0.96f / peak; for (var i = 0; i < output.Length; i++) output[i] *= gain; }
        return output;
    }

    private static float[,] Spectrogram(float[] samples)
    {
        var frames = Math.Max(1, (samples.Length - FftSize + Hop) / Hop);
        var spec = new float[frames, FftSize / 2 + 1];
        var re = new double[FftSize]; var im = new double[FftSize];
        for (var t = 0; t < frames; t++)
        {
            var off = t * Hop;
            for (var i = 0; i < FftSize; i++) { var s = off + i < samples.Length ? samples[off + i] : 0; var w = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (FftSize - 1)); re[i] = s * w; im[i] = 0; }
            FFT(re, im);
            for (var f = 0; f <= FftSize / 2; f++) spec[t, f] = (float)Math.Sqrt(re[f] * re[f] + im[f] * im[f]);
        }
        return spec;
    }

    private static void FFT(double[] re, double[] im)
    {
        var n = re.Length;
        var j0 = 0;
        for (var i = 1; i < n; i++)
        {
            var bit = n >> 1;
            for (; (j0 & bit) != 0; bit >>= 1) j0 ^= bit;
            j0 ^= bit;
            if (i < j0)
            {
                (re[i], re[j0]) = (re[j0], re[i]);
                (im[i], im[j0]) = (im[j0], im[i]);
            }
        }
        for (var len = 2; len <= n; len <<= 1)
        {
            var ang = -2 * Math.PI / len; var wr0 = Math.Cos(ang); var wi0 = Math.Sin(ang);
            for (var i = 0; i < n; i += len) { var wr = 1.0; var wi = 0.0; for (var j = 0; j < len / 2; j++) { var u = i + j; var v = i + j + len / 2; var tr = re[v] * wr - im[v] * wi; var ti = re[v] * wi + im[v] * wr; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; var nr = wr * wr0 - wi * wi0; wi = wr * wi0 + wi * wr0; wr = nr; } }
        }
    }

    private static float[] ReadWav(byte[] wav, out int rate)
    {
        rate = BitConverter.ToInt32(wav, 24); var channels = BitConverter.ToInt16(wav, 22); var bits = BitConverter.ToInt16(wav, 34); var pos = 12; var dataPos = -1; var dataLen = 0;
        while (pos + 8 <= wav.Length) { var id = Encoding.ASCII.GetString(wav, pos, 4); var len = BitConverter.ToInt32(wav, pos + 4); if (id == "data") { dataPos = pos + 8; dataLen = Math.Min(len, wav.Length - dataPos); break; } pos += 8 + len + (len & 1); }
        if (dataPos < 0 || bits != 16) throw new InvalidDataException("Reference audio must be a 16-bit PCM WAV.");
        var count = dataLen / 2 / channels; var mono = new float[count];
        for (var i = 0; i < count; i++) { double sum = 0; for (var c = 0; c < channels; c++) sum += BitConverter.ToInt16(wav, dataPos + (i * channels + c) * 2) / 32768.0; mono[i] = (float)(sum / channels); }
        return mono;
    }

    private static float[] Resample(float[] x, int from, int to)
    {
        if (from == to) return x; var n = Math.Max(1, (int)Math.Round(x.Length * (double)to / from)); var y = new float[n];
        for (var i = 0; i < n; i++) { var p = i * (double)from / to; var a = Math.Min(x.Length - 1, (int)p); var b = Math.Min(x.Length - 1, a + 1); var f = p - a; y[i] = (float)(x[a] * (1 - f) + x[b] * f); }
        return y;
    }

    private static byte[] WriteWav(float[] samples, int rate)
    {
        using var ms = new MemoryStream(); using var bw = new BinaryWriter(ms); var bytes = samples.Length * 2;
        bw.Write(Encoding.ASCII.GetBytes("RIFF")); bw.Write(36 + bytes); bw.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); bw.Write(16); bw.Write((short)1); bw.Write((short)1); bw.Write(rate); bw.Write(rate * 2); bw.Write((short)2); bw.Write((short)16); bw.Write(Encoding.ASCII.GetBytes("data")); bw.Write(bytes);
        foreach (var s in samples) bw.Write((short)Math.Clamp((int)(s * 32767), short.MinValue, short.MaxValue));
        return ms.ToArray();
    }

    private static void ServeIndex(HttpListenerContext ctx)
    {
        var html = Ui;
        var data = Encoding.UTF8.GetBytes(html);
        ctx.Response.ContentType = "text/html; charset=utf-8"; ctx.Response.ContentLength64 = data.Length; ctx.Response.OutputStream.Write(data);
    }

    private static void Json(HttpListenerContext ctx, int code, object value)
    {
        var data = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value)); ctx.Response.StatusCode = code; ctx.Response.ContentType = "application/json"; ctx.Response.ContentLength64 = data.Length; ctx.Response.OutputStream.Write(data);
    }

    private static string Ui => """
<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>VoiceChanger — Local OpenVoice V2</title>
<style>body{font-family:system-ui;background:#0d0f14;color:#eee;max-width:820px;margin:auto;padding:28px}h1{margin:0}.sub{color:#9da3b1}.card{background:#171a21;border:1px solid #2d313b;border-radius:14px;padding:18px;margin:14px 0;display:grid;gap:12px}input,select,button{font:inherit;border-radius:9px;border:1px solid #3a3f4b;background:#0d1015;color:#eee;padding:11px}button{cursor:pointer;background:#272d38}.status{padding:10px;border-radius:9px;background:#0d1015}.err{color:#ff9a9a}.ok{color:#9ff0ae}.note{font-size:13px;color:#8f96a5}audio{width:100%}.row{display:flex;gap:10px}.row>*{flex:1}</style></head>
<body><h1>🎙️ VoiceChanger</h1><div class='sub'>Deepgram STT → local OpenVoice V2 ONNX tone cloning. No Replicate. No Python. No Electron.</div>
<div class='card'><label>Deepgram API key<input id='dg' type='password' placeholder='Deepgram API key'></label><button id='save'>Save key</button><div id='status' class='status'>Checking local OpenVoice models…</div><div class='note'>Your Deepgram key stays in this browser. OpenVoice runs locally on this PC. The ONNX models are downloaded once to your Windows user profile.</div></div>
<div class='card'><label>Voice reference WAV<input id='ref' type='file' accept='audio/*'></label><label>Voice style<select id='voice'></select></label><label>Cloning strength<input id='tau' type='range' min='.2' max='1.2' step='.05' value='.8'></label><div class='note'>Use a clean 3–15 second reference. The app converts it to 22.05 kHz PCM WAV locally.</div></div>
<div class='card'><div class='row'><button id='start'>Start microphone</button><button id='stop' disabled>Stop</button></div><b>Live transcript</b><div id='transcript' class='status'></div><audio id='player' controls></audio></div>
<script>
const $=id=>document.getElementById(id);let ws=null,stream=null,ctx=null,src=null,proc=null,working=false;
function st(t,e=false){$('status').textContent=t;$('status').className='status '+(e?'err':'ok')}
$('dg').value=localStorage.getItem('vc.dg')||'';
$('save').onclick=()=>{localStorage.setItem('vc.dg',$('dg').value.trim());st('Deepgram key saved.')};
async function init(){try{const r=await fetch('/api/models');const j=await r.json();st(j.ready?'Local OpenVoice models ready.':'Models will download automatically on first voice reply.');const v=await fetch('/api/voices');const x=await v.json();$('voice').innerHTML=(x.voices||[]).map(n=>`<option>${n}</option>`).join('')}catch(e){st(e.message,true)}}init();
async function wavFromFile(file){const ab=await file.arrayBuffer();const ac=new AudioContext();const b=await ac.decodeAudioData(ab);const n=b.length, ch=b.numberOfChannels, out=new Float32Array(n);for(let c=0;c<ch;c++){const d=b.getChannelData(c);for(let i=0;i<n;i++)out[i]+=d[i]/ch}const rate=22050,m=Math.max(1,Math.round(n*rate/b.sampleRate)),y=new Float32Array(m);for(let i=0;i<m;i++){const p=i*b.sampleRate/rate,a=Math.min(n-1,Math.floor(p)),q=Math.min(n-1,a+1),f=p-a;y[i]=out[a]*(1-f)+out[q]*f}const buf=new ArrayBuffer(44+m*2),dv=new DataView(buf);const ws=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i))};ws(0,'RIFF');dv.setUint32(4,36+m*2,true);ws(8,'WAVE');ws(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,rate,true);dv.setUint32(28,rate*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);ws(36,'data');dv.setUint32(40,m*2,true);for(let i=0;i<m;i++)dv.setInt16(44+i*2,Math.max(-1,Math.min(1,y[i]))*32767,true);ac.close();return new Uint8Array(buf)}
function b64(a){let s='';for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s)}
async function synth(text){if(working)return;const f=$('ref').files[0];if(!f)return st('Choose a voice reference first.',true);working=true;st('Running OpenVoice V2 locally… first run may download the ONNX models.');try{const wav=await wavFromFile(f);const r=await fetch('/api/clone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,referenceWavBase64:b64(wav),tau:parseFloat($('tau').value)})});if(!r.ok){st(await r.text(),true);return}const blob=await r.blob();$('player').src=URL.createObjectURL(blob);await $('player').play().catch(()=>{});st('Local cloned voice ready.')}catch(e){st(e.message,true)}finally{working=false}}
async function start(){const key=$('dg').value.trim();if(!key)return st('Enter your Deepgram API key.',true);if(!$('ref').files[0])return st('Choose a voice reference first.',true);stream=await navigator.mediaDevices.getUserMedia({audio:true});ctx=new AudioContext({sampleRate:16000});src=ctx.createMediaStreamSource(stream);proc=ctx.createScriptProcessor(4096,1,1);ws=new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&endpointing=400',['token',key]);ws.onopen=()=>{st('Deepgram connected — speak now.');$('start').disabled=true;$('stop').disabled=false};ws.onmessage=e=>{let d;try{d=JSON.parse(e.data)}catch{return}const t=d.channel?.alternatives?.[0]?.transcript||'';if(t)$('transcript').textContent=t;if(t&&d.is_final&&d.speech_final)synth(t)};ws.onerror=()=>st('Deepgram connection error.',true);ws.onclose=()=>{$('start').disabled=false;$('stop').disabled=true};proc.onaudioprocess=e=>{if(ws?.readyState!==1)return;const f=e.inputBuffer.getChannelData(0),b=new ArrayBuffer(f.length*2),v=new DataView(b);for(let i=0;i<f.length;i++){let s=Math.max(-1,Math.min(1,f[i]));v.setInt16(i*2,s<0?s*32768:s*32767,true)}ws.send(b)};src.connect(proc);proc.connect(ctx.destination)}
function stop(){try{ws?.send(JSON.stringify({type:'Finalize'}));ws?.close();proc?.disconnect();src?.disconnect();stream?.getTracks().forEach(t=>t.stop());ctx?.close()}catch{}$('start').disabled=false;$('stop').disabled=true;st('Stopped.')}
$('start').onclick=start;$('stop').onclick=stop;
</script></body></html>
""";
}
