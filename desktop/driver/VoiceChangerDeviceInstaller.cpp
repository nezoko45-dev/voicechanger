#define UNICODE
#define _UNICODE
#include <windows.h>
#include <setupapi.h>
#include <newdev.h>
#include <strsafe.h>
#include <stdio.h>

#pragma comment(lib, "setupapi.lib")
#pragma comment(lib, "newdev.lib")

#ifndef MAX_CLASS_NAME_LEN
#define MAX_CLASS_NAME_LEN 256
#endif

static const wchar_t* kHardwareId = L"ROOT\\VirtualAudioDriver";

int wmain(int argc, wchar_t** argv) {
    if (argc < 2) {
        fwprintf(stderr, L"Usage: VoiceChangerDeviceInstaller.exe <full-path-to-inf>\n");
        return 2;
    }

    const wchar_t* infPath = argv[1];
    GUID classGuid{};
    wchar_t className[MAX_CLASS_NAME_LEN]{};

    if (!SetupDiGetINFClassW(infPath, &classGuid, className, ARRAYSIZE(className), nullptr)) {
        fwprintf(stderr, L"SetupDiGetINFClass failed: %lu\n", GetLastError());
        return 10;
    }

    HDEVINFO infoSet = SetupDiCreateDeviceInfoList(&classGuid, nullptr);
    if (infoSet == INVALID_HANDLE_VALUE) {
        fwprintf(stderr, L"SetupDiCreateDeviceInfoList failed: %lu\n", GetLastError());
        return 11;
    }

    SP_DEVINFO_DATA infoData{};
    infoData.cbSize = sizeof(infoData);

    BOOL created = SetupDiCreateDeviceInfoW(
        infoSet,
        className,
        &classGuid,
        nullptr,
        nullptr,
        DICD_GENERATE_ID,
        &infoData
    );

    if (!created) {
        DWORD err = GetLastError();
        if (err != ERROR_DEVINST_ALREADY_EXISTS) {
            fwprintf(stderr, L"SetupDiCreateDeviceInfo failed: %lu\n", err);
            SetupDiDestroyDeviceInfoList(infoSet);
            return 12;
        }
        wprintf(L"VoiceChanger root device already exists.\n");
    } else {
        wchar_t hardwareIds[] = L"ROOT\\VirtualAudioDriver\0\0";
        if (!SetupDiSetDeviceRegistryPropertyW(
                infoSet,
                &infoData,
                SPDRP_HARDWAREID,
                reinterpret_cast<const BYTE*>(hardwareIds),
                static_cast<DWORD>(sizeof(hardwareIds)))) {
            fwprintf(stderr, L"SetupDiSetDeviceRegistryProperty failed: %lu\n", GetLastError());
            SetupDiDestroyDeviceInfoList(infoSet);
            return 13;
        }

        if (!SetupDiCallClassInstaller(DIF_REGISTERDEVICE, infoSet, &infoData)) {
            fwprintf(stderr, L"SetupDiCallClassInstaller(DIF_REGISTERDEVICE) failed: %lu\n", GetLastError());
            SetupDiDestroyDeviceInfoList(infoSet);
            return 14;
        }
        wprintf(L"VoiceChanger ROOT device created.\n");
    }

    SetupDiDestroyDeviceInfoList(infoSet);

    BOOL rebootRequired = FALSE;
    if (!UpdateDriverForPlugAndPlayDevicesW(
            nullptr,
            kHardwareId,
            infPath,
            INSTALLFLAG_FORCE | INSTALLFLAG_NONINTERACTIVE,
            &rebootRequired)) {
        fwprintf(stderr, L"UpdateDriverForPlugAndPlayDevices failed: %lu\n", GetLastError());
        return 15;
    }

    wprintf(L"VoiceChanger driver attached successfully. RebootRequired=%d\n", rebootRequired ? 1 : 0);
    return rebootRequired ? 3010 : 0;
}
