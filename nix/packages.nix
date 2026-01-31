# Custom Nix packages for xyne-spaces
{ pkgs, lib }:
{
  # Y-Sweet server built from source
  y-sweet = pkgs.rustPlatform.buildRustPackage rec {
    pname = "y-sweet";
    version = "0.4.1";

    src = pkgs.fetchFromGitHub {
      owner = "jamsocket";
      repo = "y-sweet";
      rev = "v${version}";
      hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; # Will be replaced after first build
    };

    cargoHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; # Will be replaced after first build

    # Build only the y-sweet server binary
    buildAndTestSubdir = "crates/y-sweet";

    meta = with lib; {
      description = "A standalone yjs server with persistence to S3 or filesystem";
      homepage = "https://github.com/jamsocket/y-sweet";
      license = licenses.mit;
      maintainers = [ ];
      mainProgram = "y-sweet";
    };
  };

  # Python environment for transcription agent
  transcription-agent-env = pkgs.python3.withPackages (ps: with ps; [
    # Core dependencies (adjust based on requirements.txt)
    aiohttp
    redis
    # Add other dependencies as needed
  ]);
}
