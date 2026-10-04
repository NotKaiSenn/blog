# 壹方天地

A small, interactive world with four seasons. The browser element is `minecraft-widget`.

From the repository root:

```sh
npm ci
npm run dev:widget
npm run test:widget
```

The textures, models and sounds are included in `assets/`. Their sources and checksums are listed in `assets/sources.json`.

The blog build copies them to `/minecraft-widget/assets/` and enables full interaction by default. No asset host configuration is needed. To use another host, set `PUBLIC_MINECRAFT_WIDGET_ASSET_BASE` to its base URL before building.

For other sites, copy `assets/` to `/minecraft-widget/assets/`, import `minecraft-widget.mjs`, and add:

```html
<minecraft-widget season="spring" asset-base="/minecraft-widget/assets/"></minecraft-widget>
```

Use a bundler that resolves `three`. Seasons are `spring`, `summer`, `autumn`, and `winter`. `season-picker.mjs`, `season-picker.css`, and `index.html` show the optional season controls and panel.

Original code: MIT-0. Minecraft assets keep their original copyright and are not covered by the code license. See `NOTICE` for third-party terms and sources.
