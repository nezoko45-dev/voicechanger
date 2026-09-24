#include <onnxruntime_cxx_api.h>
#include <windows.h>
#include <commdlg.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;

static std::string narrow(const std::wstring& s) {
    if (s.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0, nullptr, nullptr);
    std::string out(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), n, nullptr, nullptr);
    return out;
}

static void fail(const std::string& s) {
    throw std::runtime_error(s);
}

static uint16_t rd16(const unsigned char* p) {
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static uint32_t rd32(const unsigned char* p) {
    return (uint32_t)p[0] |
           ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) |
           ((uint32_t)p[3] << 24);
}

static void wr16(std::ofstream& f, uint16_t x) {
    char p[2]{(char)x, (char)(x >> 8)};
    f.write(p, 2);
}

static void wr32(std::ofstream& f, uint32_t x) {
    wr16(f, (uint16_t)x);
    wr16(f, (uint16_t)(x >> 16));
}

struct Audio {
    int sample_rate = 0;
    std::vector<float> x;
};

static Audio read_wav(const fs::path& path) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) fail("Could not open the WAV file.");
    auto sz = f.tellg();
    if (sz < 44 || sz > std::streamoff(128 * 1024 * 1024)) fail("WAV must be 128 MiB or smaller.");

    std::vector<unsigned char> b((size_t)sz);
    f.seekg(0);
    f.read((char*)b.data(), sz);
    if (std::memcmp(b.data(), "RIFF", 4) || std::memcmp(b.data() + 8, "WAVE", 4))
        fail("The selected file is not a RIFF/WAVE file.");

    uint16_t fmt = 0, channels = 0, bits = 0, align = 0;
    uint32_t rate = 0;
    size_t data_at = 0, data_n = 0;

    const size_t end = (size_t)rd32(b.data() + 4) + 8;
    if (end > b.size() || end < 12) fail("The WAV file is truncated.");

    for (size_t at = 12; at + 8 <= end;) {
        const uint32_t n = rd32(b.data() + at + 4);
        if (n > end - at - 8) fail("The WAV file contains a bad chunk.");
        const auto* p = b.data() + at + 8;

        if (!std::memcmp(b.data() + at, "fmt ", 4)) {
            if (n < 16) fail("Invalid WAV format chunk.");
            fmt = rd16(p);
            channels = rd16(p + 2);
            rate = rd32(p + 4);
            align = rd16(p + 12);
            bits = rd16(p + 14);
        } else if (!std::memcmp(b.data() + at, "data", 4)) {
            data_at = at + 8;
            data_n = n;
        }
        at += 8 + n + (n & 1);
    }

    if (channels == 0 || rate == 0 || data_n == 0) fail("Missing WAV format/data.");
    if (!((fmt == 1 && (bits == 16 || bits == 24 || bits == 32)) || (fmt == 3 && bits == 32)))
        fail("Use PCM16/24/32 or IEEE float32 WAV audio.");
    if (align != channels * (bits / 8)) fail("Bad WAV block alignment.");
    if (data_n % align) fail("Bad WAV data size.");
    if (rate < 8000 || rate > 192000) fail("Unsupported WAV sample rate.");

    const size_t frames = data_n / align;
    Audio out;
    out.sample_rate = (int)rate;
    out.x.resize(frames);

    for (size_t i = 0; i < frames; ++i) {
        double sum = 0.0;
        const auto* p = b.data() + data_at + i * align;
        for (uint16_t c = 0; c < channels; ++c) {
            const auto* q = p + c * (bits / 8);
            double v = 0.0;
            if (fmt == 3 && bits == 32) {
                float z;
                std::memcpy(&z, q, 4);
                v = std::isfinite(z) ? z : 0.0;
            } else if (bits == 16) {
                v = (double)(int16_t)rd16(q) / 32768.0;
            } else if (bits == 24) {
                int32_t z = q[0] | (q[1] << 8) | (q[2] << 16);
                if (z & 0x800000) z |= ~0xFFFFFF;
                v = (double)z / 8388608.0;
            } else {
                v = (double)(int32_t)rd32(q) / 2147483648.0;
            }
            sum += v;
        }
        out.x[i] = (float)(sum / channels);
    }
    return out;
}

