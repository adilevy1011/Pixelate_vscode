const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
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

const documentation = {
    window: '**window**\n\nDefines the application window and its configuration.',
    id: '**id**\n\nGives a window a unique string identifier. Required when a file contains multiple windows. The window with id `main` opens first.',
    script: '**script**\n\nContains commands that create and configure UI elements.',
    add: '**add**\n\nAdds a label, par, button, textbox, textarea, `rect`, `circle`, `triangle`, or `CLOSE_TRIGGER` to the application.',
    label: '**label**\n\nCreates a non-clickable text widget.',
    par: '**par**\n\nCreates a multiline paragraph text widget with wrapping.',
    button: '**button**\n\nCreates a clickable button widget.',
    textbox: '**textbox**\n\nCreates an editable text input. Read its current contents with `inputId.text`.',
    textarea: '**textarea**\n\nCreates a multiline editable text input. Read its current contents with `inputId.text`.',
    rect: '**rect**\n\nCreates a filled rectangle with `x`, `y`, `width`, `height`, and clockwise `angle` in degrees.',
    circle: '**circle**\n\nCreates a filled circle. `x` and `y` specify its center; `radius` defaults to 10.',
    triangle: '**triangle**\n\nCreates a filled triangle from `p1`, `p2`, and `p3` coordinate pairs. Omit all three for an upward equilateral triangle with side length about 10. When supplied with both `x` and `y`, the triangle is placed by its centroid. Its `angle` rotates it clockwise around that centroid.',
    placeholder: '**placeholder**\n\nText shown in an empty textbox. It disappears when the textbox receives input.',
    onclick: '**onclick**\n\nDefines actions that run when a button is clicked.',
    update: '**update**\n\nUpdates a widget or window property. Example: `update greeting.text = "Hello"`.',
    title: '**title**\n\nSets the window title text.',
    iconPath: '**iconPath**\n\nSets the path to the application icon.',
    width: '**width**\n\nSets a window or widget width in pixels.',
    height: '**height**\n\nSets a window or widget height in pixels.',
    font: '**font**\n\nSets a widget font. Supported constants include `ARIAL`, `CALIBRI`, `CONSOLAS`, `COURIERNEW`, `TIMESNEWROMAN`, `TAHOMA`, and `VERDANA`.',
    fontSize: '**fontSize**\n\nSets widget text size in pixels.',
    angle: '**angle**\n\nSets a rectangle or triangle rotation in clockwise degrees.',
    radius: '**radius**\n\nSets a circle radius. Use `circleId.radius++` or `circleId.radius--` to change it incrementally.',
    p1: '**p1**\n\nTriangle point one, written as `(x, y)`.',
    p2: '**p2**\n\nTriangle point two, written as `(x, y)`.',
    p3: '**p3**\n\nTriangle point three, written as `(x, y)`.',
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
    if: '**if**\n\nRuns a block when a condition is true. Conditions support `&&`, `||`, `!`, comparisons, and parentheses.',
    while: '**while**\n\nRepeats a block while a condition is true. Conditions support `&&`, `||`, `!`, comparisons, and parentheses.',
    for: '**for**\n\nRepeats a block using a numeric initializer, condition, and `++` increment.',
    switch_view: '**switch_view**\n\nOpens another identified window. The current window is destroyed by default. Use `switch_view("settings", destroy_window = false);` to keep it open.\n\nExample: `switch_view("settings");`',
    destroy_window: '**destroy_window**\n\nOptional `switch_view` argument. Set it to `false` to keep the current window open while opening the destination window.',
    trigger: '**trigger**\n\nRuns a block when a condition becomes true, when `mouseMove` occurs, or when `onkey("a")`/`onkeyci("a")` receives a key.',
    onkey: '**onkey**\n\nTriggers on an exact, case-sensitive key. Named keys include `space`, `esc`, `enter`, `shift`, `alt`, `up`, `down`, `left`, `right`, and `tab`.',
    onkeyci: '**onkeyci**\n\nTriggers on a key without distinguishing upper and lower case.',
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
