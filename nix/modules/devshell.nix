# DevShell module for xyne-spaces
# Provides a customizable development shell with packages and banner
{ config, lib, pkgs, ... }:
let
  inherit (lib) types mkOption mkIf;
  cfg = config.devShell;
in
{
  options.devShell = {
    name = mkOption {
      type = types.str;
      default = "dev";
      description = "Name of the development shell";
      example = "xyne-spaces-dev";
    };

    packages = mkOption {
      type = types.listOf types.package;
      default = [ ];
      description = "Packages to include in the development shell";
      example = lib.literalExpression "[ pkgs.nodejs_22 pkgs.just ]";
    };

    banner = mkOption {
      type = types.nullOr types.lines;
      default = null;
      description = "Banner in markdown format, rendered with glow";
      example = ''
        # 🚀 Welcome to Dev Environment

        Node.js: $(node --version)

        ## Available commands

        ```bash
        just build  # Build the project
        ```
      '';
    };
  };

  config = mkIf (cfg.packages != [ ] || cfg.banner != null) {
    devShells.default = pkgs.mkShell {
      name = cfg.name;

      packages = cfg.packages ++ lib.optional (cfg.banner != null) pkgs.glow;

      shellHook = lib.optionalString (cfg.banner != null) ''
        glow <<'BANNER_EOF'
${cfg.banner}
BANNER_EOF
      '';
    };
  };
}