static void write_wav(const fs::path& path, const Audio& a) {
    std::ofstream f(path, std::ios::binary);
    if (!f) fail("Could not create the output WAV.");

    const uint32_t bytes = (uint32_t)(a.x.size() * 2);
    f.write("RIFF", 4);
    wr32(f, 36 + bytes);
    f.write("WAVEfmt ", 8);
    wr32(f, 16);
    wr16(f, 1);
    wr16(f, 1);
    wr32(f, (uint32_t)a.sample_rate);
    wr32(f, (uint32_t)a.sample_rate * 2);
    wr16(f, 2);
    wr16(f, 16);
    f.write("data", 4);
    wr32(f, bytes);

    for (float v : a.x) {
        v = std::clamp(v, -1.0f, 1.0f);
        const int16_t s = (int16_t)std::lround(v * 32767.0f);
        wr16(f, (uint16_t)s);
    }
}

static std::vector<float> resample_linear(const std::vector<float>& in, int from, int to) {
    if (from == to) return in;
    if (in.empty()) return {};
    const size_t out_n = (size_t)std::max<double>(1.0, std::llround((double)in.size() * to / from));
    std::vector<float> out(out_n);
    const double scale = (double)from / to;
    for (size_t i = 0; i < out_n; ++i) {
        double pos = i * scale;
        size_t j = (size_t)std::floor(pos);
        double t = pos - j;
        if (j >= in.size() - 1) out[i] = in.back();
        else out[i] = (float)(in[j] * (1.0 - t) + in[j + 1] * t);
    }
    return out;
}

static std::vector<float> reflect_pad(const std::vector<float>& in, size_t pad) {
    std::vector<float> out(in.size() + 2 * pad);
    for (size_t i = 0; i < out.size(); ++i) {
        long long q = (long long)i - (long long)pad;
        if (in.size() <= 1) {
            out[i] = in.empty() ? 0.0f : in[0];
            continue;
        }
        while (q < 0 || q >= (long long)in.size()) {
            if (q < 0) q = -q;
            else q = 2 * (long long)in.size() - 2 - q;
        }
        out[i] = in[(size_t)q];
    }
    return out;
}

/* Simple autocorrelation pitch estimator. It avoids any third-party pitch library
   while keeping the entire executable self-contained. */
static std::vector<float> estimate_f0(const std::vector<float>& wav16k, size_t frames) {
    const int hop = 160;
    const int win = 1024;
    const int min_lag = 8;   // 2000 Hz
    const int max_lag = 500; // 32 Hz
    std::vector<float> f0(frames, 0.0f);

    for (size_t k = 0; k < frames; ++k) {
        const int center = (int)k * hop;
        double energy = 0.0;
        for (int n = 0; n < win; ++n) {
            int idx = center + n - win / 2;
            if (idx < 0 || idx >= (int)wav16k.size()) continue;
            const double v = wav16k[(size_t)idx];
            energy += v * v;
        }
        if (energy < 1e-5) continue;

        double best = 0.0;
        int best_lag = 0;
        for (int lag = min_lag; lag <= max_lag; ++lag) {
            double r = 0.0;
            double e1 = 1e-8, e2 = 1e-8;
            for (int n = 0; n < win - lag; n += 2) {
                int a = center + n - win / 2;
                int b = a + lag;
                if (a < 0 || b >= (int)wav16k.size()) continue;
                const double x = wav16k[(size_t)a];
                const double y = wav16k[(size_t)b];
                r += x * y;
                e1 += x * x;
                e2 += y * y;
            }
            const double norm = r / std::sqrt(e1 * e2);
            if (norm > best) {
                best = norm;
                best_lag = lag;
            }
        }
        if (best_lag && best > 0.35)
            f0[k] = (float)(16000.0 / best_lag);
    }

    // Fill short unvoiced gaps.
    size_t last = SIZE_MAX;
    for (size_t i = 0; i < f0.size(); ++i) {
        if (f0[i] > 0.0f) {
            if (last != SIZE_MAX && i - last <= 6) {
                for (size_t j = last + 1; j < i; ++j)
                    f0[j] = f0[last] + (f0[i] - f0[last]) * float(j - last) / float(i - last);
            }
            last = i;
        }
    }
    return f0;
}

