'use strict';

const { closeSync, fstatSync, fsyncSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } = require('node:fs');
const { basename, dirname, extname, join, normalize } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const format = 'offline-project-workspace-backup';
const magic = Buffer.from(`${format}\n`);
const version = 2;
const v1MaxBytes = 64 * 1024 * 1024; // The unreleased v1 writer could never produce more.
// A task is the largest v2 record: 10,000 description + 200 title UTF-16 units
// at up to 6 serialized bytes per unit, and up to 512 bytes for all other fields.
const maxRecordBytes = (10000 + 200) * 6 + 512;

class BackupError extends Error {
  constructor(code, cause) {
    super(code, { cause });
    this.code = code;
  }
}

const invalid = () => { throw new BackupError('backupInvalid'); };
function fileAccess(code, action) {
  try { return action(); }
  catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError(code, error);
  }
}
function shape(record, keys) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      Object.keys(record).length !== keys.length || !keys.every(key => Object.hasOwn(record, key))) invalid();
}
const positive = value => Number.isSafeInteger(value) && value >= 1;
const rowIdV1 = value => positive(value) && value <= 0xFFFFFFFF;
const flag = value => value === 0 || value === 1;
const text = (value, limit, optional = false) => (optional && value === null) ||
  (typeof value === 'string' && value.length > 0 && value.length <= limit && value === value.trim() && !value.includes('\0') && value.isWellFormed());
const validDate = value => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !value.startsWith('0000') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const projectKeys = ['code', 'name', 'description', 'archived', 'nextTaskNumber'];
const statusKeys = ['name', 'position'];
const taskKeys = ['number', 'title', 'description', 'priority', 'dueDate', 'archived'];

function validProject(p) {
  if (typeof p.code !== 'string' || !/^[A-Z][A-Z0-9]{1,9}$/.test(p.code) || !text(p.name, 120) ||
      !text(p.description, 10000, true) || !flag(p.archived) || !positive(p.nextTaskNumber)) invalid();
}
function validStatus(s) {
  if (!text(s.name, 120) || !positive(s.position)) invalid();
}
function validTask(t) {
  if (!positive(t.number) || !text(t.title, 200) || !text(t.description, 10000, true) ||
      ![null, 'low', 'medium', 'high'].includes(t.priority) || !validDate(t.dueDate) || !flag(t.archived)) invalid();
}

function parse(bytes, canonical = false) {
  let source, record;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    record = JSON.parse(source);
  } catch { invalid(); }
  // v2 requires compact JSON as written by this app; round-tripping also detects duplicate keys.
  if (canonical && JSON.stringify(record) !== source) invalid();
  return record;
}
const line = record => Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');

function* v1Records(record) {
  if (!record || typeof record !== 'object' || record.format !== format || !positive(record.version)) invalid();
  if (record.version !== 1) throw new BackupError('backupVersion');
  shape(record, ['format', 'version', 'projects', 'statuses', 'tasks']);
  const { projects, statuses, tasks } = record;
  if (![projects, statuses, tasks].every(Array.isArray)) invalid();
  const groups = new Map(), statusIds = new Map(), taskIds = new Set();
  for (const p of projects) {
    shape(p, ['id', ...projectKeys]);
    validProject(p);
    if (!rowIdV1(p.id) || groups.has(p.id)) invalid();
    groups.set(p.id, { project: p, statuses: [], tasks: [] });
  }
  for (const s of statuses) {
    shape(s, ['id', 'projectId', ...statusKeys]);
    validStatus(s);
    const group = groups.get(s.projectId);
    if (!rowIdV1(s.id) || !group || statusIds.has(s.id)) invalid();
    statusIds.set(s.id, s);
    group.statuses.push(s);
  }
  for (const t of tasks) {
    shape(t, ['id', 'projectId', 'statusId', ...taskKeys]);
    validTask(t);
    const group = groups.get(t.projectId), status = statusIds.get(t.statusId);
    if (!rowIdV1(t.id) || taskIds.has(t.id) || !group || status?.projectId !== t.projectId) invalid();
    taskIds.add(t.id);
    group.tasks.push(t);
  }
  for (const group of groups.values()) {
    const { id: _id, ...p } = group.project;
    yield { kind: 'project', ...p };
    for (const { name, position } of group.statuses.sort((a, b) => a.position - b.position)) yield { kind: 'status', name, position };
    for (const t of group.tasks.sort((a, b) => a.number - b.number)) {
      const { id: _id, projectId: _projectId, statusId, ...fields } = t;
      yield { kind: 'task', ...fields, statusPosition: statusIds.get(statusId).position };
    }
  }
}

