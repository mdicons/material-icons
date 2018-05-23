const vscode = require('vscode');
const fs = require('fs');
const yauzl = require("yauzl");
const request = require('request');

var library =
{    
    onDidChangeEvent: new vscode.EventEmitter(),
    get onDidChange()
    {
        return this.onDidChangeEvent.event;
    },
    update(uri)
    {
        this.onDidChangeEvent.fire(uri);
    },
    provideTextDocumentContent(uri)
    {
        let content = this.getTemplate()
            .replace("/*style*/", this.getStyle())
            .replace("/*icons*/", this.iconHTML)
            .replace("/*script*/", this.getScript());

        return content;
    },

    getTemplate()
    {
        return fs.readFileSync(`${this.directory}/templates/${this.state.template.toLowerCase()}.html`).toString();
    },
    getStyle()
    {
        if(this.state.template == "OK")
            return fs.readFileSync(`${this.directory}/styles/${this.state.style.toLowerCase()}.css`).toString();
        else
            return "";
    },
    getScript()
    {
        return `var state = JSON.parse('${JSON.stringify(this.state)}')`;
    },

    scheme: 'material-icons',
    uri: vscode.Uri.parse('material-icons://authority/Icons Library'),
    data: null,
    iconHTML: "",

    activate(dir)
    {
        this.directory = dir;
        if(!fs.existsSync(`${dir}/data/`)) fs.mkdirSync(`${dir}/data`);

        this.state = 
            fs.existsSync(`${dir}/data/state.json`) ?
                JSON.parse(fs.readFileSync(`${dir}/data/state.json`, 'utf8')):
                {
                    style: "LIST",
                    bookmarks: false
                };

        this.bookmarks = 
            fs.existsSync(`${dir}/data/bookmarks.json`) ?
                JSON.parse(fs.readFileSync(`${dir}/data/bookmarks.json`, 'utf8')):
                {};

        if(fs.existsSync(`${dir}/data/icons.json`))
        {
            this.parse();
        }
        else if(fs.existsSync(`${dir}/data/raw.zip`))
        {
            this.extract();
        }
        else
        {
            this.state.template = "EMPTY";
            // this.download();
        }
    },
    deactivate()
    {
        // Reset temporary variables
        this.state.task = 0;

        // Save data
        if(this.data)
            fs.writeFileSync(`${this.directory}/data/icons.json`, JSON.stringify(this.data));
        fs.writeFileSync(`${this.directory}/data/bookmarks.json`, JSON.stringify(this.bookmarks));        
        fs.writeFileSync(`${this.directory}/data/state.json`, JSON.stringify(this.state));
    },
    reload()
    {
        if(fs.existsSync(`${this.directory}/data/icons.json`))
        {
            this.parse();
        }
        else if(fs.existsSync(`${this.directory}/data/raw.zip`))
        {
            this.extract();
        }
        else
        {
            this.state.template = "EMPTY";

            this.update(this.uri);
            // this.download();
        }
    },

    setEditor(e)
    {
        this.editor = e;
    },
    showLibrary()
    {
        this.setEditor(vscode.window.activeTextEditor);
        return vscode.commands.executeCommand('vscode.previewHtml', this.uri, vscode.ViewColumn.Two, 'Icons Library')
            .then(
                (success) => {

                }, 
                (reason) => {
                    vscode.window.showErrorMessage(reason);
                });
    },
    updateLibrary()
    {
        this.download();
    },
    download()
    {
        if(this.state.task == 1) return;
        this.state.task = 1;
        this.state.template = "LOADING";
        this.state.info = "DOWNLOADING";
        this.update(this.uri);
        
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Downloading...",
                cancellable: true
            }, 
            (progress, token) =>
            {   
                let cancelled = false;

                let p = new Promise((resolve, reject) =>
                {
                    let length;
                    let displayLength;
                    let current = 0;
                    let size = 0;
                    let last = process.hrtime();
                    
                    let httpRequest = request
                        .get('https://github.com/google/material-design-icons/archive/master.zip')
                    httpRequest
                        .on('response', response =>
                        {
                            length = parseInt(response.headers['content-length'], 10); // 1048576
                            displayLength = (length / 1048576).toFixed(1);
                        })
                        .on('data', chunk =>
                        {
                            size += chunk.length;
                            current += (chunk.length / length * 100);

                            let elapsed = process.hrtime(last);
                            if((elapsed[0] * 1000 + elapsed[1] / 1000000) > 100 && current >= 1)
                            {
                                last = process.hrtime();
                                current--;
                                let msg = `Downloading – ${(size / 1048576).toFixed(1)} of ${displayLength} MB`;
                                progress.report({increment: 1, message: msg});                            
                            }
                        })
                        .on('end', resolve.bind(this))
                        .on('error', reject.bind(this))
                        .pipe(fs.createWriteStream(`${this.directory}/data/raw.zip`))

                    token.onCancellationRequested(() => {
                        cancelled = true;
                        httpRequest.abort();
                    });
                });
                p.then(() =>
                {
                    this.state.task = 0;
                    cancelled ?
                        this.reload():
                        this.extract();
                });
                p.catch(() => 
                {
                    this.state.task = 0;
                    this.state.template = "ERROR";
                    this.state.info = "DOWNLOADING";
                    this.update(this.uri);
                })
                return p;
            })
    },
    extract()
    {
        if(this.state.task == 2) return;
        this.state.task = 2;
        this.state.template = "LOADING";
        this.state.info = "EXTRACTING";
        this.update(this.uri);

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Extracting...",
                cancellable: false
            }, 
            (progress, token) =>
            {   
                let p = new Promise((resolve, reject) =>
                {
                    let data = {};
                    yauzl.open(`${this.directory}/data/raw.zip`, {lazyEntries: true}, (err, zip) =>
                    {
                        if(err) 
                        {
                            reject(err);
                        }

                        let length = zip.entryCount;
                        let current = 0;
                        let size = 0;
                        let last = process.hrtime();

                        zip.readEntry();
                        zip.on('entry', entry =>
                        {
                            size++;
                            current += (100 / length);

                            let elapsed = process.hrtime(last);
                            if((elapsed[0] * 1000 + elapsed[1] / 1000000) > 100 && current >= 1)
                            {
                                last = process.hrtime();
                                current -= 2;
                                let msg = `Extracting – ${(size / length * 100).toFixed(0)}%`;
                                progress.report({increment: 2, message: msg});                            
                            }

                            if (match = /material-design-icons-master\/(\w+)\/svg\/production\/ic\_(.+)\_24px\.svg/.exec(entry.fileName)) 
                            {
                                zip.openReadStream(entry, function(err, readStream) 
                                {
                                    if (err) throw err;
                                    const chunks = [];
                                    readStream.on("data", function(c) 
                                    {
                                        chunks.push(c);
                                    });
                                    readStream.on("end", function() 
                                    {
                                        if(!data[match[1]]) data[match[1]] = {};
                                        data[match[1]][match[2]] = 
                                            Buffer.concat(chunks).toString().replace(/<\/?svg.*?>/g, "").replace(/fill=".*?"/g, ""),
                                        zip.readEntry();
                                    });
                                });
                            } 
                            else 
                            {
                                zip.readEntry();
                            }
                        });
                        zip.on('end', () =>
                        {
                            this.data = data;
                            fs.writeFileSync(`${this.directory}/data/icons.json`, JSON.stringify(data));
                            resolve(); 
                        });
    
                    });
                });
                p.then(() =>
                {
                    this.state.task = 0;
                    this.parse();
                })
                .catch(() =>
                {
                    this.state.task = 0;
                    this.state.template = "ERROR";
                    this.state.info = "EXTRACTING";
                    this.update(this.uri);
                });
                return p;
            });
    },
    parse()
    {
        this.iconHTML = "";

        if(!this.data) 
            this.data = JSON.parse(fs.readFileSync(`${this.directory}/data/icons.json`));

        for (const categoryName in this.data) 
        {
            if (!this.data.hasOwnProperty(categoryName)) return;
            if(!this.bookmarks[categoryName]) this.bookmarks[categoryName] = [];
            let niceName = categoryName.replace(/_/g, " ");
            
            this.iconHTML += `<div class="mdi--container" data-category="${categoryName}"><h2 class="mdi--category">${niceName}</h2>`;

            for (const iconName in this.data[categoryName]) 
            {
                if (!this.data[categoryName].hasOwnProperty(iconName)) return;
                let niceName = iconName.replace(/_/g, " ");
                
                
                this.iconHTML += 
                `   
                <div data-name="${iconName}" data-category="${categoryName}" class="mdi--icon ${this.bookmarks[categoryName].indexOf(iconName) > -1 ? "checked" : ""}">
                    <a class="mdi--icon--link">
                        <svg class="mdi--icon--preview" viewBox="0 0 24 24">
                            ${this.data[categoryName][iconName]}
                        </svg>
                        <p class="mdi--icon--caption">
                            ${niceName}
                        </p>
                    </a>
                    <div class="mdi--icon--actions">
                        <svg class="mdi--icon--action mdi--icon--bookmark" viewBox="0 0 24 24">
                            <path class="true" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                            <path class="false" d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/>
                        </svg>
                        <svg class="mdi--icon--action mdi--icon--clone" viewBox="0 0 24 24">
                            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                        </svg>
                    </div>
                </div>
                `;
            }
            this.iconHTML += `<hr class="mdi--separator"></div>`;
        }
        this.state.template = "OK";
        this.state.info = "";
        this.update(this.uri);
    },
    insertIcon(cat, icon)
    {
        if(!this.editor)
        {
            window.showInformationMessage('No editor selected');
            return;
        }
        if (vscode.window.visibleTextEditors.indexOf(this.editor) > -1) 
        {
            let insertions = [];
            let source = this.data[cat][icon];

            this.editor.edit(edit => 
            {
                for (const selection of this.editor.selections)
                {
                    let counter = 0;
                    let text = this.editor.document.getText(selection);
                    
                    let newText = text.replace(
                        /(<svg[^>]*>\s*)[^]*?(\s*<\/svg>)/g, 
                        (match, start, end) =>
                        {
                            counter++;
                            return start + source + end;
                        });
                    counter ?
                        edit.replace(selection, newText):
                        insertions.push(selection);
                }
            });
            if(insertions.length)
            {
                this.editor.insertSnippet(
                    new vscode.SnippetString(
                        `<svg class="material-icon$1" viewBox="0 0 24 24">\n\t${source}\n</svg>`), 
                    insertions);
            }
        }
        vscode.window.showTextDocument(this.editor.document.uri);
    },

    setBookmark(icon, cat, value)
    {
        let index = this.bookmarks[cat].indexOf(icon);
        if(value && index == -1)
            this.bookmarks[cat].push(icon);
        else if(!value && index > -1)
            this.bookmarks[cat].splice(index, 1);
    },
    setView(style)
    {
        this.state.style = style;
        this.update(this.uri);
    },
    changeBookmarksView(visible)
    {
        this.state.bookmarks = Boolean(visible);
    },
    copySource(cat, icon)
    {
        let copy = this.editor.selections;
        this.editor.selections = [this.editor.selection];

        let source = this.data[cat][icon];
        this.editor.edit(edit =>
        {
            edit.replace(this.editor.selection, source);
        });
        
        vscode.window.showTextDocument(this.editor.document.uri);
        vscode.commands.executeCommand('editor.action.clipboardCopyAction');
        vscode.commands.executeCommand('undo');
        vscode.window.showInformationMessage(`[ ${icon.replace(/_/g, " ")} ] - copied to clipboard`);
        this.editor.selections = copy;
    },

    dispatchEvent(fun, args)
    {
        if(this[fun]) 
            args ?
            this[fun](...args):
            this[fun]();
    }
}

