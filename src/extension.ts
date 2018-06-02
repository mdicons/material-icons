import * as vscode from 'vscode';
import { Library } from './library';

let library: Library;
export function activate(context: vscode.ExtensionContext) 
{
    console.log("We are up and running!");
    library = new Library(context.extensionPath);
    let commands = 
    [
        vscode.commands.registerCommand('materialIcons.showLibrary', library.show.bind(library)),
        vscode.commands.registerCommand('materialIcons.updateLibrary', library.update.bind(library)),
        vscode.commands.registerCommand('materialIcons.insertIcon', library.insertIcon.bind(library)),
        vscode.commands.registerCommand('materialIcons.dispatchEvent', library.dispatchEvent.bind(library))
    ];

    vscode.window.onDidChangeActiveTextEditor(library.setAcitveTextEditor.bind(library));        
    context.subscriptions.push(...commands);
}
export function deactivate() 
{
    library.deconstructor();
}