// Read only the original measured extent, plus one byte to detect growth. For v2,
// an unterminated/overlong record cannot grow the buffer, regardless of file size.
function* lines(fd, end) {
  const bytes = Buffer.allocUnsafe(maxRecordBytes + 1);
  let length = 0, offset = magic.length, start = 0;
  while (offset < end) {
    if (length === bytes.length) invalid();
    const count = readSync(fd, bytes, length, Math.min(bytes.length - length, end - offset), offset);
    if (!count) invalid();
    length += count;
    offset += count;
    let newline;
    while ((newline = bytes.indexOf(0x0A, start)) >= 0 && newline < length) {
      yield bytes.subarray(start, newline + 1);
      start = newline + 1;
    }
    bytes.copyWithin(0, start, length);
    length -= start;
    start = 0;
  }
  if (length || readSync(fd, bytes, 0, 1, end)) invalid();
}

function* v2Records(fd, end) {
  const iterator = lines(fd, end);
  try {
    const first = iterator.next().value;
    if (!first) invalid();
    const header = parse(first.subarray(0, -1), true);
    shape(header, ['version']);
    if (!positive(header.version)) invalid();
    if (header.version !== version) throw new BackupError('backupVersion');
    const digest = createHash('sha256').update(magic).update(first);
    for (const entry of iterator) {
      const record = parse(entry.subarray(0, -1), true);
      switch (record?.kind) {
        case 'project': shape(record, ['kind', ...projectKeys]); validProject(record); break;
        case 'status': shape(record, ['kind', ...statusKeys]); validStatus(record); break;
        case 'task':
          shape(record, ['kind', ...taskKeys, 'statusPosition']); validTask(record);
          if (!positive(record.statusPosition)) invalid();
          break;
        case 'end': {
          shape(record, ['kind', 'sha256']);
          if (record.sha256 !== digest.digest('hex') || !iterator.next().done) invalid();
          return;
        }
        default: invalid();
      }
      digest.update(entry);
      yield record;
    }
    invalid(); // Missing end record, even if the last business record was complete.
  } finally { iterator.return(); }
}

const drivePath = path => typeof path === 'string' && /^[a-z]:[\\/]/i.test(path) && !path.includes(':', 2);
const selectedFile = path => drivePath(path) && extname(path).toLowerCase() === '.json';
function readFilePart(fd, bytes, end) {
  let offset = 0;
  while (offset < end) {
    const count = readSync(fd, bytes, offset, end - offset, offset);
    if (!count) invalid();
    offset += count;
  }
}
function* readBackup(path) {
  try { yield* readRecords(path); }
  catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('backupRead', error);
  }
}
function* readRecords(path) {
  if (!selectedFile(path)) invalid();
  const resolved = realpathSync.native(path);
  if (!drivePath(resolved)) invalid();
  const fd = openSync(resolved, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !stat.size || !Number.isSafeInteger(stat.size)) invalid();
    const prefix = Buffer.allocUnsafe(Math.min(stat.size, magic.length));
    readFilePart(fd, prefix, prefix.length);
    if (prefix.equals(magic)) {
      yield* v2Records(fd, stat.size);
    } else {
      if (stat.size > v1MaxBytes) throw new BackupError('backupLegacyTooLarge');
      const bytes = Buffer.allocUnsafe(stat.size + 1);
      readFilePart(fd, bytes, stat.size);
      if (readSync(fd, bytes, stat.size, 1, stat.size)) invalid();
      yield* v1Records(parse(bytes.subarray(0, stat.size)));
    }
  } finally { closeSync(fd); }
}

function writeBackup(path, visit, databasePath) {
  // Reject destinations that could replace the live database (including case/path aliases).
  const disk = action => fileAccess('backupWrite', action);
  const { destination, temp, fd } = disk(() => {
    if (!selectedFile(path)) throw new BackupError('backupDestination');
    const directory = realpathSync.native(dirname(path));
    if (!drivePath(directory)) throw new BackupError('backupDestination');
    const destination = join(directory, basename(path));
    const comparable = path => normalize(path).toLowerCase();
    let existing;
    try { existing = realpathSync.native(destination); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing && (!drivePath(existing) || comparable(existing) === comparable(realpathSync.native(databasePath)))) {
      throw new BackupError('backupDestination');
    }
    const temp = join(directory, `.workspace-backup-${randomUUID()}.tmp`);
    return { destination, temp, fd: openSync(temp, 'wx', 0o600) };
  });
  try {
    try {
      const digest = createHash('sha256');
      const append = bytes => { digest.update(bytes); disk(() => writeFileSync(fd, bytes)); };
      append(magic);
      append(line({ version }));
      visit(record => append(line(record)));
      disk(() => {
        writeFileSync(fd, line({ kind: 'end', sha256: digest.digest('hex') }));
        fsyncSync(fd);
      });
    } finally { disk(() => closeSync(fd)); }
    disk(() => renameSync(temp, destination));
  } catch (error) {
    try { unlinkSync(temp); } catch { /* Best effort after a failed export. */ }
    throw error;
  }
}

module.exports = { BackupError, readBackup, writeBackup };
