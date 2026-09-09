{
  description = "FileExplorer development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          pkg-config
          glib
          gtk3
          webkitgtk_4_1
          libsoup_3
          libayatana-appindicator
          librsvg
          openssl
        ];

        GDK_BACKEND = "x11";
        WEBKIT_DISABLE_COMPOSITING_MODE = "1";
      };
    };
}
