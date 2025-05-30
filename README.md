# Angular Component Viewer

Visualiza y edita en una sola vista los tres archivos de un componente Angular
(`.component.ts`, `.component.html`, `.component.scss / .css`).

<div align="center">
  <img src="https://raw.githubusercontent.com/tu-repo/captura.gif" width="600" />
</div>

## Características

- Combina los tres archivos en un documento temporal editable.
- Guardar el combinado actualiza los originales (y vice-versa).
- Menú contextual en el explorador/editor para abrir la vista.
- Comando para alternar el modo de lenguaje (TS ⇄ HTML ⇄ SCSS).

## Uso

1. Clic derecho sobre un `*.component.ts` → **Abrir vista combinada…**  
2. Edita cualquier sección y guarda (`Ctrl/Cmd + S`).  
3. Si quieres inspeccionar errores de otro lenguaje, usa  
   **ACV: Cambiar modo (TS ⇄ HTML ⇄ SCSS)**.

## Instalación local

```bash
vsce package
code --install-extension angular-component-viewer-0.0.X.vsix