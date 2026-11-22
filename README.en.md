# Offline Project Workspace

[中文](README.md) | English

A desktop project management application for one person on one computer. Keep projects, tasks, and workflow statuses locally, and organize work with a board or list. Suitable for personal development work, study plans, and everyday projects.

Current version: **0.1.0**, available as a **Windows 11 x64 portable package**. No account, server configuration, or API key is required.

## Features

| Feature | Description |
| --- | --- |
| Multiple projects | Create projects with a name, unique code, and description; open each workspace from the overview |
| Task management | Create and edit titles, descriptions, statuses, priorities, and due dates |
| Task numbers | Identify tasks by project code and a number within that project, such as `DEMO-1` |
| Board and list | Browse tasks in status columns or a list; both views use the same data |
| Board dragging | Drag cards between status columns or change status through the task actions menu |
| Search and filters | Search task titles or numbers within the current project; filter by status and priority |
| Custom statuses | Add, rename, reorder, and delete statuses to create your own workflow |
| Archive and restore | Hide projects and tasks from everyday views while retaining their contents for restoration |
| Two interface languages | Simplified Chinese and English, with a locally saved language preference |
| Five themes | Light sage, light purple, light blue, light yellow, and pure white, with a locally saved selection |
| Task details panel | Edit tasks in a side panel with adjustable width |
| Local storage | Persist business data in SQLite and retain saved changes after exiting |
| Manual backups | Export all projects, statuses, and tasks, including archived data; restore into an empty workspace |

## Download and launch

