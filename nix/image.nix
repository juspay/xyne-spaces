# A single image that runs the Nix dev stack, backend and dashboard, for
# contributors who cannot install Nix. Linux only; the dev shell stays the
# supported path for everyone else.
#
# Usage:
#   docker run -v "$PWD":/src -p 3000:3000 -p 3001:3001 \
#     ghcr.io/juspay/xyne-spaces-dev
#
# Built from the same definitions as the dev shell and the services bundle.
# Nothing is baked from the checkout: `just prepare` runs on the mounted /src,
# so node_modules and local secrets live there.
{ pkgs, lib, runtimePackages, prismaEnvironment, bundle, smokeTest }:
let
  uid = 1000;
  gid = 1000;
  imageName = "ghcr.io/juspay/xyne-spaces-dev";
  imageTag = "latest";

  # Postgres refuses to run as root, so the whole image runs as `dev`.
  passwd = pkgs.dockerTools.fakeNss.override {
    extraPasswdLines = [ "dev:x:${toString uid}:${toString gid}:dev:/home/dev:/bin/sh" ];
    extraGroupLines = [ "dev:x:${toString gid}:" ];
  };

  # Owns only the working directory, the dev-proxy flag and the user. Ports are
  # the bundle's business (process-compose."dev-image-services").
  entrypoint = pkgs.writeShellApplication {
    name = "xyne-spaces-dev-entrypoint";
    runtimeInputs = [ pkgs.coreutils pkgs.git pkgs.cacert pkgs.just ];
    text = ''
      # Docker creates the working directory if it is missing, so test for the
      # checkout itself: a missing -v then fails here, not inside `just prepare`.
      if [ ! -f /src/flake.nix ]; then
        echo "Mount your checkout at /src, for example:" >&2
        echo "  docker run -v \"\$PWD\":/src ${imageName}" >&2
        echo "See docs/setup/nix.md for the published ports." >&2
        exit 1
      fi
      cd /src
      # One origin for the host browser: the dashboard proxies /api and /zero.
      export VITE_DEV_PROXY=true
      # No TTY here: `pnpm install` must not wait on its "reinstall modules?"
      # prompt. Scoped to prepare so the app processes do not run as CI.
      export CI=true
      just prepare
      unset CI
      exec ${bundle}/bin/dev-image-services
    '';
  };
in
pkgs.dockerTools.streamLayeredImage {
  name = imageName;
  tag = imageTag;
  contents = [
    entrypoint
    bundle
    smokeTest
    passwd
    pkgs.dockerTools.binSh
    pkgs.dockerTools.usrBinEnv
  ] ++ runtimePackages;
  fakeRootCommands = ''
    mkdir -p home/dev tmp
    chown ${toString uid}:${toString gid} home/dev
    chmod 1777 tmp
  '';
  config = {
    User = "${toString uid}:${toString gid}";
    WorkingDir = "/src";
    Cmd = [ "${entrypoint}/bin/xyne-spaces-dev-entrypoint" ];
    Env = [
      "HOME=/home/dev"
      "PATH=${lib.makeBinPath (runtimePackages ++ [ smokeTest ])}:/bin:/usr/bin"
      "NODE_ENV=development"
      # Keep the pnpm store inside the mount so a second `docker run` on the same
      # checkout does not re-download the workspace.
      "npm_config_store_dir=/src/.cache/pnpm-store"
      "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
      "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    ] ++ lib.mapAttrsToList (name: value: "${name}=${value}") prismaEnvironment;
  };
}
