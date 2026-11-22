'use strict';

const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BackupError } = require('./backup.cjs');

class InputError extends Error {
  constructor(code, field, limit) {
    super(code);
    this.code = code;
    this.limit = limit;
    this.field = field;
  }
}

function fields(input, keys) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) {
    throw new InputError('invalidInput');
  }
  return input;
}

function id(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw new InputError('invalidId', field);
  return value;
}

function text(value, field, limit, required = false) {
  if (value === null && !required) return null;
  if (typeof value !== 'string' || value.includes('\0') || !value.isWellFormed()) throw new InputError('invalidText', field);
  if (value.length > limit) throw new InputError('textTooLong', field, limit);
  const trimmed = value.trim();
  if (!trimmed && required) throw new InputError('requiredText', field);
  return trimmed || null;
}

function projectCode(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-z][a-z0-9]{1,9}$/i.test(trimmed)) {
    throw new InputError('invalidCode', 'code');
  }
  return trimmed.toUpperCase();
}

function taskFields(input) {
  const { title, description, priority, dueDate, statusId } = fields(input, ['title', 'description', 'priority', 'dueDate', 'statusId']);
  const validatedTitle = text(title, 'title', 200, true);
  const validatedStatus = id(statusId, 'statusId');
  const validatedDescription = text(description, 'description', 10000);
  if (priority !== null && !['low', 'medium', 'high'].includes(priority)) {
    throw new InputError('invalidPriority', 'priority');
  }
  if (dueDate !== null && (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
      dueDate.startsWith('0000') || Number.isNaN(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0, 10) !== dueDate)) {
    throw new InputError('invalidDate', 'dueDate');
  }
  return [validatedTitle, validatedDescription, priority, dueDate, validatedStatus];
}

