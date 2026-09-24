cmake_minimum_required(VERSION 3.24)
project(VoiceChangerNative LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

set(ONNXRUNTIME_ROOT "" CACHE PATH "ONNX Runtime SDK root")
if(NOT ONNXRUNTIME_ROOT)
  message(FATAL_ERROR "ONNXRUNTIME_ROOT must point to an extracted ONNX Runtime SDK")
endif()

set(RVC_CPP_ROOT "" CACHE PATH "RVC.cpp source root")
if(NOT RVC_CPP_ROOT)
  set(RVC_CPP_ROOT "\${CMAKE_CURRENT_SOURCE_DIR}/third_party/rvc-cpp")
endif()

if(NOT EXISTS "\${RVC_CPP_ROOT}/CMakeLists.txt")
  message(FATAL_ERROR "rvc-cpp source is missing")
endif()

set(DVC_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(DVC_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(DVC_ENABLE_DIRECTML OFF CACHE BOOL "" FORCE)

add_subdirectory("\${RVC_CPP_ROOT}" "\${CMAKE_BINARY_DIR}/rvc-cpp-build" EXCLUDE_FROM_ALL)

add_executable(VoiceChanger src/main.cpp)
target_compile_features(VoiceChanger PRIVATE cxx_std_17)
target_link_libraries(VoiceChanger PRIVATE dvc)

if(MSVC)
  target_compile_options(VoiceChanger PRIVATE /W4 /utf-8 /EHsc)
  target_link_options(VoiceChanger PRIVATE /SUBSYSTEM:WINDOWS)
endif()

if(WIN32)
  target_link_libraries(VoiceChanger PRIVATE comdlg32)
endif()

add_custom_command(TARGET VoiceChanger POST_BUILD
  COMMAND \${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:VoiceChanger>/models"
  COMMAND \${CMAKE_COMMAND} -E copy_if_different
    "$<TARGET_FILE:dvc>"
    "$<TARGET_FILE_DIR:VoiceChanger>"
  COMMAND \${CMAKE_COMMAND} -E copy_if_different
    "\${ONNXRUNTIME_ROOT}/lib/onnxruntime.dll"
    "$<TARGET_FILE_DIR:VoiceChanger>"
)
