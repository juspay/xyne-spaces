# The base transcription dependencies only; diarization remains a Docker opt-in.
{ pkgs, lib, flakeInputs }:
let
  workspace = flakeInputs.uv2nix.lib.workspace.loadWorkspace {
    workspaceRoot = ../apps/backend/python-agent;
  };
  pythonSet = (pkgs.callPackage flakeInputs.pyproject-nix.build.packages {
    python = pkgs.python311;
  }).overrideScope (lib.composeManyExtensions [
    flakeInputs.pyproject-build-systems.overlays.wheel
    (workspace.mkPyprojectOverlay { sourcePreference = "wheel"; })
  ]);
in
pythonSet.mkVirtualEnv "transcription-agent-env" workspace.deps.default
