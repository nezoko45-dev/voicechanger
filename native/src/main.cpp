#include "dvc/dvc.h"

#include <windows.h>
#include <commdlg.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace {

uint16_t u16(const unsigned char* p) {
    return static_cast<uint16_t>(p[0] | (p[1] << 8));
}

uint32_t u32(const unsigned char* p) {
    return p[0] |
           (uint32_t(p[1]) << 8) |
           (uint32_t(p[2]) << 16) |
           (uint32_t(p[3]) << 24);
}

void put16(std::ostream& f, uint16_t n) {
    const char p[] = {char(n), char(n >> 8)};
    f.write(p, 2);
}

void put32(std::ostream& f, uint32_t n) {
    put16(f, uint16_t(n));
    put16(f, uint16_t(n >> 16));
}

struct Wave {
    uint32_t rate{};
    std::vector<float> samples;
};

Wave read_wav(const fs::path& path) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) throw std::runtime_error("Cannot open WAV file.");

    const auto size = f.tellg();
    if (size < 12 || size > std::streamoff(64 * 1024 * 1024))
        throw std::runtime_error("WAV must be smaller than 64 MiB.");

    std::vector<unsigned char> bytes(static_cast<size_t>(size));
    f.seekg(0);
    f.read(reinterpret_cast<char*>(bytes.data()), size);
    if (!f) throw std::runtime_error("Could not read WAV file.");

    if (std::memcmp(bytes.data(), "RIFF", 4) != 0 ||
        std::memcmp(bytes.data() + 8, "WAVE", 4) != 0) {
        throw std::runtime_error("Expected a RIFF/WAVE file.");
    }

    uint16_t format = 0, channels = 0, bits = 0, align = 0;
    uint32_t rate = 0;
    size_t data_offset = 0, data_length = 0;

    const size_t riff_end = static_cast<size_t>(u32(bytes.data() + 4)) + 8;
    if (riff_end > bytes.size() || riff_end < 12)
        throw std::runtime_error("Truncated RIFF file.");

    for (size_t at = 12; at + 8 <= riff_end;) {
        const size_t n = u32(bytes.data() + at + 4);
        if (n > riff_end - at - 8)
            throw std::runtime_error("Truncated WAV chunk.");

        const auto* p = bytes.data() + at + 8;

        if (std::memcmp(bytes.data() + at, "fmt ", 4) == 0) {
            if (n < 16) throw std::runtime_error("Invalid WAV fmt chunk.");
            format = u16(p);
            channels = u16(p + 2);
            rate = u32(p + 4);
            align = u16(p + 12);
            bits = u16(p + 14);
        } else if (std::memcmp(bytes.data() + at, "data", 4) == 0) {
            data_offset = at + 8;
            data_length = n;
        }

        at += 8 + n + (n & 1);
    }

    if (channels != 1 ||
        !((format == 1 && bits == 16) || (format == 3 && bits == 32)) ||
        align != bits / 8 ||
        data_length == 0 ||
        data_length % align != 0) {
        throw std::runtime_error("Use a mono PCM16 or IEEE float32 WAV.");
    }

    if (rate < 8000 || rate > 96000 ||
        data_length / align > static_cast<size_t>(rate) * 30) {
        throw std::runtime_error("Use 8-96 kHz WAV audio up to 30 seconds.");
    }

    Wave out;
    out.rate = rate;
    out.samples.resize(data_length / align);

    for (size_t i = 0; i < out.samples.size(); ++i) {
        const auto* p = bytes.data() + data_offset + i * align;
        if (format == 1) {
            const auto v = u16(p);
            const int16_t s = static_cast<int16_t>(v);
            out.samples[i] = static_cast<float>(s) / 32768.0f;
        } else {
            const uint32_t v = u32(p);
            std::memcpy(&out.samples[i], &v, sizeof(float));
        }
        if (!std::isfinite(out.samples[i])) out.samples[i] = 0.0f;
    }

    return out;
}

void write_wav(const fs::path& path, const Wave& audio) {
    std::ofstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("Cannot create output WAV.");

    const uint32_t bytes = static_cast<uint32_t>(audio.samples.size() * 2);
    f.write("RIFF", 4);
    put32(f, 36 + bytes);
    f.write("WAVEfmt ", 8);
    put32(f, 16);
    put16(f, 1);
    put16(f, 1);
    put32(f, audio.rate);
    put32(f, audio.rate * 2);
    put16(f, 2);
    put16(f, 16);
    f.write("data", 4);
    put32(f, bytes);

    for (float x : audio.samples) {
        x = std::clamp(x, -1.0f, 1.0f);
        const auto s = static_cast<int16_t>(std::lround(x * 32767.0f));
        put16(f, static_cast<uint16_t>(s));
    }

    if (!f) throw std::runtime_error("Output WAV write failed.");
}

