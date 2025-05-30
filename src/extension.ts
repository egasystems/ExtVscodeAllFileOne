import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Lee un archivo de texto de forma segura.
 * Si no existe y `createIfMissing` es true, devuelve cadena vacía.
 * Si no existe y `createIfMissing` es false, muestra error y devuelve undefined.
 */
function readFileSafe(
  filePath: string,
  label: string,
  createIfMissing = false
): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    if (createIfMissing) {
      return '';
    }
    vscode.window.showErrorMessage(`No se pudo leer el archivo ${label}: ${path.basename(filePath)}`);
    return;
  }
}

/**
 * Devuelve la porción de `content` comprendida entre los separadores `startTag`
 * y `endTag` (o hasta el final si `endTag` es null).
 * Modificado para que cualquier texto antes de startTag también sea capturado (útil para imports al principio).
 */
function extractSection(content: string, start: string, end: string | null): string {
  const rawStart = content.indexOf(start);
  const startIndex = rawStart === -1 ? 0 : rawStart + start.length;
  const endIndex   = end ? content.indexOf(end) : content.length;
  return content.substring(startIndex, endIndex).trim();
}

/**
 * Punto de entrada de la extensión.
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('🚀 Extensión activada');

  const disposable = vscode.commands.registerCommand(
    'angularComponentViewer.openCombinedView',
    async (uri?: vscode.Uri) => {
      // 1. Determina la ruta del archivo .component.ts
      const editor = vscode.window.activeTextEditor;
      const tsPath = uri ? uri.fsPath : editor?.document.uri.fsPath;

      if (!tsPath) {
        return vscode.window.showErrorMessage('Selecciona o abre un archivo .component.ts');
      }
      const isValidFile = /\.ts$/.test(tsPath) && !/\.spec\.ts$/.test(tsPath);
      if (!isValidFile) {
        return vscode.window.showErrorMessage('Este no es un archivo .ts válido (se ignoran los archivos .spec.ts)');
      }

      // Watchers se declaran primero para que estén disponibles en todo el callback
      let watcher: vscode.Disposable;
      let sourcesWatcher: vscode.Disposable;

      // 2. Archivos relacionados
      const baseName = path.basename(tsPath, '.ts');
      // Lógica mejorada para detectar el archivo HTML relacionado
      const htmlPathCandidates = [
        `${baseName}.component.html`,
        `${baseName}.html`
      ];
      let htmlPath = '';
      for (const candidate of htmlPathCandidates) {
        const fullPath = path.join(path.dirname(tsPath), candidate);
        if (fs.existsSync(fullPath)) {
          htmlPath = fullPath;
          break;
        }
      }
      if (!htmlPath) {
        htmlPath = path.join(path.dirname(tsPath), `${baseName}.html`);
      }

      // Lógica más flexible para detectar CSS o SCSS relacionado
      const cssPathCandidates = [
        `${baseName}.component.css`,
        `${baseName}.css`,
        `${baseName}.component.scss`,
        `${baseName}.scss`
      ];
      let cssPath = '';
      for (const candidate of cssPathCandidates) {
        const fullPath = path.join(path.dirname(tsPath), candidate);
        if (fs.existsSync(fullPath)) {
          cssPath = fullPath;
          break;
        }
      }
      if (!cssPath) {
        cssPath = path.join(path.dirname(tsPath), `${baseName}.css`);
      }

      // 3. Lee los contenidos (HTML y CSS se crean vacíos si no existen)
      const tsContent   = readFileSafe(tsPath,  'TS');
      const htmlContent = readFileSafe(htmlPath, 'HTML', true);
      const cssContent  = readFileSafe(cssPath,  'CSS',  true);

      if (tsContent === undefined || htmlContent === undefined || cssContent === undefined) {
        return; // ya se mostró un mensaje de error
      }

      // 4. Construye el documento combinado
      const combined =
        `// --- TypeScript ---\n${tsContent}\n\n` +
        `// --- HTML ---\n${htmlContent}\n\n` +
        `// --- CSS ---\n${cssContent}`;

      // 5. Crea un archivo temporal real para que se considere "guardado" desde el inicio
      // Guarda el temporal en la misma carpeta del componente para que las rutas relativas funcionen
      const tempFilePath = path.join(
        path.dirname(tsPath),
        `${path.basename(tsPath).replace('.ts', '')}-${Date.now()}.ts`
      );
      await vscode.workspace.fs.writeFile(vscode.Uri.file(tempFilePath), Buffer.from(combined, 'utf8'));

      // Abre el archivo temporal
      let virtualDoc = await vscode.workspace.openTextDocument(tempFilePath);
      await vscode.window.showTextDocument(virtualDoc, vscode.ViewColumn.One, false);
      console.log('📂 Archivo temporal abierto:', virtualDoc.uri.fsPath);

      const currentEditor = vscode.window.activeTextEditor;
      if (currentEditor?.document === virtualDoc) {
        await currentEditor.edit(editBuilder => {
          editBuilder.insert(new vscode.Position(0, 0), ' ');
        });
        await currentEditor.edit(editBuilder => {
          editBuilder.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)));
        });
        console.log('✏️ Modificación forzada aplicada');
      }


      // 6. Observa guardados para dividir y sobrescribir
      sourcesWatcher = vscode.workspace.onDidSaveTextDocument(async (savedOrig) => {
        if (savedOrig.uri.fsPath === tempFilePath) {
          // Aquí se podrían agregar acciones adicionales si se desea
        }
      });
      context.subscriptions.push(sourcesWatcher);

      watcher = vscode.workspace.onDidSaveTextDocument(saved => {
        if (saved.uri.fsPath !== tempFilePath) { return; }

        const text = saved.getText();
        fs.writeFileSync(tsPath,   extractSection(text, '// --- TypeScript ---', '// --- HTML ---'));
        fs.writeFileSync(htmlPath, extractSection(text, '// --- HTML ---',      '// --- CSS ---'));
        fs.writeFileSync(cssPath,  extractSection(text, '// --- CSS ---',       null));

        vscode.window.showInformationMessage('Archivos del componente actualizados ✔︎');
      });

      context.subscriptions.push(watcher);

      // Cuando el usuario cierre el documento temporal, borra el archivo y limpia watchers
      const closeWatcher = vscode.workspace.onDidCloseTextDocument(async (closed) => {
        console.log('📁 Documento cerrado:', closed.uri.fsPath);
        console.log('📁 Temporal esperado:', tempFilePath);

        console.log('🔍 Comparando:', path.resolve(closed.uri.fsPath).toLowerCase());
        console.log('🔍 Con       :', path.resolve(tempFilePath).toLowerCase());

        if (path.resolve(closed.uri.fsPath).toLowerCase() === path.resolve(tempFilePath).toLowerCase()) {
          console.log('✅ Coincidencia confirmada');
          try {
            console.log('🧹 Intentando eliminar el archivo temporal...');
            await vscode.workspace.fs.delete(vscode.Uri.file(tempFilePath), { useTrash: false });
            console.log('✅ Archivo temporal eliminado.');
          } catch (err: any) {
            if (err?.code === 'FileNotFound') {
              console.log('⚠️ El archivo temporal ya había sido eliminado.');
            } else {
              console.warn('⚠️ No se pudo borrar el archivo temporal:', err);
            }
          }
          watcher.dispose();
          sourcesWatcher.dispose();
          closeWatcher.dispose();
        }
      });
      context.subscriptions.push(closeWatcher);

      // Fallback: intenta borrar el archivo temporal si sigue abierto después de 10 segundos
      setTimeout(async () => {
        const stillOpen = vscode.workspace.textDocuments.some(doc =>
          path.resolve(doc.uri.fsPath) === path.resolve(tempFilePath)
        );

        if (!stillOpen) {
          try {
            console.log('🧹 (Fallback) Eliminando archivo temporal...');
            await vscode.workspace.fs.delete(vscode.Uri.file(tempFilePath), { useTrash: false });
            console.log('✅ (Fallback) Archivo temporal eliminado.');
          } catch (err: any) {
            if (err?.code === 'FileNotFound') {
              console.log('⚠️ (Fallback) El archivo temporal ya había sido eliminado.');
            } else {
              console.warn('⚠️ (Fallback) No se pudo borrar el archivo temporal:', err);
            }
          }

          watcher.dispose();
          sourcesWatcher.dispose();
          closeWatcher.dispose();
        } else {
          console.log('⏳ (Fallback) Documento aún abierto, no se elimina.');
        }
      }, 50000);
    }
  );

  context.subscriptions.push(disposable);

  // Comando para alternar el lenguaje del documento temporal
  const cycleDisposable = vscode.commands.registerCommand(
    'angularComponentViewer.cycleLanguage',
    async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || !['typescript', 'html', 'css'].includes(doc.languageId)) {
        return vscode.window.showInformationMessage('Coloca el cursor en un archivo generado por ACV con modo válido.');
      }

      const cycle = ['typescript', 'html', 'css'];
      const current = doc.languageId;
      const idx = cycle.indexOf(current);
      const nextLang = cycle[(idx + 1) % cycle.length];

      await vscode.languages.setTextDocumentLanguage(doc, nextLang);
      vscode.window.showInformationMessage(`Modo del documento cambiado a: ${nextLang.toUpperCase()}`);
    }
  );
  context.subscriptions.push(cycleDisposable);
}

export function deactivate() {}