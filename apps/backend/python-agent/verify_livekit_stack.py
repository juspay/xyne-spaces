"""Fail fast when the tested LiveKit package set or required APIs drift."""

import inspect
from importlib.metadata import version

from livekit.agents import AgentSession, StopResponse, WorkerOptions, stt
from livekit.agents.voice import room_io
from livekit.plugins import deepgram, google, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel


EXPECTED_VERSIONS = {
    "livekit": "1.1.14",
    "livekit-agents": "1.6.8",
    "livekit-plugins-turn-detector": "1.6.8",
    "livekit-plugins-silero": "1.6.8",
    "livekit-plugins-openai": "1.6.8",
    "livekit-plugins-google": "1.6.8",
    "livekit-plugins-deepgram": "1.6.8",
}


def _require_parameters(callable_object, *names: str) -> None:
    parameters = inspect.signature(callable_object).parameters
    missing = [name for name in names if name not in parameters]
    if missing:
        raise RuntimeError(
            f"{callable_object.__qualname__} is missing required parameters: {missing}"
        )


def verify() -> None:
    actual = {package: version(package) for package in EXPECTED_VERSIONS}
    mismatches = {
        package: {"expected": expected, "actual": actual[package]}
        for package, expected in EXPECTED_VERSIONS.items()
        if actual[package] != expected
    }
    if mismatches:
        raise RuntimeError(f"LiveKit package version mismatch: {mismatches}")

    if not issubclass(StopResponse, Exception):
        raise RuntimeError("StopResponse must remain an exception class")

    _require_parameters(AgentSession, "stt", "vad", "llm", "tts")
    _require_parameters(AgentSession.start, "agent", "room", "room_options")
    _require_parameters(AgentSession.interrupt, "force")
    _require_parameters(AgentSession.generate_reply, "user_input")
    _require_parameters(WorkerOptions, "entrypoint_fnc", "shutdown_process_timeout")
    _require_parameters(stt.STT.recognize, "buffer", "language", "conn_options")
    _require_parameters(room_io.RoomOptions, "audio_input", "audio_output")
    _require_parameters(
        room_io.AudioInputOptions,
        "sample_rate",
        "num_channels",
        "frame_size_ms",
        "auto_gain_control",
    )
    if not hasattr(room_io.RoomIO, "wait_for_ready"):
        raise RuntimeError("RoomIO.wait_for_ready is required for participant sessions")
    _require_parameters(silero.VAD.load, "activation_threshold", "min_silence_duration")
    _require_parameters(deepgram.STT, "api_key", "model", "keyterms")
    _require_parameters(google.STT, "credentials_file", "model", "languages")
    _require_parameters(openai.STT.with_azure, "azure_endpoint", "azure_deployment")
    inspect.signature(MultilingualModel)

    print(f"LiveKit compatibility check passed: {actual}")


if __name__ == "__main__":
    verify()
