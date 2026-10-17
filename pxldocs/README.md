# Pixelate documentation data

The canonical built-in documentation lives in `pixelate/pxldocs` in the
repository. This directory is a packaged fallback for the VS Code extension.

The extension first checks the opened workspace for `pxldocs/` and
`pixelate/pxldocs/`, then checks this directory. This lets documentation be
edited alongside the interpreter during development while still working for
an installed extension.
