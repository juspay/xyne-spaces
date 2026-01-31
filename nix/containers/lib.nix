{ pkgs, lib }:
rec {
  # Helper function to create container runner scripts
  # Note: Uses pkgs.podman, but relies on system's newuidmap (from shadow-utils)
  # for rootless operation. On non-NixOS, newuidmap must come from the system
  # because Nix can't provide setuid binaries.
  #
  # Required system packages:
  #   Ubuntu/Debian: sudo apt install uidmap
  #   Fedora/RHEL:   sudo dnf install shadow-utils
  #   Arch:          sudo pacman -S shadow
  mkContainerRunner =
    { name
    , image
    , tag
    , imageDigest
    , sha256
    , ports
    , volumes
    , environment
    , command
    }:
    let
      # Pull the pinned image from registry into Nix store
      pulledImage = pkgs.dockerTools.pullImage {
        imageName = image;
        imageDigest = imageDigest;
        sha256 = sha256;
        finalImageTag = tag;
      };

      # Build port arguments
      portArgs = lib.concatMapStringsSep " " (p: "-p ${p}") ports;

      # Build volume arguments
      # Note: src might be a store path, so we convert to string
      volumeArgs = lib.concatStringsSep " "
        (lib.mapAttrsToList (src: dst: "-v ${toString src}:${dst}") volumes);

      # Build environment arguments
      envArgs = lib.concatStringsSep " "
        (lib.mapAttrsToList (k: v: "-e ${k}=\"${v}\"") environment);

      # Build full image name with tag
      fullImageName = "${image}:${tag}";

      # Build command suffix
      commandSuffix = if command != null then command else "";
    in
    pkgs.writeShellApplication {
      name = name;
      runtimeInputs = [ pkgs.podman ];
      text = ''
        # Create policy.json if it doesn't exist
        # This configures podman to accept all images (insecure but convenient for dev)
        POLICY_FILE="$HOME/.config/containers/policy.json"
        if [ ! -f "$POLICY_FILE" ]; then
          mkdir -p "$(dirname "$POLICY_FILE")"
          cat > "$POLICY_FILE" <<'EOF'
        {
          "default": [{"type": "insecureAcceptAnything"}]
        }
        EOF
          echo "Created $POLICY_FILE with insecure policy (accepts all images)"
        fi

        # Load the pinned image from Nix store (only on first run)
        echo "Loading ${name} image from Nix store..."
        podman load < ${pulledImage} 2>/dev/null || true

        # Stop and remove existing container
        podman stop ${name} 2>/dev/null || true
        podman rm ${name} 2>/dev/null || true

        # Run container with specified arguments
        # Using --network=host for rootless podman to allow host access
        # Not using --rm so we can inspect exit code before cleanup
        set +e  # Temporarily disable exit on error to capture code
        podman run --name ${name} \
          --network=host \
          ${volumeArgs} \
          ${envArgs} \
          ${fullImageName} \
          ${commandSuffix}

        # Get actual container exit code
        exit_code=$(podman inspect "${name}" --format='{{.State.ExitCode}}' 2>/dev/null || echo "125")
        echo "[${name}] Container exited with code: $exit_code" >&2

        # Clean up container
        podman rm "${name}" >/dev/null 2>&1 || true

        exit "$exit_code"
      '';
    };
}
