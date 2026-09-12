# Match the engine revision shipped by Prisma 5.22 in pnpm-lock.yaml.
{ pkgs }:
let
  revision = "605197351a3c8bdd595af2d2a9bc3025bca48ea2";
  targets = {
    x86_64-linux = {
      platform = "debian-openssl-3.0.x";
      queryHash = "0d0ac9arrbj7fjr8v6kx5jbih1jpqqz1i43yiik0cci3jch0qg0i";
      schemaHash = "05dydn3gamhl66qi5pbajyrcvfj34m7m68gr4v3csl59fcyg6g5g";
    };
    aarch64-linux = {
      platform = "linux-arm64-openssl-3.0.x";
      queryHash = "1cnfl91mnza7idsn17jxf0lyw4acmw7w89r288sbqpprmn31pi95";
      schemaHash = "0w76dfip9008nrv9w7dh07j6cajiclfs699qrhqhg2yp7vckq1lz";
    };
  };
  target = targets.${pkgs.stdenv.hostPlatform.system};
  fetch = name: hash: pkgs.fetchurl {
    url = "https://binaries.prisma.sh/all_commits/${revision}/${target.platform}/${name}.gz";
    sha256 = hash;
  };
in pkgs.stdenv.mkDerivation {
  pname = "xyne-prisma-engines";
  version = "5.22.0";
  dontUnpack = true;
  nativeBuildInputs = [ pkgs.autoPatchelfHook ];
  buildInputs = [ pkgs.openssl pkgs.stdenv.cc.cc.lib pkgs.zlib ];
  installPhase = ''
    mkdir -p $out/bin $out/lib
    gzip -dc ${fetch "schema-engine" target.schemaHash} > $out/bin/schema-engine
    gzip -dc ${fetch "libquery_engine.so.node" target.queryHash} > $out/lib/libquery_engine.node
    chmod +x $out/bin/schema-engine $out/lib/libquery_engine.node
  '';
}
