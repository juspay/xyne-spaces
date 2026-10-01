{
  description = "Xyne Spaces - Workflow Automation Platform";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    pyproject-nix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    pyproject-build-systems = {
      url = "github:pyproject-nix/build-system-pkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.uv2nix.follows = "uv2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    flake-parts.url = "github:hercules-ci/flake-parts";
    services-flake.url = "github:juspay/services-flake";
    process-compose-flake.url = "github:Platonic-Systems/process-compose-flake";
  };

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        inputs.process-compose-flake.flakeModule
      ];

      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];

      # **NOTE**: Edit project.nix for all configuration!
      perSystem = { system, ... }: {
        _module.args.pkgs = import inputs.nixpkgs {
          inherit system;
          overlays = [
            (_final: prev: {
              # Keep packageManager unchanged until the separate pnpm 12 migration.
              pnpm = prev.pnpm_10.override {
                version = "10.15.0";
                hash = "sha256-hMGeeI19fuJI5Ka3FS+Ou6D0/nOApfRDyhfXbAMAUtI=";
                nodejs-slim = prev.nodejs_22;
              };
            })
          ];
        };
        _module.args.flakeInputs = inputs;
        imports = [ ./project.nix ];
      };
    };
}
