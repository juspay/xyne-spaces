# LiveKit service module for services-flake
# Usage:
#   services.livekit."my-livekit" = {
#     enable = true;
#     port = 7880;
#     apiKey = "devkey";
#     apiSecret = "devsecret";
#   };
{ config, lib, pkgs, ... }:
let
  inherit (lib) types;
in
{
  options.services.livekit = lib.mkOption {
    type = types.attrsOf (types.submodule ({ name, config, ... }: {
      options = {
        enable = lib.mkEnableOption "LiveKit server";

        package = lib.mkOption {
          type = types.package;
          default = pkgs.livekit;
          defaultText = lib.literalExpression "pkgs.livekit";
          description = "LiveKit package to use";
        };

        port = lib.mkOption {
          type = types.port;
          default = 7880;
          description = "HTTP port for LiveKit server";
        };

        rtcPortRangeStart = lib.mkOption {
          type = types.port;
          default = 50000;
          description = "Start of RTC port range";
        };

        rtcPortRangeEnd = lib.mkOption {
          type = types.port;
          default = 60000;
          description = "End of RTC port range";
        };

        apiKey = lib.mkOption {
          type = types.str;
          default = "devkey";
          description = "LiveKit API key";
        };

        apiSecret = lib.mkOption {
          type = types.str;
          default = "devsecret";
          description = "LiveKit API secret";
        };

        configFile = lib.mkOption {
          type = types.nullOr types.path;
          default = null;
          description = "Path to LiveKit configuration file. If null, a config will be generated.";
        };

        devMode = lib.mkOption {
          type = types.bool;
          default = true;
          description = "Run LiveKit in development mode";
        };

        redisUrl = lib.mkOption {
          type = types.nullOr types.str;
          default = null;
          description = "Redis URL for LiveKit multi-node setup";
        };

        logLevel = lib.mkOption {
          type = types.enum [ "debug" "info" "warn" "error" ];
          default = "debug";
          description = "Log level";
        };

        outputs = {
          settings = lib.mkOption {
            type = types.lazyAttrsOf types.raw;
            internal = true;
            readOnly = true;
            description = "process-compose settings generated for this LiveKit instance";
          };
        };
      };

      config = lib.mkIf config.enable {
        outputs.settings = {
          processes.${name} = {
            command =
              let
                configYaml = pkgs.writeText "livekit-${name}.yaml" (builtins.toJSON {
                  port = config.port;
                  rtc = {
                    port_range_start = config.rtcPortRangeStart;
                    port_range_end = config.rtcPortRangeEnd;
                    use_external_ip = false;
                  };
                  redis = lib.optionalAttrs (config.redisUrl != null) {
                    address = config.redisUrl;
                  };
                  keys.${config.apiKey} = config.apiSecret;
                  logging = {
                    level = config.logLevel;
                    sample = false;
                  };
                  room = {
                    auto_create = true;
                    empty_timeout = 300;
                    max_participants = 100;
                  };
                  turn.enabled = false;
                });

                actualConfigFile = if config.configFile != null
                  then config.configFile
                  else configYaml;

                args = [
                  "--config" (toString actualConfigFile)
                ] ++ lib.optionals config.devMode [ "--dev" ];
              in
              "${config.package}/bin/livekit-server ${lib.escapeShellArgs args}";

            readiness_probe = {
              http_get = {
                host = "127.0.0.1";
                port = config.port;
              };
              initial_delay_seconds = 2;
              period_seconds = 10;
              timeout_seconds = 4;
              success_threshold = 1;
              failure_threshold = 5;
            };

            namespace = name;
            availability.restart = "on_failure";
          };
        };
      };
    }));
    default = { };
    description = "LiveKit server instances";
  };

  config.settings = {
    imports = lib.pipe config.services.livekit [
      (lib.filterAttrs (_: cfg: cfg.enable))
      (lib.mapAttrsToList (_: cfg: cfg.outputs.settings))
    ];
  };
}
