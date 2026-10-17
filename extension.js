const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

function diagnostic(document, diagnostics, line, message) {
    const text = document.lineAt(line).text;
    diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Math.max(text.length, 1)),
        message,
        vscode.DiagnosticSeverity.Error
    ));
}

function validate(document) {
    const diagnostics = [];
    let braceDepth = 0;
    let hasWindow = false;
    const elementBlocks = [];

    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
        const original = document.lineAt(lineNumber).text;
        const trimmed = original.trim();
        const hasTrailingSemicolon = /;\s*$/.test(trimmed);
        const hasTrailingComma = /,\s*$/.test(trimmed);
        const line = trimmed.replace(/[;,]\s*$/, '').trim();

        if (line === '' || line.startsWith('#')) {
            continue;
        }

        const isField =
            /^(id|title|iconPath|text|placeholder|message|options|width|height|x|y|font|fontSize|angle|radius|p1|p2|p3|background)\s*:/.test(line);

        // Fields inside blocks are comma-delimited, while executable
        // statements and declarations remain semicolon-terminated. A final
        // field may omit its comma immediately before the closing brace.
        if (isField) {
            if (elementBlocks.length > 0) {
                elementBlocks[elementBlocks.length - 1].properties.add(
                    line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/)[1]
                );
            }
            let nextLine = '';
            for (let next = lineNumber + 1; next < document.lineCount; next++) {
                const candidate = document.lineAt(next).text.trim();
                if (candidate !== '' && !candidate.startsWith('#')) {
                    nextLine = candidate;
                    break;
                }
            }

            if (hasTrailingSemicolon || (nextLine !== '}' && !hasTrailingComma)) {
                diagnostic(document, diagnostics, lineNumber, "Expected ',' after the field.");
            }
        }

        // Keep block headers and for-loop clauses out of the statement check;
        // their braces and internal semicolons are structural syntax.
        const requiresSemicolon =
            /^switch_view\s*\(.*\)\s*$/.test(line) ||
            /^[A-Za-z_][A-Za-z0-9_]*\+\+$/.test(line) ||
            /^(int|short|long)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*-?\d+$/.test(line) ||
            /^(float|double)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*-?\d+(?:\.\d+)?$/.test(line) ||
            /^bool\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*(true|false)$/.test(line) ||
            /^char\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*'(?:\\.|[^'\\])'$/.test(line) ||
            /^String\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*"(?:\\.|[^"\\])*"$/.test(line) ||
            /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:-?\d+(?:\.\d+)?|true|false|'.'|"(?:\\.|[^"\\])*")$/.test(line) ||
            /^update\s+[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?\s*=/.test(line) ||
            /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line);

        if (requiresSemicolon && !hasTrailingSemicolon) {
            diagnostic(document, diagnostics, lineNumber, "Expected ';' at the end of the statement.");
        }

        const withoutStrings = original.replace(/"(?:\\.|[^"\\])*"/g, '""');
        braceDepth += (withoutStrings.match(/{/g) || []).length;
        braceDepth -= (withoutStrings.match(/}/g) || []).length;

        if (/^window\s*\{$/.test(line)) {
            hasWindow = true;
            continue;
        }

        if (/^script\s*\{$/.test(line)) {
            continue;
        }

        const elementHeader = line.match(
            /^(label|par|button|textbox|textarea|rect|circle|triangle)\s+[A-Za-z_][A-Za-z0-9_]*\s*\{$/
        );
        if (elementHeader) {
            elementBlocks.push({ type: elementHeader[1], properties: new Set() });
            continue;
        }

        const addElementHeader = line.match(
            /^add\s+(label|par|button|textbox|textarea|rect|circle|triangle)\s+[A-Za-z_][A-Za-z0-9_]*\s*\{$/
        );
        if (addElementHeader) {
            elementBlocks.push({ type: addElementHeader[1], properties: new Set() });
            continue;
        }

        if (/^add\s+CLOSE_TRIGGER\s*\{$/.test(line)) {
            continue;
        }

        if (/^onclick\s*\{$/.test(line)) {
            continue;
        }

        if (/^switch_view\s*\(\s*(?:"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*destroy_window\s*=\s*(?:true|false))?\s*\)\s*$/.test(line)) {
            continue;
        }

        if (/^else(?:\s+if\s*\(.*\))?\s*\{$/.test(line)) {
            continue;
        }

        if (/^\}\s*else(?:\s+if\s*\(.*\))?\s*\{$/.test(line)) {
            continue;
        }

        if (/^trigger\s*\(\s*mouseMove\s*\)\s*\{$/.test(line) ||
            /^trigger\s*\(\s*onkey(ci)?\s*\(\s*"(?:space|esc|enter|shift|alt|up|down|left|right|tab|[^"\\])"\s*\)\s*\)\s*\{$/.test(line) ||
            /^trigger\s*\(.*\)\s*\{$/.test(line)) {
            continue;
        }

        if (/^(if|while)\s*\(.*\)\s*\{$/.test(line)) {
            continue;
        }

        if (/^for\s*\(\s*(int|short|long|float|double)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*-?\d+(?:\.\d+)?\s*;\s*[A-Za-z_][A-Za-z0-9_]*\s*(==|!=|<=|>=|<|>)\s*(?:[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)\s*;\s*[A-Za-z_][A-Za-z0-9_]*\+\+\s*\)\s*\{$/.test(line)) {
            continue;
        }

        if (/^[A-Za-z_][A-Za-z0-9_]*\+\+;?$/.test(line)) {
            continue;
        }

        if (/^[A-Za-z_][A-Za-z0-9_]*\.(x|y|fontSize|radius|angle)\+\+;?$/.test(line)) {
            continue;
        }

        if (/^[A-Za-z_][A-Za-z0-9_]*\.(x|y|fontSize|radius|angle)--\s*;?$/.test(line) ||
            /^[A-Za-z_][A-Za-z0-9_]*--\s*;?$/.test(line)) {
            continue;
        }

        if (/^(int|short|long)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*-?\d+;?$/.test(line) ||
            /^(float|double)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*-?\d+(?:\.\d+)?;?$/.test(line) ||
            /^bool\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*(true|false);?$/.test(line) ||
            /^char\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*'(?:\\.|[^'\\])';?$/.test(line) ||
            /^String\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*"(?:\\.|[^"\\])*";?$/.test(line)) {
            continue;
        }

        if (/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:-?\d+(?:\.\d+)?|true|false|'.'|"(?:\\.|[^"\\])*");?$/.test(line)) {
            continue;
        }

        if (line === '}') {
            const element = elementBlocks.pop();
            if (element && element.type === 'triangle') {
                const hasPoints = ['p1', 'p2', 'p3'].some(
                    point => element.properties.has(point)
                );
                const allPoints = ['p1', 'p2', 'p3'].every(
                    point => element.properties.has(point)
                );
                if (hasPoints && !allPoints) {
                    diagnostic(document, diagnostics, lineNumber,
                        'Triangle elements must specify p1, p2, and p3 together.');
                }
                const hasX = element.properties.has('x');
                const hasY = element.properties.has('y');
                if (hasX !== hasY) {
                    diagnostic(document, diagnostics, lineNumber,
                        'Triangle elements must specify both x and y together.');
                }
            }
            if (braceDepth < 0) {
                diagnostic(document, diagnostics, lineNumber, 'Unexpected closing brace.');
                braceDepth = 0;
            }
            continue;
        }

        if (/^update\s+[A-Za-z_][A-Za-z0-9_]*\s*\{$/.test(line)) {
            continue;
        }

        if (/^[A-Za-z_][A-Za-z0-9_]*\.(text|title|iconPath)\s*=\s*(?:f)?"(?:\\.|[^"\\])*"$/.test(line) ||
            /^[A-Za-z_][A-Za-z0-9_]*\.font\s*=\s*(DEFAULT|ARIAL|CALIBRI|CONSOLAS|COURIERNEW|TIMESNEWROMAN|TAHOMA|VERDANA)$/.test(line) ||
            /^[A-Za-z_][A-Za-z0-9_]*\.fontSize\s*=\s*[1-9]\d+$/.test(line) ||
            /^[A-Za-z_][A-Za-z0-9_]*\.(x|y|width|height|fontSize|angle|radius)\s*=\s*(?:-?\d+|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?\s*[+-]\s*-?\d+)$/.test(line) ||
            /^mouse\.shape\s*=\s*(ARROW|IBEAM|WAIT|CROSS|UPARROW|SIZE|ICON|SIZENWSE|SIZENESW|SIZEWE|SIZENS|SIZEALL|NO|HAND|APPSTARTING|HELP|PIN|PERSON)$/.test(line)) {
            continue;
        }

        if (/^update\s+[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?\s*=\s*"(?:\\.|[^"\\])*"$/.test(line)) {
            continue;
        }

        if (/^update\s+[A-Za-z_][A-Za-z0-9_]*\.font\s*=\s*(DEFAULT|ARIAL|CALIBRI|CONSOLAS|COURIERNEW|TIMESNEWROMAN|TAHOMA|VERDANA)$/.test(line) ||
            /^update\s+[A-Za-z_][A-Za-z0-9_]*\.(x|y|width|height|fontSize|angle|radius)\s*=\s*(?:-?\d+|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?\s*[+-]\s*-?\d+)$/.test(line)) {
            continue;
        }

        if (/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\s*=\s*f"(?:\\.|[^"\\])*"$/.test(line)) {
            continue;
        }

        if (/^update\s+[A-Za-z_][A-Za-z0-9_]*\.background\s*=\s*-?\d+\s+-?\d+\s+-?\d+$/.test(line)) {
            const values = line.match(/-?\d+/g).slice(-3).map(Number);

            if (values.some(value => value < 0 || value > 255)) {
                diagnostic(
                    document,
                    diagnostics,
                    lineNumber,
                    'Background color channels must be between 0 and 255.'
                );
            }
            continue;
        }

        if (/^update\s+mouse\.shape\s*=\s*(ARROW|IBEAM|WAIT|CROSS|UPARROW|SIZE|ICON|SIZENWSE|SIZENESW|SIZEWE|SIZENS|SIZEALL|NO|HAND|APPSTARTING|HELP|PIN|PERSON)$/.test(line)) {
            continue;
        }

        if (/^update\s+[A-Za-z_][A-Za-z0-9_]*\.background\s*=\s*-?\d+\s+-?\d+\s+-?\d+$/.test(line)) {
            const values = line.match(/-?\d+/g).slice(-3).map(Number);

            if (values.some(value => value < 0 || value > 255)) {
                diagnostic(
                    document,
                    diagnostics,
                    lineNumber,
                    'Background color channels must be between 0 and 255.'
                );
            }
            continue;
        }

        if (/^(id|title|iconPath|text|placeholder|message)\s*:\s*(?:f)?"(?:\\.|[^"\\])*"$/.test(line)) {
            continue;
        }

        if (/^font\s*:\s*(DEFAULT|ARIAL|CALIBRI|CONSOLAS|COURIERNEW|TIMESNEWROMAN|TAHOMA|VERDANA)$/.test(line) ||
            /^fontSize\s*:\s*[1-9]\d*$/.test(line) ||
            /^(angle|radius)\s*:\s*-?\d+$/.test(line) ||
            /^p[123]\s*:\s*\(\s*-?\d+\s*,\s*-?\d+\s*\)$/.test(line)) {
            continue;
        }

        if (/^options\s*:\s*YESNO$/.test(line)) {
            continue;
        }

        if (/^(width|height|x|y)\s*:\s*-?\d+$/.test(line)) {
            continue;
        }

        if (/^background\s*:\s*-?\d+\s+-?\d+\s+-?\d+$/.test(line)) {
            const values = line.match(/-?\d+/g).map(Number);

            if (values.some(value => value < 0 || value > 255)) {
                diagnostic(
                    document,
                    diagnostics,
                    lineNumber,
                    'Background color channels must be between 0 and 255.'
                );
            }
            continue;
        }

        if (/^(id|title|iconPath|text|placeholder|message|options|width|height|x|y|font|fontSize|angle|radius|p1|p2|p3|background)\b/.test(line)) {
            diagnostic(
                document,
                diagnostics,
                lineNumber,
                'Invalid property value or missing colon.'
            );
            continue;
        }

        diagnostic(document, diagnostics, lineNumber, 'Unrecognized PXL statement.');
    }

    if (!hasWindow) {
        diagnostic(document, diagnostics, 0, 'A window block is required.');
    }

    if (braceDepth > 0) {
        const lastLine = Math.max(document.lineCount - 1, 0);
        diagnostic(document, diagnostics, lastLine, 'Missing closing brace.');
    }

    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
        const text = document.lineAt(lineNumber).text;
        const quoteCount = (text.match(/(?<!\\)"/g) || []).length;

        if (quoteCount % 2 !== 0) {
            diagnostic(document, diagnostics, lineNumber, 'Unterminated string.');
        }
    }

    return diagnostics;
}

function parsePxldocFile(source, fileName) {
    const entries = [];
    // A record separator must be followed by an id header. This keeps normal
    // Markdown horizontal rules inside the documentation body intact.
    const recordPattern = /^---\r?\n(?=id:\s*)([\s\S]*?)\r?\n---\r?\n([\s\S]*?)(?=^---\r?\n(?=id:\s*)|(?![\s\S]))/gm;
    let match;

    while ((match = recordPattern.exec(source)) !== null) {
        const metadata = {};
        for (const line of match[1].split(/\r?\n/)) {
            const separator = line.indexOf(':');
            if (separator === -1) {
                continue;
            }

            const key = line.slice(0, separator).trim();
            const value = line.slice(separator + 1).trim();
            if (key) {
                metadata[key] = value;
            }
        }

        if (!metadata.id || !metadata.name) {
            throw new Error(`${fileName}: every entry needs id and name metadata.`);
        }

        entries.push({
            id: metadata.id,
            name: metadata.name,
            kind: metadata.kind || 'keyword',
            docs: match[2].trim()
        });
    }

    if (entries.length === 0) {
        throw new Error(`${fileName}: no .pxldoc entries found.`);
    }

    return entries;
}

function loadDocumentation(context) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const packagedDirectory = path.join(context.extensionPath, 'pxldocs');
    const directories = [
        // Load the packaged copy first. Workspace documentation is the
        // authoritative override during development.
        packagedDirectory,
        workspace && path.join(workspace, 'pxldocs'),
        workspace && path.join(workspace, 'pixelate', 'pxldocs'),
    ].filter(Boolean);
    const documentation = new Map();

    const configuredPath = vscode.workspace
        .getConfiguration('pixelate')
        .get('executablePath');
    const executable = configuredPath || 'pixelate.exe';
    const embedded = spawnSync(executable, ['--docs'], {
        cwd: workspace || context.extensionPath,
        encoding: 'utf8',
        timeout: 2000,
        windowsHide: true
    });

    if (!embedded.error && embedded.status === 0 && embedded.stdout) {
        try {
            for (const entry of parsePxldocFile(embedded.stdout, `${executable} --docs`)) {
                documentation.set(entry.id, entry);
            }
        } catch (error) {
            console.warn(`Could not load embedded Pixelate documentation: ${error.message}`);
        }
    }

    for (const directory of directories) {
        if (!fs.existsSync(directory)) {
            continue;
        }

        for (const fileName of fs.readdirSync(directory).filter(name => name.endsWith('.pxldoc'))) {
            const filePath = path.join(directory, fileName);
            try {
                for (const entry of parsePxldocFile(fs.readFileSync(filePath, 'utf8'), fileName)) {
                    // Embedded runtime docs take precedence over the packaged
                    // fallback, while workspace docs remain the final override.
                    if (directory === packagedDirectory && documentation.has(entry.id)) {
                        continue;
                    }
                    if (documentation.has(entry.id)) {
                        console.warn(`Duplicate Pixelate documentation id: ${entry.id}. Using ${filePath}.`);
                    }
                    documentation.set(entry.id, entry);
                }
            } catch (error) {
                console.warn(`Could not load Pixelate documentation from ${filePath}: ${error.message}`);
            }
        }
    }

    return documentation;
}

