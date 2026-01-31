-- Pipeline configuration for Vira <https://vira.nixos.asia/>

\ctx pipeline ->
  let
    isMain = ctx.branch == "main"
  in
  pipeline
    { signoff.enable = True
    }