fs::path exe_dir() {
    wchar_t buffer[32768];
    const DWORD n = GetModuleFileNameW(nullptr, buffer, static_cast<DWORD>(std::size(buffer)));
    if (n == 0 || n >= std::size(buffer))
        throw std::runtime_error("Could not locate the application folder.");
    return fs::path(std::wstring(buffer, n)).parent_path();
}

fs::path choose_wav() {
    wchar_t file_name[32768] = {};
    OPENFILENAMEW ofn{};
    ofn.lStructSize = sizeof(ofn);
    ofn.lpstrFile = file_name;
    ofn.nMaxFile = static_cast<DWORD>(std::size(file_name));
    ofn.lpstrFilter = L"WAV audio (*.wav)\\0*.wav\\0All files (*.*)\\0*.*\\0";
    ofn.nFilterIndex = 1;
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;
    ofn.lpstrTitle = L"Select WAV audio to convert";
    if (GetOpenFileNameW(&ofn) == TRUE)
        return fs::path(file_name);
    return {};
}

void error_box(const std::string& message) {
    MessageBoxA(nullptr, message.c_str(), "VoiceChanger", MB_OK | MB_ICONERROR);
}

void info_box(const std::string& message) {
    MessageBoxA(nullptr, message.c_str(), "VoiceChanger", MB_OK | MB_ICONINFORMATION);
}

void check(dvc_status status) {
    if (status != DVC_OK) {
        const char* detail = dvc_last_error();
        throw std::runtime_error(detail ? detail : "RVC inference failed.");
    }
}

} // namespace

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
    try {
        const fs::path root = exe_dir();
        const fs::path models = root / "models";

        const fs::path voice = models / "GuraTalkV2.onnx";
        const fs::path content = models / "vec-768-layer-12.onnx";
        const fs::path pitch = models / "rmvpe.onnx";

        if (!fs::exists(voice) || !fs::exists(content) || !fs::exists(pitch)) {
            throw std::runtime_error(
                "Required ONNX models are missing.\\n\\n"
                "Expected:\\n" +
                voice.string() + "\\n" +
                content.string() + "\\n" +
                pitch.string());
        }

        const fs::path input = choose_wav();
        if (input.empty()) return 0;

        const fs::path output =
            input.parent_path() /
            (input.stem().string() + "_voicechanged.wav");

        if (fs::exists(output))
            fs::remove(output);

        Wave audio = read_wav(input);

        dvc_config config;
        dvc_default_config(&config);
        config.sample_rate = audio.rate;
        config.block_size = std::max<uint32_t>(320, audio.rate / 10);
        config.context_samples = audio.rate / 2;
        config.crossfade_samples = std::max<uint32_t>(1, audio.rate / 100);
        config.search_samples = std::max<uint32_t>(1, audio.rate / 200);
        config.threads = 0;

        dvc_context* raw = nullptr;
        check(dvc_create(&config, &raw));
        std::unique_ptr<dvc_context, decltype(&dvc_destroy)> context(raw, dvc_destroy);

        const std::string voice_utf8 = voice.u8string();
        const std::string content_utf8 = content.u8string();
        const std::string pitch_utf8 = pitch.u8string();

        dvc_model_config model;
        dvc_default_model_config(&model);
        model.voice_path = voice_utf8.c_str();
        model.content_path = content_utf8.c_str();
        model.pitch_path = pitch_utf8.c_str();
        model.sample_rate = 40000;
        model.feature_dimension = 768;
        model.speaker_count = 1;

        check(dvc_load_model(context.get(), &model));

        std::vector<float> output_samples(audio.samples.size());
        size_t written = 0;

        check(dvc_convert(
            context.get(),
            audio.samples.data(),
            audio.samples.size(),
            output_samples.data(),
            output_samples.size(),
            &written));

        output_samples.resize(written);
        audio.samples.swap(output_samples);
        write_wav(output, audio);

        info_box("Voice conversion complete.\\n\\nSaved to:\\n" + output.string());
        return 0;
    } catch (const std::exception& e) {
        error_box(e.what());
        return 1;
    } catch (...) {
        error_box("Unknown voice conversion error.");
        return 1;
    }
}