function findWidgetDocumentation(document, word) {
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
        `^\\s*(?:add\\s+)?(label|par|button|textbox|textarea|rect|circle|triangle)\\s+${escapedWord}\\s*\\{`
    );

    const lines = document.getText().split(/\r?\n/);
    const declarationIndex = lines.findIndex(line => pattern.test(line));

    if (declarationIndex === -1) {
        return undefined;
    }

    const declaration = lines[declarationIndex].match(pattern);
    const type = declaration[1] === 'button'
        ? 'Button'
        : declaration[1] === 'par'
            ? 'Paragraph'
        : declaration[1] === 'textarea'
            ? 'Textarea'
            : declaration[1] === 'textbox'
                ? 'Textbox'
                : declaration[1] === 'rect'
                    ? 'Rectangle'
                    : declaration[1] === 'circle'
                        ? 'Circle'
                        : declaration[1] === 'triangle'
                            ? 'Triangle'
                            : 'Label';
    const details = [`**${word}**`, `\n${type} widget.`];
    let braceDepth = 1;

    for (let index = declarationIndex + 1; index < lines.length; index++) {
        const line = lines[index];
        const property = line.trim().match(/^(text|x|y|width|height|angle|radius|p1|p2|p3)\s*:\s*(.+)$/);

        if (braceDepth > 0 && property) {
            details.push(`\n- **${property[1]}:** ${property[2]}`);
        }

        const withoutStrings = line.replace(/"(?:\\.|[^"\\])*"/g, '');
        braceDepth += (withoutStrings.match(/{/g) || []).length;
        braceDepth -= (withoutStrings.match(/}/g) || []).length;

        if (braceDepth <= 0) {
            break;
        }
    }

    return details.join('');
}

