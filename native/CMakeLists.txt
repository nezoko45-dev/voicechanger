cmake_minimum_required(VERSION 3.24)
project(native_voicechanger LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(DVC_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

include(FetchContent)
FetchContent_Declare(
  rvc_cpp
  GIT_REPOSITORY https://github.com/VoiceLala/rvc-cpp.git
  GIT_TAG main
)
FetchContent_MakeAvailable(rvc_cpp)

# rvc-cpp's dvc target is the actual native RVC inference DLL.
set_target_properties(dvc PROPERTIES OUTPUT_NAME "voicechanger")

add_executable(voicechanger_host src/main.cpp)
target_include_directories(voicechanger_host PRIVATE ${rvc_cpp_SOURCE_DIR}/include)
target_link_libraries(voicechanger_host PRIVATE dvc winmm)
target_compile_definitions(voicechanger_host PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)

if(MSVC)
  target_compile_options(voicechanger_host PRIVATE /W4 /EHsc /utf-8)
endif()

add_custom_command(TARGET voicechanger_host POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          "$<TARGET_FILE:dvc>"
          "$<TARGET_FILE_DIR:voicechanger_host>/voicechanger.dll")

install(TARGETS voicechanger_host dvc RUNTIME DESTINATION bin LIBRARY DESTINATION bin ARCHIVE DESTINATION lib)
