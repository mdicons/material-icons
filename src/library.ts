import * as vscode from 'vscode';
import * as fs from 'fs';
import * as request from 'request';
import * as yauzl from 'yauzl';
import { METHODS } from 'http';
import { domainMatch } from '../node_modules/@types/tough-cookie';

interface IconData {
    [key: string]: {
        [key: string]: string;
    };
}
interface BookmarkData {
    [key: string]: Array<string>;
}
interface State {
    template?: string;
    bookmarks?: Boolean;
    style?: string;

    meta?: {
        [key: string]: string;
    };
}

export class Library implements vscode.TextDocumentContentProvider
{
    static readonly uri = vscode.Uri.parse('material-icons://authority/Icons Library');
    static readonly scheme = 'material-icons';

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private _content: string;
    private _activeEditor: vscode.TextEditor;
    private _registration: vscode.Disposable;
    private _path: string;
    private _data: IconData;
    private _state: State;
    private _bookmarks: BookmarkData;

    constructor(path: string)
    {
        this._registration = vscode.workspace.registerTextDocumentContentProvider(Library.scheme, this);
        this._path = FileProvider.path = path;

        if(!fs.existsSync(`${path}/data`))
            fs.mkdirSync(`${path}/data`);

        this.setAcitveTextEditor(vscode.window.activeTextEditor);
        this._loadState();
        this.reload();
    }
    deconstructor()
    {
        this._registration.dispose();
        this._onDidChange.dispose();

        this._saveState();
    }
    
    get onDidChange() {
        return this._onDidChange.event;
    }
    public provideTextDocumentContent(uri: vscode.Uri): string
    {
        return FileProvider.parseTemplate(
            this._state.template, 
            { 
                ...this._state.meta, 
                style: FileProvider.getStyle(this._state.style), 
                bookmarks: (this._state.bookmarks ? "bookmarks-only" : "") 
            });
    }
    public change(): void
    {
        this._onDidChange.fire(Library.uri)
    }

    private _loadState()
    {
        let data: State = 
            fs.existsSync(`${this._path}/data/state.json`) ?
            JSON.parse(fs.readFileSync(`${this._path}/data/state.json`).toString()):
            {}; 
        this._state = 
        {
            template: data.template || "normal",
            style: data.style || "list",
            bookmarks: data.bookmarks || false,
            meta: {}
        }
        this._bookmarks = 
            fs.existsSync(`${this._path}/data/bookmarks.json`) ?
            JSON.parse(fs.readFileSync(`${this._path}/data/bookmarks.json`).toString()):
            {};
    }
    private _saveState()
    {
        let data = {
            tempalte: this._state.template,
            style: this._state.style,
            bookmarks: this._state.bookmarks,
        }
        fs.writeFileSync(`${this._path}/data/state.json` ,JSON.stringify(data, null, 4));
        fs.writeFileSync(`${this._path}/data/bookmarks.json` ,JSON.stringify(this._bookmarks, null, 4));
    }

    public async reload()
    {
        if(fs.existsSync(`${this._path}/data/icons.json`))
        {
            this._state.template = "normal";
            this._state.meta = {icons: this.generateIconsHTML()};
            this.change();
        }
        else if(fs.existsSync(`${this._path}/data/raw.zip`))
        {
            this._state.template = "loading";
            this._state.meta = {
                header: "EXTRACTING",
                title: 'Converting icons to JSON file<br>Please wait.'
            }
            this.change();
            await this.extract();

            this._state.template = "normal";
            this._state.meta = {icons: this.generateIconsHTML()};
            this.change();
        }
        else
        {
            this._state.template = "empty";
            this.change();
        }
    }
    public async update()
    {
        this._state.template = "loading";        
        this._state.meta = {
            header: "DOWNLOADING",
            title: 'Downloading the latest icon pack from Google repository<br>Please wait.'
        };
        this.change();
        let success = await this.download();
        if(!success)
        {
            this._state.template = "error";
            this._state.meta = {
                operation: 'downloaded'
            };
            this.change();
            return;
        }

        this._state.template = "loading";
        this._state.meta = {
            header: "EXTRACTING",
            title: 'Converting icons to JSON file<br>Please wait.'
        };
        this.change();
        success = await this.extract();
        if(!success)
        {
            this._state.template = "error";
            this._state.meta = {
                operation: 'extracted'
            };
            this.change();
            return;
        }
        
        this._state.template = "normal";
        this._state.meta = {icons: this.generateIconsHTML()};
        this.change();
    };

    public setAcitveTextEditor(editor: vscode.TextEditor): void
    {
        if (editor ||
            vscode.window.visibleTextEditors.indexOf(this._activeEditor) == -1) 
            this._activeEditor = editor;
    }
    public show(): void
    {
        vscode.commands.executeCommand('vscode.previewHtml', Library.uri, vscode.ViewColumn.Two, 'Icons Library')
            .then(null, reason => {
                vscode.window.showErrorMessage(reason);
            });
    }
    
