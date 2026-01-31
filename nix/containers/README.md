# Containers Module for Process-Compose

A declarative, reproducible way to run container images as process-compose processes using podman.

## Overview

This module provides a `containers` option that integrates seamlessly with process-compose, allowing you to define container-based services alongside native services in a unified, declarative configuration.

## Features

- **Reproducible**: Pins container images using digests and Nix hashes
- **Declarative**: YAML-like configuration using Nix module system
- **Integrated**: Works as a peer to `services.*` in process-compose
- **Dependency-aware**: Proper process dependency management
- **Development-friendly**: Exits on failure instead of silent restarts

## File Structure

```
nix/containers/
├── README.md          # This file
├── default.nix        # Main module (exposes containers option)
├── container.nix      # Individual container submodule (options + config)
└── lib.nix           # Helper functions (mkContainerRunner, etc.)
```

## Usage

### Basic Example

```nix
process-compose."my-services" = {
  imports = [ ./nix/containers ];

  containers.myapp = {
    enable = true;
    image = "myapp/server";
    tag = "v1.0.0";
    imageDigest = "sha256:abc123...";
    sha256 = "sha256-def456...";
    ports = [ "8080:8080" ];
    environment = {
      LOG_LEVEL = "info";
      API_KEY = "dev-key";
    };
    command = "--config /etc/config.yaml";
  };
}
```

### Complete Example with Dependencies

```nix
process-compose."xyne-space-services" = {
  imports = [
    inputs.services-flake.processComposeModules.default
    ./nix/containers
  ];

  # Native services via services-flake
  services.postgres."xyne-db" = {
    enable = true;
    port = 5433;
  };

  services.redis."xyne-redis" = {
    enable = true;
    port = 6379;
  };

  # Container services
  containers.livekit = {
    enable = true;
    image = "livekit/livekit-server";
    tag = "v1.8.0";
    imageDigest = "sha256:9e34703b97ceb9f622bcbb533107e4786c7aa65966f0494966a452ad41a0c0d4";
    sha256 = "sha256-wdwHQ3M2Lxif8LDI4LRcWdwcb2Wf7CtHImvJoi2qZR4=";
    ports = [ "7880:7880" "7881:7881" "7882:7882/udp" ];
    volumes = {
      "./docker/livekit.yaml" = "/etc/livekit.yaml:ro";
    };
    environment = {
      LIVEKIT_API_KEY = "devkey";
      LIVEKIT_API_SECRET = "devsecret";
    };
    command = "--config /etc/livekit.yaml --dev";
  };

  containers.zero-cache = {
    enable = true;
    image = "rocicorp/zero";
    tag = "latest";
    imageDigest = "sha256:c7e0098d79e002091194fac82309be2e8e1eb80fdd4f41e41b756c3e9a91af56";
    sha256 = "sha256-i4WEwuXClmAhjpBY4t1YaGhKzXJ+uCNf6zMIIx6JkGM=";
    ports = [ "4848:4848" "4849:4849" ];
    environment = {
      ZERO_UPSTREAM_DB = "postgresql://user:pass@host.docker.internal:5433/db";
    };
    dependsOn = [ "xyne-db" ];  # Wait for postgres to be healthy
  };
};
```

## Options Reference

### `containers.<name>`

Each container is configured with the following options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enable` | bool | - | Whether to enable this container |
| `image` | string | - | Container image name (without tag) |
| `tag` | string | `"latest"` | Image tag |
| `imageDigest` | string | - | Image digest for reproducibility (sha256:...) |
| `sha256` | string | - | Nix hash of the pulled image |
| `ports` | list of strings | `[]` | Port mappings (e.g., `["8080:8080"]`) |
| `volumes` | attrset | `{}` | Volume mappings (`{ source = dest; }`) |
| `environment` | attrset | `{}` | Environment variables |
| `command` | string or null | `null` | Command to run in container |
| `dependsOn` | list of strings | `[]` | List of process names to wait for |
| `namespace` | string | `"container.<name>"` | Process namespace |

## Getting Image Hashes

### 1. Get Image Digest

```bash
skopeo inspect docker://livekit/livekit-server:v1.8.0 | jq -r '.Digest'
# Output: sha256:9e34703b97ceb9f622bcbb533107e4786c7aa65966f0494966a452ad41a0c0d4
```

### 2. Get Nix Hash

Use a fake hash first:

```nix
sha256 = lib.fakeSha256;  # or "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
```

Build to get the error with the real hash:

```bash
nix build .#my-services
# Error will show: got: sha256-wdwHQ3M2Lxif8LDI4LRcWdwcb2Wf7CtHImvJoi2qZR4=
```

Update your config with the real hash.

## System Requirements

### Non-NixOS Systems

Rootless podman requires `newuidmap` and `newgidmap` with setuid permissions. Install:

**Ubuntu/Debian:**
```bash
sudo apt install uidmap
```

**Fedora/RHEL:**
```bash
sudo dnf install shadow-utils
```

**Arch:**
```bash
sudo pacman -S shadow
```

### Policy Configuration

The module automatically creates `~/.config/containers/policy.json` with an insecure policy that accepts all images. This is convenient for development but should be reviewed for production use.

## TODO: Upstreaming

This module is designed to be self-contained and upstreamable. Potential upstreaming targets:

### Option 1: services-flake

Add as `nix/services/containers.nix` in the services-flake repository.

**Changes needed:**
- Adapt to use `multiService` helper from services-flake
- Add test file `nix/services/containers_test.nix`
- Update documentation

**Benefits:**
- Unified location for all process-compose service modules
- Maintained alongside other service integrations

### Option 2: process-compose-flake

Add as a community module or example.

**Changes needed:**
- Minimal - already follows process-compose module patterns
- Add comprehensive documentation
- Add example flake

**Benefits:**
- Lower-level integration, closer to process-compose itself
- Could inspire official container support

### Option 3: Standalone Repository

Create `containers-flake` repository.

**Structure:**
```
containers-flake/
├── flake.nix
├── nix/
│   └── containers/
│       ├── default.nix
│       ├── container.nix
│       └── lib.nix
└── examples/
    └── basic/flake.nix
```

**Benefits:**
- Independent versioning
- Focused scope
- Easy to consume as input

## Implementation Notes

- Uses `pkgs.dockerTools.pullImage` for reproducible image pulling
- Generates `writeShellApplication` scripts for each container
- Integrates with process-compose's dependency system
- Automatically creates podman `policy.json` if missing

## License

Same as the parent project (xyne-spaces).

## Contributing

When upstreaming, ensure:
1. All system dependencies are documented
2. Examples are comprehensive
3. Error messages are helpful
4. Options are well-documented with types and examples