static std::vector<float> make_mel(const std::vector<float>& wav16k, size_t& frame_count) {
    const int n_fft = 1024;
    const int hop = 160;
    const int n_mels = 128;
    const double sr = 16000.0;

    frame_count = wav16k.size() / hop + 1;
    std::vector<float> mel(frame_count * n_mels, 0.0f);

    std::vector<double> window(n_fft);
    for (int n = 0; n < n_fft; ++n)
        window[n] = 0.5 - 0.5 * std::cos(2.0 * M_PI * n / n_fft);

    auto hz_to_mel = [](double hz) { return 1127.0 * std::log1p(hz / 700.0); };
    auto mel_to_hz = [](double m) { return 700.0 * (std::exp(m / 1127.0) - 1.0); };

    const double mel_lo = hz_to_mel(0.0);
    const double mel_hi = hz_to_mel(8000.0);

    std::vector<int> bin(n_mels + 2);
    for (int m = 0; m < n_mels + 2; ++m) {
        const double mm = mel_lo + (mel_hi - mel_lo) * m / (n_mels + 1);
        const double hz = mel_to_hz(mm);
        bin[m] = std::clamp((int)std::floor((n_fft + 1) * hz / sr), 0, n_fft / 2);
    }

    // The RMVPE model bundled by this project is optional in this native build.
    // Retain this helper as a compatibility utility for future pitch backends.
    // The current default pitch path uses the self-contained estimator above.
    (void)window;
    (void)bin;
    return mel;
}

static const char* first_name(const std::vector<std::string>& names,
                              std::initializer_list<const char*> candidates) {
    for (const char* c : candidates)
        for (const auto& n : names)
            if (_stricmp(c, n.c_str()) == 0) return n.c_str();
    return nullptr;
}

static std::vector<std::string> input_names(Ort::Session& s) {
    Ort::AllocatorWithDefaultOptions alloc;
    std::vector<std::string> out;
    for (size_t i = 0; i < s.GetInputCount(); ++i) {
        auto p = s.GetInputNameAllocated(i, alloc);
        out.emplace_back(p.get());
    }
    return out;
}

static std::vector<std::string> output_names(Ort::Session& s) {
    Ort::AllocatorWithDefaultOptions alloc;
    std::vector<std::string> out;
    for (size_t i = 0; i < s.GetOutputCount(); ++i) {
        auto p = s.GetOutputNameAllocated(i, alloc);
        out.emplace_back(p.get());
    }
    return out;
}

static std::vector<float> content_features(Ort::Session& s, const std::vector<float>& audio) {
    const auto names = input_names(s);
    if (names.empty()) fail("Content model has no inputs.");
    const char* name = names[0].c_str();

    auto mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    std::array<int64_t, 2> shape2{1, (int64_t)audio.size()};
    std::array<int64_t, 3> shape3{1, 1, (int64_t)audio.size()};

    Ort::Value tensor{nullptr};
    bool rank3 = false;
    try {
        tensor = Ort::Value::CreateTensor<float>(
            mem, const_cast<float*>(audio.data()), audio.size(), shape2.data(), shape2.size());
        auto info = s.GetInputTypeInfo(0).GetTensorTypeAndShapeInfo();
        if (info.GetShape().size() == 3) rank3 = true;
    } catch (...) {
        rank3 = true;
    }
    if (rank3) {
        tensor = Ort::Value::CreateTensor<float>(
            mem, const_cast<float*>(audio.data()), audio.size(), shape3.data(), shape3.size());
    }

    std::vector<const char*> in_names{name};
    auto outs = s.Run(Ort::RunOptions{nullptr}, in_names.data(), &tensor, 1, nullptr, 0);
    if (outs.empty()) fail("Content model returned no output.");

    auto ti = outs[0].GetTensorTypeAndShapeInfo();
    const auto shape = ti.GetShape();
    const float* p = outs[0].GetTensorData<float>();
    const size_t count = ti.GetElementCount();

    if (shape.size() != 3) fail("Content model output is not rank 3.");

    size_t t = 0, d = 0;
    if (shape[2] == 768) {
        t = (size_t)shape[1];
        d = (size_t)shape[2];
    } else if (shape[1] == 768) {
        t = (size_t)shape[2];
        d = (size_t)shape[1];
    } else {
        fail("Content model does not appear to output 768-D features.");
    }

    if (d != 768) fail("This build expects an RVC v2 768-D ContentVec model.");
    std::vector<float> feat(t * d);
    if (shape[2] == 768) {
        std::copy(p, p + count, feat.begin());
    } else {
        for (size_t tii = 0; tii < t; ++tii)
            for (size_t di = 0; di < d; ++di)
                feat[tii * d + di] = p[di * t + tii];
    }
    return feat;
}