exports.activate = function(context) 
{
    library.activate(context.extensionPath);

    var registration = 
        vscode.workspace.registerTextDocumentContentProvider(library.scheme, library);

    let commands = 
    [
        vscode.commands.registerCommand('materialIcons.showLibrary', library.showLibrary.bind(library)),
        vscode.commands.registerCommand('materialIcons.updateLibrary', library.updateLibrary.bind(library)),
        vscode.commands.registerCommand('materialIcons.insertIcon', library.insertIcon.bind(library)),
        vscode.commands.registerCommand('materialIcons.dispatchEvent', library.dispatchEvent.bind(library))
    ];

    vscode.workspace.onDidChangeTextDocument(e => 
    {
        if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) 
        {
            library.setEditor(vscode.window.activeTextEditor);
		}
    });
    vscode.window.onDidChangeActiveTextEditor(e => 
    {
        if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) 
        {
            library.setEditor(vscode.window.activeTextEditor);
		}
    });
    vscode.window.onDidChangeTextEditorSelection(e => 
    {
        if (vscode.window.activeTextEditor && e.textEditor === vscode.window.activeTextEditor) 
        {
            library.setEditor(vscode.window.activeTextEditor);
		} 
    })
        
    context.subscriptions.push(...commands, registration);
}
exports.deactivate = function() 
{
    library.deactivate();
}