function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function openStorage(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true, timeout: 1000 });
  try {
    transaction(db, () => {
      const { user_version: version } = db.prepare('PRAGMA user_version').get();
      if (version > 3) throw new Error(`Unsupported workspace schema: ${version}`);
      db.exec(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        initialized_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO app_metadata (id, initialized_at)
      VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT (id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE CHECK (length(code) BETWEEN 2 AND 10 AND code GLOB '[A-Z]*' AND code NOT GLOB '*[^A-Z0-9]*'),
        name TEXT NOT NULL,
        description TEXT,
        next_task_number INTEGER NOT NULL DEFAULT 1 CHECK (next_task_number > 0)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS statuses (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position > 0),
        UNIQUE (project_id, id),
        UNIQUE (project_id, name),
        UNIQUE (project_id, position)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        number INTEGER NOT NULL CHECK (number > 0),
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT CHECK (priority IN ('low', 'medium', 'high')),
        due_date TEXT,
        status_id INTEGER NOT NULL,
        FOREIGN KEY (project_id, status_id) REFERENCES statuses(project_id, id),
        UNIQUE (project_id, number)
      ) STRICT;
      `);
      if (version === 0) db.exec(`
        ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));
        ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));
        PRAGMA user_version = 1;
      `);
      if (version < 2) db.exec(`
        CREATE TABLE local_preferences (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          language TEXT NOT NULL CHECK (language IN ('zh-CN', 'en'))
        ) STRICT;
        PRAGMA user_version = 2;
      `);
      if (version < 3) db.exec(`
        ALTER TABLE local_preferences ADD COLUMN theme TEXT NOT NULL DEFAULT 'sage'
          CHECK (theme IN ('sage', 'lavender', 'blue', 'yellow', 'white'));
        PRAGMA user_version = 3;
      `);
    });
  } catch (error) {
    db.close();
    throw error;
  }

  const projectColumns = 'id, code, name, description, archived';
  const taskColumns = 'id, project_id AS projectId, number, title, description, priority, due_date AS dueDate, status_id AS statusId, archived';
  const archiveFlag = archived => {
    if (typeof archived !== 'boolean') throw new InputError('invalidArchive');
    return Number(archived);
  };
  const requireProject = projectId => {
    id(projectId, 'projectId');
    const project = db.prepare(`SELECT ${projectColumns} FROM projects WHERE id = ?`).get(projectId);
    if (!project) throw new InputError('missingProject');
    return project;
  };
  const requireStatus = (projectId, statusId) => {
    id(statusId, 'statusId');
    if (!db.prepare('SELECT 1 FROM statuses WHERE project_id = ? AND id = ?').get(projectId, statusId)) {
      throw new InputError('foreignStatus', 'statusId');
    }
  };
  const requireActiveProject = projectId => {
    const project = requireProject(projectId);
    if (project.archived) throw new InputError('archivedProject');
    return project;
  };
  const requireTask = (projectId, taskId) => {
    id(projectId, 'projectId');
    id(taskId, 'taskId');
    const task = db.prepare(`SELECT ${taskColumns} FROM tasks WHERE project_id = ? AND id = ?`).get(projectId, taskId);
    if (!task) throw new InputError('missingTask');
    return task;
  };
  const requireActiveTask = (projectId, taskId) => {
    requireActiveProject(projectId);
    const task = requireTask(projectId, taskId);
    if (task.archived) throw new InputError('archivedTask');
    return task;
  };
  const statusIds = projectId => db.prepare('SELECT id FROM statuses WHERE project_id = ? ORDER BY position').all(projectId).map(row => row.id);
  const projectData = projectId => ({
    project: requireProject(projectId),
    statuses: db.prepare('SELECT id, name, position FROM statuses WHERE project_id = ? ORDER BY position').all(projectId),
    tasks: db.prepare(`SELECT ${taskColumns} FROM tasks WHERE project_id = ? ORDER BY number`).all(projectId),
  });
  const statusName = (projectId, name, currentId = 0) => {
    const normalized = text(name, 'statusName', 120, true);
    if (db.prepare('SELECT 1 FROM statuses WHERE project_id = ? AND name = ? AND id <> ?').get(projectId, normalized, currentId)) {
      throw new InputError('duplicateStatus', 'name');
    }
    return normalized;
  };
  // Move existing positions above the entire final range before assigning the new order.
  function orderStatuses(projectId, order) {
    const { max } = db.prepare('SELECT MAX(position) AS max FROM statuses WHERE project_id = ?').get(projectId);
    db.prepare('UPDATE statuses SET position = position + ? WHERE project_id = ?').run(max, projectId);
    const update = db.prepare('UPDATE statuses SET position = ? WHERE project_id = ? AND id = ?');
    order.forEach((statusId, index) => update.run(index + 1, projectId, statusId));
  }

  const listProjects = () => db.prepare(`SELECT ${projectColumns} FROM projects ORDER BY id`).all();
  function requireEmpty() {
    if (db.prepare('SELECT 1 FROM projects LIMIT 1').get()) throw new InputError('backupNotEmpty');
  }
  return {
    close: () => db.close(),
    getLanguage: () => db.prepare('SELECT language FROM local_preferences WHERE id = 1').get()?.language ?? 'zh-CN',
    setLanguage(language) {
      db.prepare(`INSERT INTO local_preferences (id, language) VALUES (1, ?)
        ON CONFLICT (id) DO UPDATE SET language = excluded.language`).run(language);
      return language;
    },
    getTheme: () => db.prepare('SELECT theme FROM local_preferences WHERE id = 1').get()?.theme ?? 'sage',
    setTheme(theme) {
      db.prepare(`INSERT INTO local_preferences (id, language, theme) VALUES (1, 'zh-CN', ?)
        ON CONFLICT (id) DO UPDATE SET theme = excluded.theme`).run(theme);
      return theme;
    },
    requireEmpty,
    visitBackup(emit) {
      transaction(db, () => {
        const projects = db.prepare(`SELECT id, code, name, description, archived, next_task_number AS nextTaskNumber FROM projects ORDER BY id`);
        const statuses = db.prepare('SELECT name, position FROM statuses WHERE project_id = ? ORDER BY position');
        const tasks = db.prepare(`SELECT t.number, t.title, t.description, t.priority, t.due_date AS dueDate, t.archived, s.position AS statusPosition
          FROM tasks t JOIN statuses s ON s.id = t.status_id AND s.project_id = t.project_id WHERE t.project_id = ? ORDER BY t.number`);
        for (const { id, ...project } of projects.iterate()) {
          emit({ kind: 'project', ...project });
          for (const status of statuses.iterate(id)) emit({ kind: 'status', ...status });
          for (const task of tasks.iterate(id)) emit({ kind: 'task', ...task });
        }
      });
    },
    restoreBackup(records) {
      transaction(db, () => {
        requireEmpty();
        const invalid = () => { throw new BackupError('backupInvalid'); };
        const addProject = db.prepare(`INSERT INTO projects (code, name, description, archived, next_task_number) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (code) DO NOTHING RETURNING id`);
        const addStatus = db.prepare(`INSERT INTO statuses (project_id, name, position) VALUES (?, ?, ?)
          ON CONFLICT (project_id, name) DO NOTHING RETURNING id`);
        const findStatus = db.prepare('SELECT id FROM statuses WHERE project_id = ? AND position = ?');
        const addTask = db.prepare(`INSERT INTO tasks (project_id, number, title, description, priority, due_date, status_id, archived)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        let projectId, next, statusCount = 0, taskCount = 0;
        const finishProject = () => { if (projectId && (!statusCount || taskCount !== next - 1)) invalid(); };
        for (const record of records) {
          if (record.kind === 'project') {
            finishProject();
            const row = addProject.get(record.code, record.name, record.description, record.archived, record.nextTaskNumber);
            if (!row) invalid();
            projectId = row.id;
            next = record.nextTaskNumber;
            statusCount = taskCount = 0;
          } else if (!projectId) {
            invalid();
          } else if (record.kind === 'status') {
            if (taskCount || record.position !== statusCount + 1 || !addStatus.get(projectId, record.name, record.position)) invalid();
            statusCount++;
          } else {
            if (record.number !== taskCount + 1 || record.number >= next) invalid();
            const status = findStatus.get(projectId, record.statusPosition);
            if (!status) invalid();
            addTask.run(projectId, record.number, record.title, record.description, record.priority, record.dueDate, status.id, record.archived);
            taskCount++;
          }
        }
        finishProject();
      });
    },
    listProjects,
    getProject: projectData,
    createProject(input, defaultStatuses) {
      const { name, description, code } = fields(input, ['name', 'description', 'code']);
      const normalized = projectCode(code);
      const projectName = text(name, 'name', 120, true);
      const projectDescription = text(description, 'description', 10000);
      return transaction(db, () => {
        if (db.prepare('SELECT 1 FROM projects WHERE code = ?').get(normalized)) throw new InputError('duplicateCode', 'code');
        const project = db.prepare(`INSERT INTO projects (code, name, description) VALUES (?, ?, ?) RETURNING ${projectColumns}`)
          .get(normalized, projectName, projectDescription);
        const addStatus = db.prepare('INSERT INTO statuses (project_id, name, position) VALUES (?, ?, ?)');
        defaultStatuses.forEach((status, position) => addStatus.run(project.id, status, position + 1));
        return project;
      });
    },
    updateProject(projectId, input) {
      const { name, description } = fields(input, ['name', 'description']);
      const projectName = text(name, 'name', 120, true);
      const projectDescription = text(description, 'description', 10000);
      requireActiveProject(projectId);
      return db.prepare(`UPDATE projects SET name = ?, description = ? WHERE id = ? RETURNING ${projectColumns}`)
        .get(projectName, projectDescription, projectId);
    },
    setProjectArchived(projectId, archived) {
      const flag = archiveFlag(archived);
      requireProject(projectId);
      return db.prepare(`UPDATE projects SET archived = ? WHERE id = ? RETURNING ${projectColumns}`).get(flag, projectId);
    },
    createStatus(projectId, name) {
      return transaction(db, () => {
        requireActiveProject(projectId);
        const normalized = statusName(projectId, name);
        db.prepare(`INSERT INTO statuses (project_id, name, position)
          SELECT ?, ?, MAX(position) + 1 FROM statuses WHERE project_id = ?`).run(projectId, normalized, projectId);
        return projectData(projectId);
      });
    },
    renameStatus(projectId, statusId, name) {
      return transaction(db, () => {
        requireActiveProject(projectId);
        requireStatus(projectId, statusId);
        db.prepare('UPDATE statuses SET name = ? WHERE project_id = ? AND id = ?').run(statusName(projectId, name, statusId), projectId, statusId);
        return projectData(projectId);
      });
    },
    reorderStatuses(projectId, order) {
      return transaction(db, () => {
        requireActiveProject(projectId);
        const existing = statusIds(projectId);
        const requested = Array.isArray(order) ? new Set(order) : new Set();
        if (!Array.isArray(order) || order.length !== existing.length || !existing.every(value => requested.has(value))) {
          throw new InputError('invalidOrder');
        }
        if (existing.some((value, index) => value !== order[index])) orderStatuses(projectId, order);
        return projectData(projectId);
      });
    },
    deleteStatus(projectId, statusId, targetId) {
      return transaction(db, () => {
        requireActiveProject(projectId);
        requireStatus(projectId, statusId);
        const order = statusIds(projectId);
        if (order.length < 2) throw new InputError('lastStatus');
        const hasTasks = db.prepare('SELECT 1 FROM tasks WHERE project_id = ? AND status_id = ? LIMIT 1').get(projectId, statusId);
        if (targetId !== null) {
          if (targetId === statusId) throw new InputError('sameStatus', 'statusId');
          requireStatus(projectId, targetId);
        } else if (hasTasks) {
          throw new InputError('targetRequired', 'statusId');
        }
        if (hasTasks) db.prepare('UPDATE tasks SET status_id = ? WHERE project_id = ? AND status_id = ?').run(targetId, projectId, statusId);
        db.prepare('DELETE FROM statuses WHERE project_id = ? AND id = ?').run(projectId, statusId);
        orderStatuses(projectId, order.filter(value => value !== statusId));
        return projectData(projectId);
      });
    },
    createTask(projectId, input) {
      const values = taskFields(input);
      return transaction(db, () => {
        requireActiveProject(projectId);
        requireStatus(projectId, values[4]);
        const { next_task_number: number } = db.prepare('SELECT next_task_number FROM projects WHERE id = ?').get(projectId);
        if (!Number.isSafeInteger(number) || number >= Number.MAX_SAFE_INTEGER) throw new InputError('numbersExhausted');
        const task = db.prepare(`INSERT INTO tasks (project_id, number, title, description, priority, due_date, status_id)
          VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${taskColumns}`).get(projectId, number, ...values);
        db.prepare('UPDATE projects SET next_task_number = next_task_number + 1 WHERE id = ?').run(projectId);
        return task;
      });
    },
    updateTask(projectId, taskId, input) {
      const values = taskFields(input);
      requireActiveTask(projectId, taskId);
      requireStatus(projectId, values[4]);
      return db.prepare(`UPDATE tasks SET title = ?, description = ?, priority = ?, due_date = ?, status_id = ?
        WHERE project_id = ? AND id = ? RETURNING ${taskColumns}`).get(...values, projectId, taskId);
    },
    moveTask(projectId, taskId, statusId) {
      const task = requireActiveTask(projectId, taskId);
      requireStatus(projectId, statusId);
      if (task.statusId === statusId) return task;
      return db.prepare(`UPDATE tasks SET status_id = ? WHERE project_id = ? AND id = ? RETURNING ${taskColumns}`).get(statusId, projectId, taskId);
    },
    setTaskArchived(projectId, taskId, archived) {
      const flag = archiveFlag(archived);
      requireActiveProject(projectId);
      requireTask(projectId, taskId);
      return db.prepare(`UPDATE tasks SET archived = ? WHERE project_id = ? AND id = ? RETURNING ${taskColumns}`).get(flag, projectId, taskId);
    },
  };
}

module.exports = { InputError, openStorage };
