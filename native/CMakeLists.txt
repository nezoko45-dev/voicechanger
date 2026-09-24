cmake_minimum_required(VERSION 3.20)
project(VoiceChangerNative LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded\$\<$<CONFIG:Debug>:Debug>")

set(ONNXRUNTIME_ROOT "" CACHE PATH "ONNX Runtime SDK root")
if(NOT ONNXRUNTIME_ROOT)
  message(FATAL_ERROR "ONNXRUNTIME_ROOT must point to the extracted ONNX Runtime SDK")
endif()

find_path(ORT_INCLUDE_DIR onnxruntime_cxx_api.h
  HINTS "\${ONNXRUNTIME_ROOT}/include"
  REQUIRED)

find_library(ORT_LIBRARY onnxruntime
  HINTS "\${ONNXRUNTIME_ROOT}/lib"
  REQUIRED)

add_executable(VoiceChanger src/main.cpp)

target_include_directories(VoiceChanger PRIVATE "\${ORT_INCLUDE_DIR}")
target_link_libraries(VoiceChanger PRIVATE "\${ORT_LIBRARY}" ole32 comdlg32)

if(MSVC)
  target_compile_options(VoiceChanger PRIVATE /W4 /utf-8 /EHsc)
  target_link_options(VoiceChanger PRIVATE /SUBSYSTEM:WINDOWS)
endif()

add_custom_command(TARGET VoiceChanger POST_BUILD
  COMMAND \${CMAKE_COMMAND} -E copy_if_different
    "\${ONNXRUNTIME_ROOT}/lib/onnxruntime.dll"
    "$<TARGET_FILE_DIR:VoiceChanger>/onnxruntime.dll")
