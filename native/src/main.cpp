#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmsystem.h>
#include <algorithm>
#include <atomic>
#include <condition_variable>
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

static void list_devices() {
    std::wcout << L"INPUT DEVICES\n";
    for (UINT i = 0; i < waveInGetNumDevs(); ++i) {
        WAVEINCAPSW c{};
        if (waveInGetDevCapsW(i, &c, sizeof(c)) == MMSYSERR_NOERROR)
            std::wcout << L"  " << i << L": " << c.szPname << L"\n";
    }
    std::wcout << L"\nOUTPUT DEVICES\n";
    for (UINT i = 0; i < waveOutGetNumDevs(); ++i) {
        WAVEOUTCAPSW c{};
        if (waveOutGetDevCapsW(i, &c, sizeof(c)) == MMSYSERR_NOERROR)
            std::wcout << L"  " << i << L": " << c.szPname << L"\n";
    }
}

class AudioHost {
public:
    static constexpr uint32_t RATE = 48000;
    static constexpr uint32_t BLOCK = 4800;
    static constexpr size_t INPUT_BUFFERS = 8;
    static constexpr size_t INPUT_SAMPLES = 2400;

    AudioHost(dvc_context* c, UINT in_id, UINT out_id) : ctx(c), in_id(in_id), out_id(out_id) {}

