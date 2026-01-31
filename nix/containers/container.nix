# Individual container submodule
# This defines the options and configuration for a single container
{ pkgs, lib, name, config, ... }:
let
  inherit (import ./lib.nix { inherit pkgs lib; }) mkContainerRunner;
in
{
  options = {
    enable = lib.mkEnableOption "Enable the ${name} container";

    image = lib.mkOption {
      type = lib.types.str;
      description = ''
        Container image name (without tag).
        Example: "livekit/livekit-server" or "rocicorp/zero"
      '';
      example = "livekit/livekit-server";
    };

    tag = lib.mkOption {
      type = lib.types.str;
      default = "latest";
      description = ''
        Image tag to use.
      '';
      example = "v1.8.0";
    };

    imageDigest = lib.mkOption {
      type = lib.types.str;
      description = ''
        Image digest for reproducibility.
        Get this with: skopeo inspect docker://IMAGE:TAG | jq -r '.Digest'
      '';
      example = "sha256:9e34703b97ceb9f622bcbb533107e4786c7aa65966f0494966a452ad41a0c0d4";
    };

    sha256 = lib.mkOption {
      type = lib.types.str;
      description = ''
        Nix hash of the pulled image.
        Use lib.fakeSha256 first, build to get error with real hash.
      '';
      example = "sha256-wdwHQ3M2Lxif8LDI4LRcWdwcb2Wf7CtHImvJoi2qZR4=";
    };

    ports = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = ''
        Port mappings in the format "host:container" or "host:container/protocol".
      '';
      example = [ "7880:7880" "7881:7881" "7882:7882/udp" ];
    };

    volumes = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = ''
        Volume mappings. Keys are source paths, values are destination paths in container.
        Can include mount options like ":ro" for read-only.
      '';
      example = {
        "/path/on/host/config.yaml" = "/etc/app/config.yaml:ro";
      };
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = ''
        Environment variables to set in the container.
      '';
      example = {
        API_KEY = "devkey";
        LOG_LEVEL = "info";
      };
    };

    command = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Optional command and arguments to run in the container.
        This overrides the image's default CMD.
      '';
      example = "--config /etc/livekit.yaml --dev";
    };

    dependsOn = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = ''
        List of process names this container depends on.
        The container will wait for these processes to be healthy before starting.
      '';
      example = [ "postgres" "redis" ];
    };

    namespace = lib.mkOption {
      type = lib.types.str;
      default = "container.${name}";
      description = ''
        Namespace for the container process in process-compose.
      '';
    };

    outputs = {
      settings = lib.mkOption {
        type = lib.types.lazyAttrsOf lib.types.raw;
        internal = true;
        readOnly = true;
        description = ''
          process-compose settings generated for this container.
        '';
      };
    };
  };

  config = lib.mkIf config.enable {
    outputs.settings = {
      processes."${name}" = {
        command = mkContainerRunner {
          inherit name;
          inherit (config) image tag imageDigest sha256 ports volumes environment command;
        };

        # Set up dependencies
        depends_on = lib.listToAttrs (map
          (dep: {
            name = dep;
            value = { condition = "process_healthy"; };
          })
          config.dependsOn);

        # Namespace for organization
        inherit (config) namespace;
      };
    };
  };
}
