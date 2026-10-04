# 壹方天地

A small, interactive world with four seasons. The browser element is `minecraft-widget`.

From the repository root:

```sh
npm ci
npm run dev:widget
npm run test:widget
```

The original Minecraft assets are not included. Local previews need the files listed in `assets/sources.json`, placed under `assets/`. Use assets you have permission to use; the source list is not a redistribution license.

The blog shows a still preview in production. To enable interaction with assets you may publish, set `PUBLIC_MINECRAFT_WIDGET_ASSET_BASE` to their base URL, ending with `/`, before building.

For other sites, import `minecraft-widget.mjs` and add:

```html
<minecraft-widget season="spring" asset-base="/my-assets/"></minecraft-widget>
```

Use a bundler that resolves `three`. Seasons are `spring`, `summer`, `autumn`, and `winter`. `season-picker.mjs`, `season-picker.css`, and `index.html` show the optional season controls and panel.

Original code: MIT-0. Third-party materials: see `NOTICE`.