Portable package: [OfflineProjectWorkspace-0.1.0-Windows11-x64-portable.zip](https://github.com/xuzh0312/Local-offline-personal-project-management-workspace-similar-to-Plane/releases/download/v0.1.0/OfflineProjectWorkspace-0.1.0-Windows11-x64-portable.zip)

1. **Extract the entire ZIP** into a local folder. Do not run it inside the archive.
2. Keep `Start.cmd`, `app/`, and `electron/` together in the extracted folder.
3. Double-click `Start.cmd` to launch. Close the application window to exit.

No separate Node.js, Electron, or development dependencies are needed, and no PowerShell execution policy change is required. A command window may remain open alongside the application. Do not copy only the executable from the package.

## Usage

### Create a project

Select “New project” from the overview and enter a name, code, and optional description. A code must contain 2–10 English letters or digits, start with a letter, and be unique within the workspace. Codes are saved in uppercase. The name and description can be edited later; the code cannot be changed.

For example, a study project with code `STUDY` will contain tasks numbered `STUDY-1`, `STUDY-2`, and so on, making them easy to find.

### Add tasks and move work forward

Open a project and select “New task.” Enter a title and optionally provide a description, status, priority, and due date. Priority can be low, medium, high, or not set. New tasks default to the project's first status.

New projects start with “To do / In progress / Done” or the corresponding Chinese names, depending on the interface language at creation time. Use “Statuses” to customize the workflow, for example “Plan / Develop / Verify / Done.” A project must retain at least one status. Deleting a status containing tasks requires selecting another status to receive them, including archived tasks.

Drag cards between board columns or use the task actions menu to change status. Click a task to open its details, edit it, and select “Save changes.” Due dates are recorded and displayed; there are currently no due-date notifications.

### Find and archive work

Switch between the board and list, search by title or number, and combine status and priority filters. Search covers task titles and numbers in the current project; it does not search description text or other projects.

Restore archived tasks from “Archived tasks” within their project. Archiving a project hides it from the overview while retaining its tasks and statuses; restore it from “Archived projects.” Restore archived content before continuing to edit it. The current interface organizes projects and tasks through archiving and does not provide permanent project or task deletion.

### Change language and theme

In Settings, choose Simplified Chinese or English and one of five light themes. Language and theme preferences are saved locally. Changing the interface language does not translate existing status names, project names, or task content.

## Data storage, backups, and migration

### Data location

The default SQLite database is in the current Windows user's application data directory, usually:

```text
%APPDATA%\offline-project-workspace\workspace.sqlite
```

**Portable means the program requires no installation; data is stored in the user profile by default.** Moving the program folder does not migrate data, and deleting or extracting the program again does not clear the workspace. Another copy launched by the same user will normally access the same workspace.

### Export a backup

Select “Settings → Backup and restore → Save backup” and choose a destination. The default filename is `workspace-backup.json`.

Backups include all projects, statuses, tasks, archive flags, and task numbering information. Local language and theme preferences are excluded. Backups are started manually. Export one before moving computers, reinstalling the operating system, or making major organizational changes, and keep it in another safe location.

Although its extension is `.json`, the current backup uses an application-specific format with an identifying header, line-by-line JSON records, and a SHA-256 integrity check. Preserve the original exported file and restore it through the application. Backups are not encrypted and contain project and task text.

### Restore or move to another computer

1. Export a backup from the original workspace and copy it to the destination computer.
2. Fully extract the portable package on the destination computer and launch it.
3. Make sure the destination workspace contains no projects.
4. Select “Settings → Backup and restore → Restore from backup” and choose the file.
5. After restoration, open projects from the overview and select your language and theme again as needed.

Restoration requires a workspace with **no projects at all, including archived projects**. Archiving all projects does not satisfy this requirement. Restore does not merge with or overwrite existing projects. The current interface also has no permanent project deletion option for clearing the workspace.

## Local operation and current scope

Business data stays on the computer, interface resources are bundled, and project and task operations do not depend on cloud services. There is currently no account login, cloud synchronization, team collaboration, or automatic update feature. Attachments, subtasks, due-date reminders, and statistical reports are also outside the current scope.

The main window disables Node.js integration and enables context isolation and sandboxing. A restricted preload API exposes local operations to the interface. Spell-check dictionary downloads and some background networking behavior are disabled; these measures do not constitute verification of all network behavior by the operating system and runtime.

The accepted platform is currently **Windows 11 x64**. Windows 10, macOS, Linux, and operation with the entire computer disconnected from the network have not been tested.

## Technology and source layout

Built with **Electron + React + TypeScript + SQLite**. Electron provides desktop windows and local capabilities, React implements the interface, TypeScript checks interface code and API types, SQLite stores data, and esbuild bundles interface code.

```text
project/
├── README.md       # Chinese introduction
├── README.en.md    # English introduction
├── code/           # Application source and build instructions
└── LICENSE         # MIT license; portable package distributed through Releases
```

| Source file | Responsibility |
| --- | --- |
| `main.cjs`, `main-language.cjs` | Startup, single-instance handling, windows, IPC, and native menu text |
| `preload.cjs`, `workspace-api.d.ts` | Restricted local API exposed to the interface and its types |
| `storage.cjs` | SQLite schema, validation, migrations, and transactions |
| `backup.cjs` | Backup reading, writing, and integrity validation |
| `renderer.tsx`, `workspace.css` | Application interface and styles |
| `renderer-language.ts`, `workspace-motion.tsx` | Bilingual text, dragging, and panel interactions |

These files are in `code/`. Current direct dependencies are React / React DOM 19.1.1, with TypeScript 5.9.3 and esbuild 0.28.2 for development. The existing build guide records a verified environment using Node.js 24.22.3 and Electron 43.3.0 for Windows x64.

Developers should read the [source and build instructions](code/README.md), currently in Chinese. Source does not include dependencies, Electron, or a lockfile. There are no npm scripts such as `start` or `build` in `package.json`; follow the guide to prepare dependencies and build in a separate directory. End users can use the portable package directly.

## Third-party licenses

The portable package includes Electron license files at `electron/LICENSE` and `electron/LICENSES.chromium.html`. MIT license texts for React, React DOM, and scheduler are in `licenses/`. This project is licensed under the [MIT License](LICENSE). Third-party components retain their respective licenses.