function provideHover(document, position, documentation) {
    const range = document.getWordRangeAtPosition(
        position,
        /[A-Za-z_][A-Za-z0-9_]*/
    );

    if (!range) {
        return undefined;
    }

    const word = document.getText(range);
    const entry = documentation.get(word);
    const markdown = entry
        ? `## ${entry.name}\n\n${entry.docs}`
        : findWidgetDocumentation(document, word);

    if (!markdown) {
        return undefined;
    }

    return new vscode.Hover(
        new vscode.MarkdownString(markdown),
        range
    );
}

function expandWorkspaceVariable(value) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (workspace) {
        return value.replace(/\$\{workspaceFolder\}/g, workspace);
    }

    return value;
}

async function runCurrentFile(context, output) {
    const editor = vscode.window.activeTextEditor;

    if (!editor || editor.document.languageId !== 'pxl') {
        vscode.window.showErrorMessage('Open a .pxl file before running it.');
        return;
    }

    await editor.document.save();

    const configuredPath = vscode.workspace
        .getConfiguration('pixelate')
        .get('executablePath');

    // Use the configured command directly. The default is pixelate.exe,
    // which lets the operating system resolve the executable through PATH.
    const executable = configuredPath || 'pixelate.exe';

    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cwd = workspace || path.dirname(editor.document.fileName);

    output.clear();
    output.appendLine(`Running: ${executable} ${editor.document.fileName}`);
    output.show(true);

    const child = spawn(executable, [editor.document.fileName], {
        cwd,
        windowsHide: false
    });

    child.stdout.on('data', data => output.append(data.toString()));
    child.stderr.on('data', data => output.append(data.toString()));

    child.on('error', error => {
        output.appendLine(`\nFailed to start Pixelate: ${error.message}`);
        vscode.window.showErrorMessage(
            `Could not start Pixelate runtime: ${error.message}`
        );
    });

    child.on('close', code => {
        output.appendLine(`\nPixelate exited with code ${code}.`);
    });
}

