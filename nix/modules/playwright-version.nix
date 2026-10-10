{ pkgs, ... }:
{
  checks.playwright-version = pkgs.runCommand "playwright-version" {
    automationVersion = (builtins.fromJSON (builtins.readFile ../../tools/xyne-automation/package.json)).devDependencies."@playwright/test";
    clawVersion = (builtins.fromJSON (builtins.readFile ../../packages/xyne-claw-shared/package.json)).dependencies.playwright;
    nixVersion = pkgs.playwright-driver.version;
  } ''
    for version in "$automationVersion" "$clawVersion"; do
      if [ "$version" != "$nixVersion" ]; then
        echo "Playwright npm pin $version must match nixpkgs $nixVersion" >&2
        exit 1
      fi
    done
    touch "$out"
  '';

}
