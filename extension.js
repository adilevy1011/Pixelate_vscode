const vscode = require('vscode');
const path = require('path');
const { spawn } = require('child_process');

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

    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
        const original = document.lineAt(lineNumber).text;
        const line = original.trim();

        if (line === '' || line.startsWith('#')) {
            continue;
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

        if (/^(label|button)\s+[A-Za-z_][A-Za-z0-9_]*\s*\{$/.test(line)) {
            continue;
        }

        if (/^add\s+(label|button)\s+[A-Za-z_][A-Za-z0-9_]*\s*\{$/.test(line)) {
            continue;
        }

        if (/^add\s+CLOSE_TRIGGER\s*\{$/.test(line)) {
            continue;
        }

        if (/^onclick\s*\{$/.test(line)) {
            continue;
        }

        if (/^trigger\s*\(\s*mouseMove\s*\)\s*\{$/.test(line) ||
            /^trigger\s*\(\s*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?\s*(==|!=|<=|>=|<|>)\s*(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?|-?\d+(?:\.\d+)?|true|false)\s*\)\s*\{$/.test(line)) {
            continue;
        }

        if (/^(if|while)\s*\(\s*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?\s*(==|!=|<=|>=|<|>)\s*(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?|-?\d+(?:\.\d+)?|true|false|"(?:\\.|[^"\\])*")\s*\)\s*\{$/.test(line)) {
            continue;
        }

        if (/^for\s*\(\s*(int|short|long|float|double)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*-?\d+(?:\.\d+)?\s*;\s*[A-Za-z_][A-Za-z0-9_]*\s*(==|!=|<=|>=|<|>)\s*(?:[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)\s*;\s*[A-Za-z_][A-Za-z0-9_]*\+\+\s*\)\s*\{$/.test(line)) {
            continue;
        }

        if (/^[A-Za-z_][A-Za-z0-9_]*\+\+;?$/.test(line)) {
            continue;
        }

        if (/^(int|short|long)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*-?\d+;?$/.test(line) ||
            /^(float|double)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*-?\d+(?:\.\d+)?;?$/.test(line) ||
            /^bool\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*(true|false);?$/.test(line) ||
            /^char\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*'(?:\\.|[^'\\])';?$/.test(line) ||
            /^String\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*"(?:\\.|[^"\\])*";?$/.test(line)) {
            continue;
        }

        if (line === '}') {
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
            /^[A-Za-z_][A-Za-z0-9_]*\.(x|y|width|height)\s*=\s*-?\d+$/.test(line) ||
            /^mouse\.shape\s*=\s*(ARROW|IBEAM|WAIT|CROSS|UPARROW|SIZE|ICON|SIZENWSE|SIZENESW|SIZEWE|SIZENS|SIZEALL|NO|HAND|APPSTARTING|HELP|PIN|PERSON)$/.test(line)) {
            continue;
        }

        if (/^update\s+[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?\s*=\s*"(?:\\.|[^"\\])*"$/.test(line)) {
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

        if (/^(title|iconPath|text|message)\s*:\s*"(?:\\.|[^"\\])*"$/.test(line)) {
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

        if (/^(title|iconPath|text|message|options|width|height|x|y|background)\b/.test(line)) {
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

const documentation = {
    window: '**window**\n\nDefines the application window and its configuration.',
    script: '**script**\n\nContains commands that create and configure UI elements.',
    add: '**add**\n\nAdds a label, button, or `CLOSE_TRIGGER` to the application.',
    label: '**label**\n\nCreates a non-clickable text widget.',
    button: '**button**\n\nCreates a clickable button widget.',
    onclick: '**onclick**\n\nDefines actions that run when a button is clicked.',
    update: '**update**\n\nUpdates a widget or window property. Example: `update greeting.text = "Hello"`.',
    title: '**title**\n\nSets the window title text.',
    iconPath: '**iconPath**\n\nSets the path to the application icon.',
    width: '**width**\n\nSets a window or widget width in pixels.',
    height: '**height**\n\nSets a window or widget height in pixels.',
    x: '**x**\n\nSets the horizontal position of a widget.',
    y: '**y**\n\nSets the vertical position of a widget.',
    text: '**text**\n\nSets the displayed text for a label or button.',
    background: '**background**\n\nSets an RGB background color. Each channel must be between 0 and 255.',
    CLOSE_TRIGGER: '**CLOSE_TRIGGER**\n\nAdds an optional Yes/No confirmation dialog when the window closes.',
    message: '**message**\n\nSets the close-confirmation message.',
    options: '**options**\n\nSets close-confirmation options. The currently supported value is `YESNO`.',
    YESNO: '**YESNO**\n\nDisplays Yes and No buttons in a close-confirmation dialog.',
    int: '**int**\n\nDeclares a whole-number variable.',
    short: '**short**\n\nDeclares a small whole-number variable.',
    long: '**long**\n\nDeclares a large whole-number variable.',
    float: '**float**\n\nDeclares a single-precision decimal variable.',
    double: '**double**\n\nDeclares a double-precision decimal variable.',
    bool: '**bool**\n\nDeclares a `true` or `false` variable.',
    char: '**char**\n\nDeclares a single-character variable.',
    String: '**String**\n\nDeclares a text variable.',
    if: '**if**\n\nRuns a block when a comparison is true.',
    while: '**while**\n\nRepeats a block while a comparison is true.',
    for: '**for**\n\nRepeats a block using a numeric initializer, condition, and `++` increment.',
    trigger: '**trigger**\n\nRuns a block when a condition becomes true or when a `mouseMove` event occurs.',
    mouse: '**mouse**\n\nProvides `mouse.x` and `mouse.y`, and supports cursor shape updates.',
    ARROW: '**ARROW**\n\nThe standard arrow cursor.',
    IBEAM: '**IBEAM**\n\nThe text-selection cursor.',
    WAIT: '**WAIT**\n\nThe busy/wait cursor.',
    CROSS: '**CROSS**\n\nThe crosshair cursor.',
    UPARROW: '**UPARROW**\n\nThe vertical arrow cursor.',
    SIZE: '**SIZE**\n\nThe all-direction resize cursor.',
    ICON: '**ICON**\n\nThe legacy icon cursor.',
    SIZENWSE: '**SIZENWSE**\n\nDiagonal resize cursor.',
    SIZENESW: '**SIZENESW**\n\nDiagonal resize cursor.',
    SIZEWE: '**SIZEWE**\n\nHorizontal resize cursor.',
    SIZENS: '**SIZENS**\n\nVertical resize cursor.',
    SIZEALL: '**SIZEALL**\n\nMove cursor.',
    NO: '**NO**\n\nThe unavailable cursor.',
    HAND: '**HAND**\n\nThe hand cursor.',
    APPSTARTING: '**APPSTARTING**\n\nThe arrow-plus-busy cursor.',
    HELP: '**HELP**\n\nThe help cursor.',
    PIN: '**PIN**\n\nThe pin cursor when supported by Windows.',
    PERSON: '**PERSON**\n\nThe person cursor when supported by Windows.'
};

function findWidgetDocumentation(document, word) {
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
        `^\\s*(?:add\\s+)?(label|button)\\s+${escapedWord}\\s*\\{`
    );

    const lines = document.getText().split(/\r?\n/);
    const declarationIndex = lines.findIndex(line => pattern.test(line));

    if (declarationIndex === -1) {
        return undefined;
    }

    const declaration = lines[declarationIndex].match(pattern);
    const type = declaration[1] === 'button' ? 'Button' : 'Label';
    const details = [`**${word}**`, `\n${type} widget.`];
    let braceDepth = 1;

    for (let index = declarationIndex + 1; index < lines.length; index++) {
        const line = lines[index];
        const property = line.trim().match(/^(text|x|y|width|height)\s*:\s*(.+)$/);

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

function provideHover(document, position) {
    const range = document.getWordRangeAtPosition(
        position,
        /[A-Za-z_][A-Za-z0-9_]*/
    );

    if (!range) {
        return undefined;
    }

    const word = document.getText(range);
    const markdown = documentation[word] ||
        findWidgetDocumentation(document, word);

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

    let executable = expandWorkspaceVariable(configuredPath);

    if (!configuredPath || configuredPath === '${workspaceFolder}/pixelate.exe') {
        if (!vscode.workspace.workspaceFolders) {
            executable = path.join(context.extensionPath, '..', 'pixelate.exe');
        }
    }

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
    const hoverProvider = vscode.languages.registerHoverProvider(
        'pxl',
        { provideHover }
    );

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