static std::vector<float> run_rvc(Ort::Session& s,
                                  const std::vector<float>& features,
                                  const std::vector<int64_t>& pitch,
                                  const std::vector<float>& pitchf) {
    const auto names = input_names(s);
    const auto outs_names = output_names(s);
    if (names.empty() || outs_names.empty()) fail("RVC model has no usable inputs/outputs.");

    const char* phone = first_name(names, {"phone", "features", "feats"});
    const char* lengths = first_name(names, {"phone_lengths", "lengths"});
    const char* pitch_name = first_name(names, {"pitch", "coarse"});
    const char* pitchf_name = first_name(names, {"pitchf", "nsff0", "f0"});
    const char* sid_name = first_name(names, {"ds", "sid", "speaker"});
    const char* rnd_name = first_name(names, {"rnd", "noise"});
    if (!phone) phone = names[0].c_str();

    const size_t frames = pitch.size();
    const int64_t dim = 768;
    std::vector<float> phone_data(frames * (size_t)dim);

    for (size_t t = 0; t < frames; ++t) {
        const size_t src_t = std::min(t / 2, features.size() / (size_t)dim - 1);
        std::memcpy(&phone_data[t * (size_t)dim],
                    &features[src_t * (size_t)dim],
                    sizeof(float) * (size_t)dim);
    }

    auto mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    std::array<int64_t, 3> phone_shape{1, (int64_t)frames, dim};
    std::array<int64_t, 1> one_shape{1};
    std::array<int64_t, 2> time_shape{1, (int64_t)frames};
    std::array<int64_t, 3> noise_shape{1, 192, (int64_t)frames};

    std::vector<int64_t> one{(int64_t)frames};
    std::vector<int64_t> sid{0};
    std::mt19937 rng(12345);
    std::normal_distribution<float> nd(0.0f, 1.0f);
    std::vector<float> noise((size_t)192 * frames);
    for (auto& v : noise) v = nd(rng);

    Ort::Value phone_v = Ort::Value::CreateTensor<float>(
        mem, phone_data.data(), phone_data.size(), phone_shape.data(), phone_shape.size());

    Ort::Value len_v = Ort::Value::CreateTensor<int64_t>(
        mem, one.data(), one.size(), one_shape.data(), one_shape.size());

    std::vector<int64_t> pitch_i = pitch;
    Ort::Value pitch_v = Ort::Value::CreateTensor<int64_t>(
        mem, pitch_i.data(), pitch_i.size(), time_shape.data(), time_shape.size());

    Ort::Value pitchf_v = Ort::Value::CreateTensor<float>(
        mem, const_cast<float*>(pitchf.data()), pitchf.size(), time_shape.data(), time_shape.size());

    Ort::Value sid_v = Ort::Value::CreateTensor<int64_t>(
        mem, sid.data(), sid.size(), one_shape.data(), one_shape.size());

    Ort::Value noise_v = Ort::Value::CreateTensor<float>(
        mem, noise.data(), noise.size(), noise_shape.data(), noise_shape.size());

    std::vector<const char*> in;
    std::vector<Ort::Value> vals;
    for (const auto& n : names) {
        if (phone && n == phone) { in.push_back(n.c_str()); vals.emplace_back(std::move(phone_v)); }
        else if (lengths && n == lengths) { in.push_back(n.c_str()); vals.emplace_back(std::move(len_v)); }
        else if (pitch_name && n == pitch_name) { in.push_back(n.c_str()); vals.emplace_back(std::move(pitch_v)); }
        else if (pitchf_name && n == pitchf_name) { in.push_back(n.c_str()); vals.emplace_back(std::move(pitchf_v)); }
        else if (sid_name && n == sid_name) { in.push_back(n.c_str()); vals.emplace_back(std::move(sid_v)); }
        else if (rnd_name && n == rnd_name) { in.push_back(n.c_str()); vals.emplace_back(std::move(noise_v)); }
    }

    if (vals.size() != names.size())
        fail("The RVC ONNX model uses unsupported input names.");

    auto result = s.Run(Ort::RunOptions{nullptr},
                        in.data(), vals.data(), vals.size(),
                        outs_names.data(), 1);

    if (result.empty()) fail("RVC model returned no audio.");
    auto out_info = result[0].GetTensorTypeAndShapeInfo();
    const size_t count = out_info.GetElementCount();
    const float* p = result[0].GetTensorData<float>();
    if (count == 0) fail("RVC model returned empty audio.");

    std::vector<float> audio(p, p + count);
    return audio;
}

} // namespace

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
    try {
        const fs::path root = fs::path([] {
            wchar_t b[32768]; DWORD n = GetModuleFileNameW(nullptr, b, 32768);
            return fs::path(std::wstring(b, n)).parent_path();
        }());
        const fs::path model_dir = root / "models";

        const fs::path voice_path = model_dir / "GuraTalkV2.onnx";
        const fs::path content_path = model_dir / "vec-768-layer-12.onnx";
        if (!fs::exists(voice_path) || !fs::exists(content_path))
            fail("Missing bundled ONNX models.\n\nExpected:\n" +
                 voice_path.string() + "\n" + content_path.string());

        const fs::path selected = [] {
            wchar_t file_name[32768] = {};
            OPENFILENAMEW ofn{};
            ofn.lStructSize = sizeof(ofn);
            ofn.lpstrFile = file_name;
            ofn.nMaxFile = 32768;
            ofn.lpstrFilter = L"WAV audio (*.wav)\0*.wav\0All files (*.*)\0*.*\0";
            ofn.nFilterIndex = 1;
            ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;
            ofn.lpstrTitle = L"Select WAV audio";
            return GetOpenFileNameW(&ofn) ? fs::path(file_name) : fs::path();
        }();
        if (selected.empty()) return 0;

        AllocConsole();
        FILE* dummy = nullptr;
        freopen_s(&dummy, "CONOUT$", "w", stdout);
        freopen_s(&dummy, "CONOUT$", "w", stderr);
        std::cout << "VoiceChanger - native ONNX Runtime\n";
        std::cout << "Loading WAV...\n";

        Audio input = read_wav(selected);
        if (input.x.size() < 320) fail("WAV is too short.");
        std::cout << "Input: " << narrow(selected.filename().wstring())
                  << " (" << input.sample_rate << " Hz, "
                  << input.x.size() << " samples)\n";

        const auto wav16 = resample_linear(input.x, input.sample_rate, 16000);
        std::vector<float> padded = reflect_pad(wav16, 80);
        padded = reflect_pad(padded, 16000);

        Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "VoiceChanger");
        Ort::SessionOptions opts;
        opts.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
        opts.SetIntraOpNumThreads(0);
        opts.SetInterOpNumThreads(0);

        Ort::Session content(env, content_path.wstring().c_str(), opts);
        Ort::Session voice(env, voice_path.wstring().c_str(), opts);

        std::cout << "Running ContentVec ONNX...\n";
        auto features = content_features(content, padded);
        size_t feat_frames = features.size() / 768;
        if (feat_frames < 2) fail("ContentVec returned too few frames.");

        const size_t p_len = feat_frames * 2;
        std::cout << "Features: " << feat_frames << " frames\n";
        std::cout << "Estimating pitch...\n";
        auto f0 = estimate_f0(padded, p_len);

        const float f0_min = 50.0f;
        const float f0_max = 1100.0f;
        const float mel_min = 1127.0f * std::log1p(f0_min / 700.0f);
        const float mel_max = 1127.0f * std::log1p(f0_max / 700.0f);

        std::vector<int64_t> coarse(p_len, 1);
        std::vector<float> fine(p_len, 0.0f);
        float last = 100.0f;

        for (size_t i = 0; i < p_len; ++i) {
            if (f0[i] > 0) last = f0[i];
            const float hz = std::clamp(last, f0_min, f0_max);
            fine[i] = hz;
            const float m = 1127.0f * std::log1p(hz / 700.0f);
            int q = (int)std::lround((m - mel_min) * 254.0f / (mel_max - mel_min) + 1.0f);
            coarse[i] = std::clamp(q, 1, 255);
        }

        std::cout << "Running RVC target voice ONNX...\n";
        auto converted = run_rvc(voice, features, coarse, fine);

        const int target_sr = 40000;
        const size_t trim = (size_t)target_sr / 2;
        if (converted.size() > trim * 2)
            converted = std::vector<float>(converted.begin() + trim, converted.end() - trim);

        converted = resample_linear(converted, target_sr, input.sample_rate);
        Audio output{input.sample_rate, std::move(converted)};

        const fs::path out = selected.parent_path() /
            (selected.stem().wstring() + L"_voicechanged.wav");

        std::cout << "Writing: " << narrow(out.wstring()) << "\n";
        write_wav(out, output);
        std::cout << "DONE\n";

        MessageBoxW(nullptr,
            (L"Voice conversion complete.\n\nSaved to:\n" + out.wstring()).c_str(),
            L"VoiceChanger", MB_OK | MB_ICONINFORMATION);
        FreeConsole();
        return 0;
    } catch (const std::exception& e) {
        MessageBoxA(nullptr, e.what(), "VoiceChanger error", MB_OK | MB_ICONERROR);
        return 1;
    } catch (...) {
        MessageBoxA(nullptr, "Unknown error.", "VoiceChanger error", MB_OK | MB_ICONERROR);
        return 1;
    }
}
