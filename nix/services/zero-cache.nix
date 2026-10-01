# Zero-cache service module for services-flake
# Runs the workspace-installed @rocicorp/zero CLI
#
# Usage:
#   services.zero-cache."my-zero-cache" = {
#     enable = true;
#     port = 4848;
#     upstreamDb = "postgresql://user:pass@localhost:5432/db";
#   };
{ config, lib, pkgs, ... }:
let
  inherit (lib) types;
in
{
  options.services.zero-cache = lib.mkOption {
    type = types.attrsOf (types.submodule ({ name, config, ... }: {
      options = {
        enable = lib.mkEnableOption "Zero-cache server";

        port = lib.mkOption {
          type = types.port;
          default = 4848;
          description = "HTTP port for zero-cache server";
        };

        upstreamDb = lib.mkOption {
          type = types.str;
          description = "PostgreSQL connection string for the upstream database";
          example = "postgresql://user:pass@localhost:5432/mydb";
        };

        cvrDb = lib.mkOption {
          type = types.nullOr types.str;
          default = null;
          description = "PostgreSQL connection string for CVR storage. Defaults to upstreamDb if not set.";
        };

        changeDb = lib.mkOption {
          type = types.nullOr types.str;
          default = null;
          description = "PostgreSQL connection string for change storage. Defaults to upstreamDb if not set.";
        };

        replicaFile = lib.mkOption {
          type = types.str;
          default = "./data/zero-cache/replica.db";
          description = "Path to the SQLite replica file";
        };

        authSecret = lib.mkOption {
          type = types.nullOr types.str;
          default = null;
          description = "Auth secret for JWT verification";
        };

        adminPassword = lib.mkOption {
          type = types.nullOr types.str;
          default = null;
          description = "Admin password for zero-cache admin interface";
        };

        mutateUrl = lib.mkOption {
          type = types.nullOr types.str;
          default = null;
          description = "URL for mutation/push endpoint";
        };

        queryUrl = lib.mkOption {
          type = types.nullOr types.str;
          default = null;
          description = "URL for query endpoint (replaces deprecated getQueriesUrl)";
        };

        getQueriesUrl = lib.mkOption {
          type = types.nullOr types.str;
          default = null;
          description = "URL for get-queries endpoint (deprecated, use queryUrl instead)";
        };

        logLevel = lib.mkOption {
          type = types.enum [ "debug" "info" "warn" "error" ];
          default = "info";
          description = "Log level";
        };

        cvrMaxConns = lib.mkOption {
          type = types.int;
          default = 10;
          description = "Maximum CVR database connections";
        };

        upstreamMaxConns = lib.mkOption {
          type = types.int;
          default = 10;
          description = "Maximum upstream database connections";
        };

        numSyncWorkers = lib.mkOption {
          type = types.int;
          default = 5;
          description = "Number of sync workers";
        };

        extraEnv = lib.mkOption {
          type = types.attrsOf types.str;
          default = { };
          description = "Additional environment variables";
        };

        nodeModulesPath = lib.mkOption {
          type = types.str;
          description = "Runtime path to workspace node_modules containing @rocicorp/zero.";
        };

        outputs = {
          settings = lib.mkOption {
            type = types.lazyAttrsOf types.raw;
            internal = true;
            readOnly = true;
            description = "process-compose settings generated for this zero-cache instance";
          };
        };
      };

      config = lib.mkIf config.enable {
        outputs.settings = {
          processes.${name} = {
            command =
              let
                # Build environment variables
                envVars = {
                  ZERO_PORT = toString config.port;
                  ZERO_UPSTREAM_DB = config.upstreamDb;
                  ZERO_CVR_DB = if config.cvrDb != null then config.cvrDb else config.upstreamDb;
                  ZERO_CHANGE_DB = if config.changeDb != null then config.changeDb else config.upstreamDb;
                  ZERO_REPLICA_FILE = config.replicaFile;
                  ZERO_LOG_LEVEL = config.logLevel;
                  ZERO_CVR_MAX_CONNS = toString config.cvrMaxConns;
                  ZERO_UPSTREAM_MAX_CONNS = toString config.upstreamMaxConns;
                  ZERO_NUM_SYNC_WORKERS = toString config.numSyncWorkers;
                  NODE_ENV = "development";
                } // lib.optionalAttrs (config.authSecret != null) {
                  ZERO_AUTH_SECRET = config.authSecret;
                } // lib.optionalAttrs (config.adminPassword != null) {
                  ZERO_ADMIN_PASSWORD = config.adminPassword;
                } // lib.optionalAttrs (config.mutateUrl != null) {
                  ZERO_MUTATE_URL = config.mutateUrl;
                } // lib.optionalAttrs (config.queryUrl != null) {
                  ZERO_QUERY_URL = config.queryUrl;
                } // lib.optionalAttrs (config.getQueriesUrl != null) {
                  ZERO_GET_QUERIES_URL = config.getQueriesUrl;
                } // config.extraEnv;

                # Generate env export commands
                envExports = lib.concatStringsSep " " (
                  lib.mapAttrsToList (k: v: "${k}=${lib.escapeShellArg v}") envVars
                );

                zeroCacheCmd = lib.escapeShellArg "${config.nodeModulesPath}/.bin/zero-cache";
              in
              toString (pkgs.writeShellScript "${name}-start" ''
                set -eu
                if [ ! -x ${zeroCacheCmd} ]; then
                  echo "zero-cache is missing from ${config.nodeModulesPath}; run just prepare" >&2
                  exit 1
                fi
                ${pkgs.coreutils}/bin/mkdir -p ${lib.escapeShellArg (builtins.dirOf config.replicaFile)}
                exec ${pkgs.coreutils}/bin/env ${envExports} ${zeroCacheCmd}
              '');

            readiness_probe = {
              http_get = {
                host = "127.0.0.1";
                port = config.port;
              };
              initial_delay_seconds = 5;
              period_seconds = 10;
              timeout_seconds = 5;
              success_threshold = 1;
              failure_threshold = 10;
            };

            namespace = name;
            availability.restart = "on_failure";
          };
        };
      };
    }));
    default = { };
    description = "Zero-cache server instances";
  };

  config.settings = {
    imports = lib.pipe config.services.zero-cache [
      (lib.filterAttrs (_: cfg: cfg.enable))
      (lib.mapAttrsToList (_: cfg: cfg.outputs.settings))
    ];
  };
}
