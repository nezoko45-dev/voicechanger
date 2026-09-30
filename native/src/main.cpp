#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmsystem.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <filesystem>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include "dvc/dvc.h"

#pragma comment(lib, "winmm.lib")
namespace fs = std::filesystem;

struct DeviceInfo { UINT id; std::wstring name; };
static std::vector<DeviceInfo> input_devices() {
    std::vector<DeviceInfo> out;
    for (UINT i = 0; i < waveInGetNumDevs(); ++i) {
        WAVEINCAPSW c{};
        if (waveInGetDevCapsW(i, &c, sizeof(c)) == MMSYSERR_NOERROR) out.push_back({i, c.szPname});
    }
    return out;
}
static std::vector<DeviceInfo> output_devices() {
    std::vector<DeviceInfo> out;
    for (UINT i = 0; i < waveOutGetNumDevs(); ++i) {
        WAVEOUTCAPSW c{};
        if (waveOutGetDevCapsW(i, &c, sizeof(c)) == MMSYSERR_NOERROR) out.push_back({i, c.szPname});
    }
    return out;
}

class AudioEngine {
public:
    static constexpr uint32_t RATE = 48000;
    static constexpr uint32_t BLOCK = 4800; // 100 ms
    static constexpr size_t IN_BUFFERS = 8;
    static constexpr size_t BUFFER_SAMPLES = 2400;

    AudioEngine(dvc_context* ctx, UINT in_id, UINT out_id) : ctx_(ctx), in_id_(in_id), out_id_(out_id) {}

