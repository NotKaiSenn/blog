# 壹方天地

A small, interactive world with four seasons. The browser element is `minecraft-widget`.

From the repository root:

```sh
npm ci
npm run dev:widget
npm run test:widget
```

Open `http://127.0.0.1:4175/` while the dev server is running. The demo needs HTTP; opening `index.html` directly will not load its modules.

The textures, models and sounds are included in `assets/`. Their sources and checksums are listed in `assets/sources.json`.

The blog build copies them to `/minecraft-widget/assets/` and enables full interaction by default. No asset host configuration is needed. To use another host, set `PUBLIC_MINECRAFT_WIDGET_ASSET_BASE` to its base URL before building.

For other sites, copy `assets/` to `/minecraft-widget/assets/`, import `minecraft-widget.mjs`, and add:

```html
<minecraft-widget season="spring" asset-base="/minecraft-widget/assets/"></minecraft-widget>
```

Use a bundler that resolves `three`. Seasons are `spring`, `summer`, `autumn`, and `winter`. Changing the `season` attribute switches scenes in place; the current scene stays on screen until the next one is ready. `season-picker.mjs`, `season-items.mjs`, `season-picker.css`, and `index.html` show the optional season controls.

To show the scene before the script loads, put its poster inside the element. The poster holds the scene's space and fades out once the live scene draws:

```html
<minecraft-widget season="spring" asset-base="/minecraft-widget/assets/" aria-busy="true">
  <img slot="poster" src="/minecraft-widget/assets/posters/spring.webp" width="340" height="280" alt="" />
</minecraft-widget>
```

The widget keeps `aria-busy="true"` while a scene loads; `season-picker.css` uses it for a small loading bar. After changing a scene, run `npm run posters:widget` from the repository root to render new posters with the installed Chrome.

Original code: MIT-0. Minecraft assets keep their original copyright and are not covered by the code license. See `NOTICE` for third-party terms and sources.
