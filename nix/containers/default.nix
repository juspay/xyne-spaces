# Containers module for process-compose
# This module provides a declarative interface for running containers via podman
# as process-compose processes.
#
# Usage in flake.nix:
#   process-compose."my-services" = {
#     imports = [ ./nix/containers ];
#
#     containers.myapp = {
#       enable = true;
#       image = "myapp/server";
#       tag = "v1.0.0";
#       imageDigest = "sha256:...";
#       sha256 = "sha256-...";
#       ports = [ "8080:8080" ];
#       environment = { LOG_LEVEL = "info"; };
#     };
#   };
{ config, pkgs, lib, ... }:
{
  options = {
    containers = lib.mkOption {
      description = ''
        Container services to run via podman.

        Each container is defined as an attribute set with configuration options
        for the image, ports, environment variables, etc.

        The containers are automatically converted to process-compose processes
        with proper dependency management and health checks.
      '';
      default = { };
      type = lib.types.attrsOf (lib.types.submoduleWith {
        specialArgs = { inherit pkgs; };
        modules = [ ./container.nix ];
      });
      example = lib.literalExpression ''
        {
          livekit = {
            enable = true;
            image = "livekit/livekit-server";
            tag = "v1.8.0";
            imageDigest = "sha256:9e34703b97ceb9f622bcbb533107e4786c7aa65966f0494966a452ad41a0c0d4";
            sha256 = "sha256-wdwHQ3M2Lxif8LDI4LRcWdwcb2Wf7CtHImvJoi2qZR4=";
            ports = [ "7880:7880" ];
            environment = {
              LIVEKIT_API_KEY = "devkey";
            };
          };
        }
      '';
    };
  };

  config = {
    # Merge container settings into process-compose settings
    settings = {
      imports = lib.pipe config.containers [
        # Filter only enabled containers
        (lib.filterAttrs (_: cfg: cfg.enable))
        # Extract their process-compose settings
        (lib.mapAttrsToList (_: cfg: cfg.outputs.settings))
      ];
    };
  };
}
