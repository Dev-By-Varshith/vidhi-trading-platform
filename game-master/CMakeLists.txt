cmake_minimum_required(VERSION 3.18)
project(vidhi-gm VERSION 5.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ─── Release build flags (bare-metal performance) ─────────────────────────
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -march=x86-64 -flto -funroll-loops -fno-omit-frame-pointer")

# ─── Detect Emscripten (set by emcmake) ───────────────────────────────────
if(EMSCRIPTEN)
    message(STATUS "Building for WebAssembly (Emscripten)")

    # Browser-phase WASM module
    # Build:  emcmake cmake .. && emmake make -j4
    add_executable(vidhi-gm-wasm
        main.cpp
    )
    target_include_directories(vidhi-gm-wasm PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_compile_definitions(vidhi-gm-wasm PRIVATE WASM_BUILD=1)

    # Emscripten link flags
    # EXPORTED_FUNCTIONS: C symbols accessible from JS
    # ALLOW_MEMORY_GROWTH: allow heap to grow (needed for large LOB)
    # ENVIRONMENT: web,worker — target browser Web Worker
    target_link_options(vidhi-gm-wasm PRIVATE
        -sWASM=1
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=67108864       # 64MB initial heap
        -sMAXIMUM_MEMORY=1073741824     # 1GB max
        -sENVIRONMENT=worker
        -sEXPORTED_FUNCTIONS=['_run_simulation_wasm','_get_result_json','_malloc','_free']
        -sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString']
        -sNO_FILESYSTEM=0               # Need FS for Arrow mmap
        -sSINGLE_FILE=0                 # Separate .wasm + .js glue
        --no-entry
        -O3
    )
    set_target_properties(vidhi-gm-wasm PROPERTIES
        OUTPUT_NAME "vidhi-gm"
        SUFFIX ".js"
    )

else()
    # ─── Native Linux executable ───────────────────────────────────────────
    add_executable(vidhi-gm
        main.cpp
    )
    target_include_directories(vidhi-gm PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

    target_link_libraries(vidhi-gm
        PRIVATE
        dl      # dlopen/dlsym for contestant .so loading
        pthread # watchdog thread
        m       # math (sqrt, log for GBM signal)
    )

    target_compile_options(vidhi-gm PRIVATE
        -Wall -Wextra
        -Wno-unused-parameter
        -march=x86-64
    )

    # ─── Deep Ultrathink: Profile-Guided Optimization (PGO) ────────────────
    # Step 1: Generate profiling build
    add_custom_target(pgo-train
        COMMAND ${CMAKE_COMMAND} -E echo "Rebuilding with -fprofile-generate..."
        COMMAND ${CMAKE_COMMAND} -DCMAKE_CXX_FLAGS="-fprofile-generate -O3 -march=x86-64" .
        COMMAND ${CMAKE_MAKE_PROGRAM} vidhi-gm
        COMMAND ${CMAKE_COMMAND} -E echo "Running 1M tick warmup to train branch predictor..."
        COMMAND ./vidhi-gm --ticks 1000000 --dataset ../data/ticks/public_99k.bin
        COMMAND ${CMAKE_COMMAND} -E echo "Rebuilding with -fprofile-use to lock in LOB probabilities..."
        COMMAND ${CMAKE_COMMAND} -DCMAKE_CXX_FLAGS="-fprofile-use -fprofile-correction -O3 -march=x86-64 -flto" .
        COMMAND ${CMAKE_MAKE_PROGRAM} vidhi-gm
        COMMAND ${CMAKE_COMMAND} -E echo "PGO complete. Engine is perfectly matched to LOB branch behavior."
        WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    )

    # ─── C++ Unit Tests (Catch2) ───────────────────────────────────────────
    enable_testing()
    add_executable(vidhi-tests
        tests/test_persistent_lob.cpp
    )
    target_include_directories(vidhi-tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_compile_options(vidhi-tests PRIVATE -Wall -Wextra -std=c++20)
    add_test(NAME vidhi_unit_tests COMMAND vidhi-tests)

    install(TARGETS vidhi-gm RUNTIME DESTINATION /usr/local/bin)
endif()

# ─── Build type ───────────────────────────────────────────────────────────
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

message(STATUS "Build type    : ${CMAKE_BUILD_TYPE}")
message(STATUS "Emscripten    : ${EMSCRIPTEN}")
message(STATUS "CXX flags     : ${CMAKE_CXX_FLAGS_RELEASE}")

# ─── Install dataset ──────────────────────────────────────────────────────
# Copy public tick dataset alongside the binary
install(DIRECTORY ../data/ticks/ DESTINATION share/vidhi/ticks
        FILES_MATCHING PATTERN "*.bin" PATTERN "*.arrow")
