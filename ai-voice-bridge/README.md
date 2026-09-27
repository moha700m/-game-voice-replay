# AI Voice Bridge (MVP 0.1)

Windows utility for an echo-free software-only audio bridge between **Phone Link (or another Windows call app)** and **ChatGPT Voice**.

## Routing

- Cable A: call audio -> ChatGPT microphone
- Cable B: ChatGPT output -> call microphone

The two paths are isolated so the caller's own voice is not routed back to them.

## Required once

Windows needs two virtual audio endpoint pairs to present application audio as microphone devices. This repository does not redistribute third-party audio drivers. A compatible option is VB-Audio Cable A+B installed separately from the vendor.

## Four steps

1. Phone Link Speaker/Output -> CABLE-A Input
2. ChatGPT Microphone/Input -> CABLE-A Output
3. ChatGPT Speaker/Output -> CABLE-B Input
4. Phone Link Microphone/Input -> CABLE-B Output

Then open AI Voice Bridge, choose CABLE-A Output, CABLE-B Output, and your physical headphones/speakers, then press **ابدأ الجسر**.

## Build

Run build.bat on Windows 10/11 with Python 3.12 installed. GitHub Actions also builds a one-file Windows EXE artifact.

## Production note

A completely self-contained build with no separately-installed virtual audio driver requires a signed Windows virtual audio driver. Microsoft's SysVAD sample is the correct architecture reference for that later phase.
