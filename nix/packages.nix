# Custom Nix packages for xyne-spaces
{ pkgs, lib }:
{
  # Y-Sweet server built from source
  y-sweet = pkgs.rustPlatform.buildRustPackage rec {
    pname = "y-sweet";
    version = "0-unstable-221d5af";

    src = pkgs.fetchFromGitHub {
      owner = "juspay";
      repo = "y-sweet";
      rev = "221d5afd7dd0504ed75e6dbdc798fba303a65e32";
      hash = "sha256-oDDWdEhNx4afDa1Uo3FlpVm6x8M7l4n+De3qFk5M32U=";
    };

    cargoHash = "sha256-uA5QFEdfYtpLwTLGAbcQ/itSEbW0bw5BRJDWO5r/8mo=";

    # Build only the y-sweet server binary
    sourceRoot = "${src.name}/crates";
    buildAndTestSubdir = "y-sweet";
    nativeBuildInputs = [ pkgs.pkg-config ];
    buildInputs = [ pkgs.openssl ];

    meta = with lib; {
      description = "A standalone yjs server with persistence to S3 or filesystem";
      homepage = "https://github.com/juspay/y-sweet";
      license = licenses.mit;
      maintainers = [ ];
      mainProgram = "y-sweet";
    };
  };

}
