# Angelina Note Icons

Place application and installer icons in this directory.

## Recommended files

- `app.ico`: Windows application, installer, Start menu, and shortcut icon.
- `app.png`: Optional high-resolution source image for previews or future platforms.

## Windows ICO requirements

- Use a real `.ico` container, not a renamed PNG file.
- Include square layers at `16x16`, `24x24`, `32x32`, `48x48`, `64x64`, `128x128`, and `256x256`.
- Use 32-bit RGBA color with a transparent background.
- Keep important artwork inside the central 80-88% area so Windows does not visually clip it.
- Avoid very thin lines and small text because they disappear at taskbar sizes.
- The recommended filename is exactly `app.ico`.

## PNG source requirements

- Use a square `1024x1024` PNG with an alpha channel.
- Use the sRGB color space.
- Do not add rounded corners or a drop shadow; the operating system may apply its own mask.
- The recommended filename is `app.png`.

After adding `app.ico`, configure Electron Builder with:

```json
"win": {
  "icon": "Angelina/Icons/app.ico"
}
```

The icon must be licensed for redistribution with the application.
