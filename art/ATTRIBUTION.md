# Art attribution

The art in `art/` is licensed separately from the code (spec §9.5).

## Tools

- **Claude** (Anthropic), https://claude.ai — drew the map sprites and their animations, the 48×48 council figures, the map tiles, buildings, UI and scenes; wrote the portrait specs; and converted the generated portraits to 64×64 Endesga 32 pixel art. Use of outputs is governed by Anthropic's terms for the plan used (Consumer Terms: https://www.anthropic.com/legal/consumer-terms).
- **OpenArt**, https://openart.ai — generated the hero and council portraits (`art/portraits/*.svg`) from those specs; they were then converted to the palette and size by Claude. Under OpenArt's Terms (https://openart.ai/terms, updated 30 July 2026, §4.1) OpenArt claims no ownership of outputs; commercial use is allowed on paid plans (Plus and above) and not on the free plan. **Plan used: _to be confirmed_** — the portraits may ship only if it was a paid plan.

## Palette

- **Endesga 32** by Endesga, https://lospec.com/palette-list/endesga-32

## Art licence

_To be filled in._

## Files

| Path | Made with |
| --- | --- |
| `art/characters/hero-*/*.grid` | Claude |
| `art/characters/councillor-*/*.grid` | Claude |
| `art/portraits/hero-*.svg` | OpenArt, converted by Claude |
| `art/portraits/councillor-*.svg` | OpenArt, converted by Claude |
| `art/characters/councillor-*/council/*.grid` | Claude |
| `art/map/**` | Claude |
| `art/buildings/*.grid`, `art/ui/**` | Claude |
| `art/scenes/*.svg` | Claude |