    public download()
    {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: ""
            }, 
            (progress: vscode.Progress<{message: string}>): Promise<{}> => 
            {   
                return new Promise((resolve, reject) =>
                {
                    let path = `${this._path}/data/.raw`;
                    let stream = fs.createWriteStream(path);

                    let displayLength: string;
                    let current = 0;
                    let size = 0;
                    let last = process.hrtime();

                    let httpRequest = request
                        .get('https://github.com/google/material-design-icons/archive/master.zip')
                        .on('response', response =>
                        {
                            displayLength = (parseInt(response.headers['content-length'], 10) / 1048576).toFixed(1);
                        })
                        .on('data', chunk =>
                        {
                            size += chunk.length;
                            let elapsed = process.hrtime(last);
                            if((elapsed[0] * 1000 + elapsed[1] / 1000000) > 100)
                            {
                                last = process.hrtime();
                                progress.report({
                                    message: `Downloading – ${(size / 1048576).toFixed(1)} of ${displayLength} MB`
                                }) 
                            }
                        })
                        .on('end', () =>
                        {
                            fs.rename(path, `${this._path}/data/raw.zip`, err =>
                            {
                                if (err)
                                {
                                    console.error(err);
                                    resolve(false);
                                }
                                else
                                    resolve(true);
                            });
                        })
                        .on('error', (e) => 
                        {
                            stream.end();
                            if(fs.existsSync(path)) 
                                fs.unlinkSync(path);
                            resolve(false);
                        })
                        .pipe(stream)
                });
            })
    }
    public extract()
    {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: ""
            }, 
            (progress: vscode.Progress<{message: string}>): Promise<{}> =>
            {   
                return new Promise((resolve, reject) =>
                {
                    let data: IconData = {};
                    let path = `${this._path}/data/icons.json`;
                    yauzl.open(`${this._path}/data/raw.zip`, {lazyEntries: true}, (err, zip) =>
                    {
                        if(err) resolve(false);

                        let length = zip.entryCount;
                        let size = 0;
                        let last = process.hrtime();

                        zip.readEntry();
                        zip.on('entry', (entry: yauzl.Entry) =>
                        {
                            size++;

                            const elapsed = process.hrtime(last);
                            if((elapsed[0] * 1000 + elapsed[1] / 1000000) > 100)
                            {
                                last = process.hrtime();
                                progress.report({message: `Extracting – ${(size / length * 100).toFixed(0)}%`});
                            }

                            const match = /material-design-icons-master\/(\w+)\/svg\/production\/ic\_(.+)\_24px\.svg/.exec(entry.fileName)
                            if (match) 
                            {
                                zip.openReadStream(entry, function(err, readStream) 
                                {
                                    if (err) throw err;
                                    let chunks: Array<Buffer> = [];
                                    readStream.on("data", function(c) 
                                    {
                                        chunks.push(<Buffer>c);
                                    });
                                    readStream.on("end", function() 
                                    {
                                        if(!data[match[1]]) data[match[1]] = {};
                                        data[match[1]][match[2]] = 
                                            Buffer
                                                .concat(chunks)
                                                .toString()
                                                .replace(/<\/?svg.*?>/g, "")
                                                .replace(/fill=".*?"/g, "");

                                        zip.readEntry();
                                    });
                                });
                            } 
                            else zip.readEntry();
                        });
                        zip.on('end', () =>
                        {
                            fs.writeFile(path, JSON.stringify(data, null, 4), (err) =>
                            {
                                if(err) 
                                {
                                    if(fs.existsSync(path)) 
                                        fs.unlinkSync(path);            
                                    resolve(false);
                                }
                                else resolve(true); 
                            });
                        });
                    });
                });
            });
    }
    public generateIconsHTML(): string
    {
        let html = "";

        if(!this._data) 
            this._data = JSON.parse(fs.readFileSync(`${this._path}/data/icons.json`).toString());

        for (const categoryName in this._data) 
        {
            if (!this._data.hasOwnProperty(categoryName)) continue;
            if(!this._bookmarks[categoryName]) this._bookmarks[categoryName] = [];
            let categoryTitle = categoryName.replace(/_/g, " ");
            
            let icons = "";
            for (const iconName in this._data[categoryName]) 
            {
                if (!this._data[categoryName].hasOwnProperty(iconName)) continue;
                let iconTitle = iconName.replace(/_/g, " ");                

                icons += FileProvider.parseTemplate("iconPreview", 
                {
                    iconName: iconName,
                    iconTitle: iconTitle,
                    source: this._data[categoryName][iconName],
                    checked: (this._bookmarks[categoryName].indexOf(iconName) > -1 ? "checked" : ""),

                    categoryName: categoryName,
                    categoryTitle: categoryTitle
                });
            }

            html += FileProvider.parseTemplate("category", 
            {
                categoryName: categoryName,
                categoryTitle: categoryTitle,
                icons: icons
            });
        }

        return html;
    }

    insertIcon(cat: string, icon: string)
    {
        if(!this._activeEditor)
        {
            vscode.window.showInformationMessage('No editor selected');
            return;
        }
        if (vscode.window.visibleTextEditors.indexOf(this._activeEditor) > -1) 
        {
            let insertions: vscode.Selection[] = [];
            let source = this._data[cat][icon];
            let settings = vscode.workspace.getConfiguration('material-icons');

            this._activeEditor.edit(edit => 
            {
                for (const selection of this._activeEditor.selections)
                {
                    let counter = 0;
                    let text = this._activeEditor.document.getText(selection);
                    let newText = "";

                    if(settings.useFont)
                    {
                        let safeClass = settings.classList.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");

                        newText = text.replace(
                            new RegExp('(<i[^>]*class=(["\']?)(?:[^\\2]* )?'+safeClass+'(?: [^\\2]*)?\\2[^>]*>\\s*)[^]*?(\\s*<\\/i>)', "g"),
                            (match, start, symbol, end) =>
                            {
                                console.log(match, start, symbol, end);
                               counter++;
                               return start + icon + end;
                            });
                    }
                    else
                    {
                        newText = text.replace(
                            /(<svg[^>]*>\s*)[^]*?(\s*<\/svg>)/g, 
                            (match, start, end) =>
                            {
                                counter++;
                                return start + source + end;
                            });
                    }
                    counter ?
                        edit.replace(selection, newText):
                        insertions.push(selection);
                }
            });
            if(insertions.length)
            {
                this._activeEditor.insertSnippet(
                    new vscode.SnippetString(
                        (settings.useFont ?
                            `<i class="${settings.classList}">${icon}</i>` :
                            `<svg class="${settings.classList}" viewBox="0 0 24 24"${settings.includeXmlns ? ' xmlns="http://www.w3.org/2000/svg"' : ''}>\n\t${source}\n</svg>`)),
                        insertions);
            }
        }
    }
    public copyToClipboard(cat: string, icon: string)
    {
        if(!this._activeEditor) return;
        let settings = vscode.workspace.getConfiguration('material-icons');
        let copy = this._activeEditor.selections;
        this._activeEditor.selections = [this._activeEditor.selection];

        let source = this._data[cat][icon];
        this._activeEditor.edit(edit =>
        {
            edit.replace(
                this._activeEditor.selection, 
                (settings.useFont ?
                    `<i class="${settings.classList}">${icon}</i>`:
                    `<svg class="${settings.classList}" viewBox="0 0 24 24"${settings.includeXmlns ? ' xmlns="http://www.w3.org/2000/svg"' : ''}>\n\t${source}\n</svg>`)
            );  
        });
        
        vscode.window.showTextDocument(this._activeEditor.document.uri, {viewColumn: this._activeEditor.viewColumn});
        vscode.commands.executeCommand('editor.action.clipboardCopyAction');
        vscode.commands.executeCommand('undo');
        vscode.window.showInformationMessage(`[ ${icon.replace(/_/g, " ")} ] - copied to clipboard`);
        this._activeEditor.selections = copy;
    };
    public setBookmark(icon: string, cat: string, value: Boolean)
    {
        let index = this._bookmarks[cat].indexOf(icon);
        if(value && index == -1)
            this._bookmarks[cat].push(icon);
        else if(!value && index > -1)
            this._bookmarks[cat].splice(index, 1);
    }

    public dispatchEvent(event: string, args: any[])
    {
        switch (event) {
            case 'reload':
                this.reload();
                break;
            case 'bookmarks':
                this._state.bookmarks = !this._state.bookmarks;
                break;
            case 'copy':
                this.copyToClipboard(args[0], args[1]);
                break;
            case 'setBookmark':
                this.setBookmark(args[0], args[1], args[2])
                break;
        }
    }
}

class FileProvider
{
    public static path: string;
    private static _templates: {[key: string]: string} = {};
    private static _styles: {[key: string]: string} = {};
    public static getTemplate(name: string): string
    {
        if(this._templates[name]) return this._templates[name];

        this._templates[name] = fs.readFileSync(`${this.path}/templates/${name}.html`).toString() || "";
        return this._templates[name];
    }
    public static getStyle(name: string): string
    {
        if(this._styles[name]) return this._styles[name];

        this._styles[name] = fs.readFileSync(`${this.path}/styles/${name}.css`).toString() || "";
        return this._styles[name];
    }
    
    public static parseTemplate(name: string, data: any): string
    {
        return this.getTemplate(name).replace(/{{\s*(.*?)\s*}}/g, (substring: string, match: string): string =>
        {
            return (data[match] || ""); 
        });
    }
}