    bool run() {
        WAVEFORMATEX fmt{};
        fmt.wFormatTag = WAVE_FORMAT_PCM;
        fmt.nChannels = 1;
        fmt.nSamplesPerSec = RATE;
        fmt.wBitsPerSample = 16;
        fmt.nBlockAlign = 2;
        fmt.nAvgBytesPerSec = RATE * 2;

        WAVEHDR headers[IN_BUFFERS]{};
        std::vector<std::vector<int16_t>> buffers(IN_BUFFERS, std::vector<int16_t>(BUFFER_SAMPLES));
        if (waveInOpen(&in_, in_id_, &fmt, reinterpret_cast<DWORD_PTR>(&AudioEngine::in_callback), reinterpret_cast<DWORD_PTR>(this), CALLBACK_FUNCTION) != MMSYSERR_NOERROR) {
            std::cerr << "Could not open microphone at 48 kHz mono PCM.\n"; return false;
        }
        if (waveOutOpen(&out_, out_id_, &fmt, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) {
            std::cerr << "Could not open output at 48 kHz mono PCM.\n"; waveInClose(in_); in_ = nullptr; return false;
        }
        for (size_t i = 0; i < IN_BUFFERS; ++i) {
            headers[i].lpData = reinterpret_cast<LPSTR>(buffers[i].data());
            headers[i].dwBufferLength = static_cast<DWORD>(buffers[i].size() * sizeof(int16_t));
            waveInPrepareHeader(in_, &headers[i], sizeof(WAVEHDR));
            waveInAddBuffer(in_, &headers[i], sizeof(WAVEHDR));
        }
        running_ = true;
        if (waveInStart(in_) != MMSYSERR_NOERROR) { cleanup(headers); return false; }
        std::cout << "Running. Press ENTER to stop.\n";
        std::thread worker([this] { processing_loop(); });
        std::cin.get();
        running_ = false;
        cv_.notify_all();
        worker.join();
        waveInStop(in_);
        cleanup(headers);
        return true;
    }

private:
    static void CALLBACK in_callback(HWAVEIN, UINT msg, DWORD_PTR instance, DWORD_PTR p1, DWORD_PTR) {
        if (msg != WIM_DATA) return;
        auto* self = reinterpret_cast<AudioEngine*>(instance);
        auto* hdr = reinterpret_cast<WAVEHDR*>(p1);
        const size_t samples = hdr->dwBytesRecorded / sizeof(int16_t);
        {
            std::lock_guard<std::mutex> lock(self->mutex_);
            const auto* pcm = reinterpret_cast<const int16_t*>(hdr->lpData);
            for (size_t i = 0; i < samples; ++i) self->queue_.push_back(static_cast<float>(pcm[i]) / 32768.0f);
            const size_t max_samples = BLOCK * 3;
            while (self->queue_.size() > max_samples) self->queue_.pop_front();
        }
        self->cv_.notify_one();
        if (self->running_) waveInAddBuffer(self->in_, hdr, sizeof(WAVEHDR));
    }

    void processing_loop() {
        std::vector<float> input(BLOCK), output(BLOCK);
        while (running_) {
            {
                std::unique_lock<std::mutex> lock(mutex_);
                cv_.wait(lock, [&] { return !running_ || queue_.size() >= BLOCK; });
                if (!running_) break;
                for (float& v : input) { v = queue_.front(); queue_.pop_front(); }
            }
            size_t written = 0;
            const auto st = dvc_process(ctx_, input.data(), input.size(), output.data(), output.size(), &written);
            if (st != DVC_OK || written != output.size()) {
                std::cerr << "Voice conversion error: " << dvc_last_error() << "\n";
                continue;
            }
            auto* mem = new std::vector<int16_t>(written);
            for (size_t i = 0; i < written; ++i) (*mem)[i] = static_cast<int16_t>(std::clamp(output[i], -1.0f, 1.0f) * 32767.0f);
            auto* hdr = new WAVEHDR{};
            hdr->lpData = reinterpret_cast<LPSTR>(mem->data());
            hdr->dwBufferLength = static_cast<DWORD>(mem->size() * sizeof(int16_t));
            hdr->dwUser = reinterpret_cast<DWORD_PTR>(mem);
            waveOutPrepareHeader(out_, hdr, sizeof(WAVEHDR));
            if (waveOutWrite(out_, hdr, sizeof(WAVEHDR)) != MMSYSERR_NOERROR) {
                waveOutUnprepareHeader(out_, hdr, sizeof(WAVEHDR)); delete mem; delete hdr;
            } else {
                pending_.push_back({hdr, mem});
                reap_output();
            }
        }
        waveOutReset(out_);
        reap_output(true);
    }

    void reap_output(bool all = false) {
        for (size_t i = 0; i < pending_.size();) {
            auto [hdr, mem] = pending_[i];
            if (all || (hdr->dwFlags & WHDR_DONE)) {
                waveOutUnprepareHeader(out_, hdr, sizeof(WAVEHDR));
                delete mem; delete hdr;
                pending_.erase(pending_.begin() + static_cast<long>(i));
            } else ++i;
        }
    }

    void cleanup(WAVEHDR* headers) {
        if (in_) {
            waveInReset(in_);
            for (size_t i = 0; i < IN_BUFFERS; ++i) waveInUnprepareHeader(in_, &headers[i], sizeof(WAVEHDR));
            waveInClose(in_); in_ = nullptr;
        }
        if (out_) { waveOutReset(out_); reap_output(true); waveOutClose(out_); out_ = nullptr; }
    }

    dvc_context* ctx_{};
    UINT in_id_{}; UINT out_id_{};
    HWAVEIN in_{}; HWAVEOUT out_{};
    std::atomic<bool> running_{false};
    std::mutex mutex_; std::condition_variable cv_; std::deque<float> queue_;
    std::vector<std::pair<WAVEHDR*, std::vector<int16_t>*>> pending_;
};

static void print_devices() {
    std::wcout << L"\nINPUT DEVICES\n";
    for (auto& d : input_devices()) std::wcout << L"  " << d.id << L": " << d.name << L"\n";
    std::wcout << L"\nOUTPUT DEVICES\n";
    for (auto& d : output_devices()) std::wcout << L"  " << d.id << L": " << d.name << L"\n";
}

int wmain(int argc, wchar_t** argv) {
    std::wcout << L"Native RVC Voice Changer\nBackend: native ONNX Runtime / rvc-cpp\n\n";
    if (argc < 4) {
        std::wcout << L"Usage: voicechanger_host.exe <voice.onnx> <content.onnx> <rmvpe.onnx> [input_id] [output_id]\n";
        print_devices(); return 2;
    }
    UINT in_id = argc >= 5 ? static_cast<UINT>(_wtoi(argv[4])) : WAVE_MAPPER;
    UINT out_id = argc >= 6 ? static_cast<UINT>(_wtoi(argv[5])) : WAVE_MAPPER;

    dvc_config cfg{}; dvc_default_config(&cfg);
    cfg.sample_rate = AudioEngine::RATE;
    cfg.block_size = AudioEngine::BLOCK;
    cfg.context_samples = 24000;
    cfg.crossfade_samples = 480;
    cfg.search_samples = 240;
    cfg.threads = std::max(1u, std::thread::hardware_concurrency() / 2);

    dvc_context* ctx = nullptr;
    auto st = dvc_create(&cfg, &ctx);
    if (st != DVC_OK) { std::cerr << "dvc_create failed: " << dvc_last_error() << "\n"; return 3; }

    dvc_model_config model{}; dvc_default_model_config(&model);
    std::string voice = fs::path(argv[1]).string();
    std::string content = fs::path(argv[2]).string();
    std::string pitch = fs::path(argv[3]).string();
    model.voice_path = voice.c_str(); model.content_path = content.c_str(); model.pitch_path = pitch.c_str();
    model.sample_rate = 40000; model.feature_dimension = 768; model.speaker_count = 1;

    st = dvc_load_model(ctx, &model);
    if (st != DVC_OK) { std::cerr << "Model load failed: " << dvc_last_error() << "\n"; dvc_destroy(ctx); return 4; }
    std::cout << "Voice model loaded.\n";
    AudioEngine audio(ctx, in_id, out_id);
    const bool ok = audio.run();
    dvc_destroy(ctx);
    return ok ? 0 : 5;
}
EOF