    bool start() {
        WAVEFORMATEX f{};
        f.wFormatTag = WAVE_FORMAT_PCM;
        f.nChannels = 1;
        f.nSamplesPerSec = RATE;
        f.wBitsPerSample = 16;
        f.nBlockAlign = 2;
        f.nAvgBytesPerSec = RATE * 2;

        if (waveInOpen(&in, in_id, &f, reinterpret_cast<DWORD_PTR>(&AudioHost::capture_cb), reinterpret_cast<DWORD_PTR>(this), CALLBACK_FUNCTION) != MMSYSERR_NOERROR) {
            std::cerr << "Could not open microphone.\n";
            return false;
        }
        if (waveOutOpen(&out, out_id, &f, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) {
            std::cerr << "Could not open output.\n";
            waveInClose(in); in = nullptr; return false;
        }

        buffers.resize(INPUT_BUFFERS);
        headers.resize(INPUT_BUFFERS);
        for (size_t i = 0; i < INPUT_BUFFERS; ++i) {
            buffers[i].resize(INPUT_SAMPLES);
            headers[i].lpData = reinterpret_cast<LPSTR>(buffers[i].data());
            headers[i].dwBufferLength = static_cast<DWORD>(buffers[i].size() * sizeof(int16_t));
            waveInPrepareHeader(in, &headers[i], sizeof(WAVEHDR));
            waveInAddBuffer(in, &headers[i], sizeof(WAVEHDR));
        }

        running = true;
        if (waveInStart(in) != MMSYSERR_NOERROR) { stop(); return false; }
        std::cout << "Running. Press ENTER to stop.\n";
        worker = std::thread([this] { process_loop(); });
        std::cin.get();
        running = false;
        cv.notify_all();
        if (worker.joinable()) worker.join();
        stop();
        return true;
    }

private:
    static void CALLBACK capture_cb(HWAVEIN, UINT msg, DWORD_PTR user, DWORD_PTR p1, DWORD_PTR) {
        if (msg != WIM_DATA) return;
        auto* self = reinterpret_cast<AudioHost*>(user);
        auto* h = reinterpret_cast<WAVEHDR*>(p1);
        const auto* pcm = reinterpret_cast<const int16_t*>(h->lpData);
        const size_t n = h->dwBytesRecorded / sizeof(int16_t);
        {
            std::lock_guard<std::mutex> lock(self->mutex);
            for (size_t i = 0; i < n; ++i) self->queue.push_back(static_cast<float>(pcm[i]) / 32768.0f);
            while (self->queue.size() > BLOCK * 3) self->queue.pop_front();
        }
        self->cv.notify_one();
        if (self->running) waveInAddBuffer(self->in, h, sizeof(WAVEHDR));
    }

    void process_loop() {
        std::vector<float> input(BLOCK), output(BLOCK);
        while (running) {
            {
                std::unique_lock<std::mutex> lock(mutex);
                cv.wait(lock, [&] { return !running || queue.size() >= BLOCK; });
                if (!running) break;
                for (float& v : input) { v = queue.front(); queue.pop_front(); }
            }

            size_t written = 0;
            const auto status = dvc_process(ctx, input.data(), input.size(), output.data(), output.size(), &written);
            if (status != DVC_OK || written != output.size()) {
                std::cerr << "Conversion error: " << dvc_last_error() << "\n";
                continue;
            }

            auto* pcm = new std::vector<int16_t>(written);
            for (size_t i = 0; i < written; ++i)
                (*pcm)[i] = static_cast<int16_t>(std::clamp(output[i], -1.0f, 1.0f) * 32767.0f);

            auto* h = new WAVEHDR{};
            h->lpData = reinterpret_cast<LPSTR>(pcm->data());
            h->dwBufferLength = static_cast<DWORD>(pcm->size() * sizeof(int16_t));
            h->dwUser = reinterpret_cast<DWORD_PTR>(pcm);
            waveOutPrepareHeader(out, h, sizeof(WAVEHDR));
            if (waveOutWrite(out, h, sizeof(WAVEHDR)) != MMSYSERR_NOERROR) {
                waveOutUnprepareHeader(out, h, sizeof(WAVEHDR));
                delete pcm; delete h;
            } else {
                pending.push_back({h, pcm});
                reap(false);
            }
        }
        waveOutReset(out);
        reap(true);
    }

    void reap(bool all) {
        for (size_t i = 0; i < pending.size();) {
            auto [h, pcm] = pending[i];
            if (all || (h->dwFlags & WHDR_DONE)) {
                waveOutUnprepareHeader(out, h, sizeof(WAVEHDR));
                delete pcm; delete h;
                pending.erase(pending.begin() + static_cast<long>(i));
            } else ++i;
        }
    }

    void stop() {
        running = false;
        if (in) {
            waveInReset(in);
            for (auto& h : headers) waveInUnprepareHeader(in, &h, sizeof(WAVEHDR));
            waveInClose(in); in = nullptr;
        }
        if (out) {
            waveOutReset(out);
            reap(true);
            waveOutClose(out); out = nullptr;
        }
    }

    dvc_context* ctx;
    UINT in_id, out_id;
    HWAVEIN in{}; HWAVEOUT out{};
    std::atomic<bool> running{false};
    std::mutex mutex;
    std::condition_variable cv;
    std::deque<float> queue;
    std::thread worker;
    std::vector<std::vector<int16_t>> buffers;
    std::vector<WAVEHDR> headers;
    std::vector<std::pair<WAVEHDR*, std::vector<int16_t>*>> pending;
};

int wmain(int argc, wchar_t** argv) {
    std::wcout << L"Native RVC Voice Changer\n";
    if (argc < 4) {
        std::wcout << L"Usage: voicechanger_host.exe <voice.onnx> <content.onnx> <rmvpe.onnx> [input_id] [output_id]\n\n";
        list_devices();
        return 2;
    }

    const UINT in_id = argc >= 5 ? static_cast<UINT>(_wtoi(argv[4])) : WAVE_MAPPER;
    const UINT out_id = argc >= 6 ? static_cast<UINT>(_wtoi(argv[5])) : WAVE_MAPPER;

    dvc_config cfg{};
    dvc_default_config(&cfg);
    cfg.sample_rate = AudioHost::RATE;
    cfg.block_size = AudioHost::BLOCK;
    cfg.context_samples = 24000;
    cfg.crossfade_samples = 480;
    cfg.search_samples = 240;
    cfg.threads = std::max(1u, std::thread::hardware_concurrency() / 2);

    dvc_context* ctx = nullptr;
    auto status = dvc_create(&cfg, &ctx);
    if (status != DVC_OK) {
        std::cerr << "dvc_create failed: " << dvc_last_error() << "\n";
        return 3;
    }

    dvc_model_config model{};
    dvc_default_model_config(&model);
    const std::string voice = fs::path(argv[1]).string();
    const std::string content = fs::path(argv[2]).string();
    const std::string pitch = fs::path(argv[3]).string();
    model.voice_path = voice.c_str();
    model.content_path = content.c_str();
    model.pitch_path = pitch.c_str();
    model.sample_rate = 40000;
    model.feature_dimension = 768;
    model.speaker_count = 1;

    status = dvc_load_model(ctx, &model);
    if (status != DVC_OK) {
        std::cerr << "Model load failed: " << dvc_last_error() << "\n";
        dvc_destroy(ctx);
        return 4;
    }

    std::cout << "Voice model loaded.\n";
    AudioHost host(ctx, in_id, out_id);
    const bool ok = host.start();
    dvc_destroy(ctx);
    return ok ? 0 : 5;
}