function activate(context) {
    const diagnostics = vscode.languages.createDiagnosticCollection('pxl');
    const output = vscode.window.createOutputChannel('Pixelate');
    let documentation = loadDocumentation(context);
    const hoverProvider = vscode.languages.registerHoverProvider(
        'pxl',
        { provideHover: (document, position) => provideHover(document, position, documentation) }
    );

    const reloadDocumentation = () => {
        documentation = loadDocumentation(context);
    };

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        const documentationWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, '**/pxldocs/*.pxldoc')
        );

        context.subscriptions.push(
            documentationWatcher,
            documentationWatcher.onDidCreate(reloadDocumentation),
            documentationWatcher.onDidChange(reloadDocumentation),
            documentationWatcher.onDidDelete(reloadDocumentation)
        );
    }

    function refresh(document) {
        if (document.languageId === 'pxl') {
            diagnostics.set(document.uri, validate(document));
        }
    }

    context.subscriptions.push(diagnostics);
    context.subscriptions.push(output);
    context.subscriptions.push(hoverProvider);
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'pixelate.runCurrentFile',
            () => runCurrentFile(context, output)
        )
    );
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(refresh),
        vscode.workspace.onDidChangeTextDocument(event => refresh(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri))
    );

    vscode.workspace.textDocuments.forEach(refresh);
}

function deactivate() {
}

module.exports = {
    activate,
    deactivate
};
