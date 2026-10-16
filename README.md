# Pixelate for Visual Studio Code

VS Code language support for Pixelate, the `.pxl` UI scripting language.

The extension provides syntax highlighting, basic diagnostics, hover documentation, a run command, and Pixelate file icons.

## Features

- Syntax highlighting for Pixelate keywords, widgets, properties, variables, literals, comments, and f-strings.
- Basic diagnostics for missing braces, invalid properties, malformed declarations, and unsupported statements.
- Hover documentation for blocks, commands, widgets, properties, and mouse options.
- `Pixelate: Run Current File` command.
- Play button in the editor title bar for active `.pxl` files.
- `.pxl` file icons through the included Pixelate icon theme.
- Automatic bracket and quote pairing.

## Requirements

The extension requires the Pixelate runtime executable, `pixelate.exe`.

By default, it looks for the runtime at:

```text
${workspaceFolder}/pixelate/pixelate.exe
```

The workspace should usually look like this:

```text
project/
├── pixelate/
│   └── pixelate.exe
├── programs/
│   └── hello.pxl
└── .vscode/
```

## Running a Pixelate file

1. Open the Pixelate project folder in VS Code.
2. Open a `.pxl` file.
3. Click the play button in the editor title bar, or run `Pixelate: Run Current File` from the Command Palette.

Runtime output appears in the `Pixelate` output channel.

## Extension settings

### `pixelate.executablePath`

Overrides the location of the Pixelate runtime executable.

```json
{
    "pixelate.executablePath": "${workspaceFolder}/pixelate/pixelate.exe"
}
```

An absolute path is also supported:

```json
{
    "pixelate.executablePath": "C:/path/to/pixelate.exe"
}
```

## Supported file type

The extension registers the `pxl` language ID for files ending in `.pxl`.

```pxl
window {
    title: "My Pixelate App";
    width: 800;
    height: 600;
}

script {
    add label greeting {
        text: "Hello from Pixelate!";
        x: 40;
        y: 40;
        width: 300;
        height: 35;
    }
}
```

## Development

To test the extension locally:

1. Open this extension folder in VS Code.
2. Press `F5` to launch an Extension Development Host.
3. Open a `.pxl` file in the development host.

Changes to `extension.js` may require reloading the Extension Development Host. Grammar changes may require reopening the `.pxl` editor.

## Scope

This extension provides editor support for Pixelate. The Pixelate runtime and language implementation are maintained in the main project outside this extension folder.

See the main Pixelate repository documentation for the complete language and UI reference.
