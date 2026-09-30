#include "voicechanger.h"
#include <windows.h>
#include <string>
#include <vector>
#include <sstream>

static thread_local std::wstring g_error;

static std::wstring quote_arg(const wchar_t* s) {
    std::wstring out = L"\"";
    if (s) {
        for (const wchar_t* p = s; *p; ++p) {
            if (*p == L'\"') out += L'\\';
            out += *p;
        }
    }
    out += L"\"";
    return out;
}

static std::wstring exe_dir() {
    wchar_t path[MAX_PATH]{};
    DWORD n = GetModuleFileNameW(nullptr, path, MAX_PATH);
    if (!n || n >= MAX_PATH) return L".";
    std::wstring p(path, n);
    size_t slash = p.find_last_of(L"\\/");
    return slash == std::wstring::npos ? L"." : p.substr(0, slash);
}

static int run_process(const std::wstring& args) {
    std::wstring exe = exe_dir() + L"\\vc-rs.exe";
    if (GetFileAttributesW(exe.c_str()) == INVALID_FILE_ATTRIBUTES) {
        g_error = L"vc-rs.exe was not found beside the DLL/host.";
        return 2;
    }

    std::wstring cmd = quote_arg(exe.c_str()) + L" " + args;
    std::vector<wchar_t> buffer(cmd.begin(), cmd.end());
    buffer.push_back(L'\0');

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_SHOW;

    if (!CreateProcessW(nullptr, buffer.data(), nullptr, nullptr, FALSE,
                        CREATE_UNICODE_ENVIRONMENT, nullptr, exe_dir().c_str(),
                        &si, &pi)) {
        std::wstringstream ss;
        ss << L"CreateProcessW failed. Win32 error " << GetLastError();
        g_error = ss.str();
        return 3;
    }

    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD code = 1;
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);

    if (code != 0) {
        std::wstringstream ss;
        ss << L"vc-rs.exe exited with code " << code;
        g_error = ss.str();
    }
    return static_cast<int>(code);
}

extern "C" __declspec(dllexport) int VC_ConvertWav(
    const wchar_t* input_wav,
    const wchar_t* output_wav,
    const wchar_t* rvc_model,
    const wchar_t* embedder_model,
    const wchar_t* f0_model,
    const wchar_t* provider,
    float pitch_shift,
    int speaker_id) {

    if (!input_wav || !output_wav || !rvc_model || !embedder_model || !f0_model) {
        g_error = L"Missing input, output, RVC model, embedder, or F0 model path.";
        return 1;
    }

    std::wstringstream a;
    a << L"wav"
      << L" --model " << quote_arg(rvc_model)
      << L" --embedder " << quote_arg(embedder_model)
      << L" --f0-model " << quote_arg(f0_model)
      << L" --input " << quote_arg(input_wav)
      << L" --output " << quote_arg(output_wav)
      << L" --provider " << quote_arg(provider ? provider : L"windowsml")
      << L" --pitch-shift " << pitch_shift
      << L" --speaker-id " << speaker_id;

    return run_process(a.str());
}

extern "C" __declspec(dllexport) int VC_RunRealtime(
    const wchar_t* rvc_model,
    const wchar_t* embedder_model,
    const wchar_t* f0_model,
    const wchar_t* input_device,
    const wchar_t* output_device,
    const wchar_t* provider,
    int chunk_ms,
    int extra_convert_ms,
    float pitch_shift,
    int speaker_id) {

    if (!rvc_model || !embedder_model || !f0_model || !input_device || !output_device) {
        g_error = L"Missing model, device, embedder, or F0 path.";
        return 1;
    }

    std::wstringstream a;
    a << L"run"
      << L" --model " << quote_arg(rvc_model)
      << L" --embedder " << quote_arg(embedder_model)
      << L" --f0-model " << quote_arg(f0_model)
      << L" --input " << quote_arg(input_device)
      << L" --output " << quote_arg(output_device)
      << L" --provider " << quote_arg(provider ? provider : L"windowsml")
      << L" --chunk-ms " << chunk_ms
      << L" --extra-convert-ms " << extra_convert_ms
      << L" --pitch-shift " << pitch_shift
      << L" --speaker-id " << speaker_id
      << L" --audio-backend wasapi";

    return run_process(a.str());
}

extern "C" __declspec(dllexport) const wchar_t* VC_GetLastErrorMessage(void) {
    return g_error.c_str();
}
