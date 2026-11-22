import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Failure, Language, Project, ProjectData, Result, Status, Task, TaskInput, Theme } from './workspace-api';

import { copy, LanguageContext, priorityOptions, useCopy } from './renderer-language';
import { DrawerResize, useCardDrag } from './workspace-motion';

const api = window.workspace;

const taskNumber = (project: Project, task: Task) => `${project.code}-${task.number}`;
const statusMark = (status: Status) => ['◌', '◐', '✓'][(status.position - 1) % 3];

async function request<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await operation();
  } catch {
    return { ok: false, message: copy[document.documentElement.lang === 'en' ? 'en' : 'zh-CN'].connectionError };
  }
}

function Field({ name, label, issue, children }: { name: string; label: string; issue: Failure | null; children: ReactNode }) {
  return <div className="field">
    <label htmlFor={`field-${name}`}>{label}</label>
    {children}
    {issue?.field === name && <span id={`issue-${name}`} className="field-error" role="alert">{issue.message}</span>}
  </div>;
}

function invalid(issue: Failure | null, name: string) {
  return issue?.field === name ? { 'aria-invalid': true as const, 'aria-describedby': `issue-${name}` } : {};
}

function Drawer({ title, action, close, save, issue, dirty = false, busy, children, extraActions, kind, closing = false, afterClose }: {
  title: string; action?: string; close: () => void; save?: (event: FormEvent) => void;
  issue: Failure | null; dirty?: boolean; busy: boolean; children: ReactNode; extraActions?: ReactNode;
  kind?: 'task' | 'settings'; closing?: boolean; afterClose?: () => void;
}) {
  const t = useCopy();
  const modal = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    modal.current?.showModal();
    heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const field = issue?.field && document.getElementById(`field-${issue.field}`);
    if (field instanceof HTMLElement) field.focus();
  }, [issue]);
  useLayoutEffect(() => {
    if (!closing || !afterClose) return;
    const panel = modal.current;
    if (!panel) return;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (panel.open) panel.close();
      afterClose();
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    const duration = getComputedStyle(panel).animationDuration;
    const timer = window.setTimeout(finish, Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000) + 50);
    function ended(event: AnimationEvent) {
      if (event.target === panel && event.animationName === 'drawer-exit') finish();
    }
    panel.addEventListener('animationend', ended);
    panel.addEventListener('animationcancel', ended);
    return () => {
      window.clearTimeout(timer);
      panel.removeEventListener('animationend', ended);
      panel.removeEventListener('animationcancel', ended);
    };
  }, [closing, afterClose]);
  function dismiss() {
    if (busy || closing) return;
    if (kind !== 'task') modal.current?.close();
    close();
  }
  return <dialog ref={modal} className={`drawer${kind ? ` drawer-${kind}` : ''}`} data-closing={closing || undefined}
    aria-labelledby="drawer-title" onClose={closing ? afterClose : undefined} onCancel={event => {
      event.preventDefault();
      if (!dirty) dismiss();
    }}>
    {kind === 'task' && <DrawerResize panel={modal} active={!closing} />}
    <header className="drawer-head">
      <h2 ref={heading} id="drawer-title" tabIndex={-1}>{title}</h2>
      <button type="button" className="icon-button" disabled={busy || closing} onClick={dismiss}
        aria-label={dirty ? t.discard : t.close}>×</button>
    </header>
    {save ? <form onSubmit={save} noValidate>
      <div className="drawer-body" id={kind === 'task' ? 'task-drawer-body' : undefined}><fieldset disabled={busy || closing}>{children}</fieldset></div>
      <footer className="drawer-footer">
        {issue && !issue.field && <div className="error" role="alert">{issue.message}</div>}
        {extraActions}
        <button type="submit" className="primary" disabled={busy || closing}>{busy ? t.saving : action}</button>
      </footer>
    </form> : <div className="drawer-body"><fieldset disabled={busy}>
      {issue && <div className="error" role="alert">{issue.message}</div>}
      {children}
    </fieldset></div>}
  </dialog>;
}

function ProjectDrawer({ project, close, saved }: { project?: Project; close: () => void; saved: (project: Project) => void }) {
  const t = useCopy();
  const [name, setName] = useState(project?.name ?? '');
  const [code, setCode] = useState(project?.code ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [issue, setIssue] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = name !== (project?.name ?? '') || code !== (project?.code ?? '') || description !== (project?.description ?? '');
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setIssue(null);
    const input = { name, description };
    const result = await request(() => project ? api.updateProject(project.id, input) : api.createProject({ ...input, code }));
    if (result.ok) saved(result.value);
    else { setIssue(result); setBusy(false); }
  }
  return <Drawer title={project ? t.editProject : t.newProject} action={project ? t.saveChanges : t.createProject} {...{ close, save, issue, dirty, busy }}>
    <Field name="name" label={t.projectName} issue={issue}>
      <input id="field-name" value={name} onChange={event => setName(event.target.value)} required maxLength={120} {...invalid(issue, 'name')} />
    </Field>
    <Field name="code" label={t.projectCode} issue={issue}>
      <input id="field-code" value={code} onChange={event => setCode(event.target.value)} readOnly={!!project} required
        aria-describedby="code-hint" {...invalid(issue, 'code')} />
      <small id="code-hint">{project ? t.codeReadOnly : t.codeHint}</small>
    </Field>
    <Field name="description" label={t.description} issue={issue}>
      <textarea id="field-description" rows={6} value={description} onChange={event => setDescription(event.target.value)} maxLength={10000} {...invalid(issue, 'description')} />
    </Field>
  </Drawer>;
}

function TaskDrawer({ data, task, close, saved, closing, afterClose }: {
  data: ProjectData; task?: Task; close: () => void; saved: (task: Task) => void; closing: boolean; afterClose: () => void;
}) {
  const t = useCopy();
  const language = useContext(LanguageContext);
  const [initial] = useState<TaskInput>(() => task ?? { title: '', description: null, priority: null, dueDate: null, statusId: data.statuses[0].id });
  const [input, setInput] = useState(initial);
  const [issue, setIssue] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [invalidDate, setInvalidDate] = useState(false);
  const date = useRef<HTMLInputElement>(null);
  const dirty = invalidDate || (Object.keys(input) as (keyof TaskInput)[]).some(key => input[key] !== initial[key]);
  const set = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) => setInput(previous => ({ ...previous, [key]: value }));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (date.current?.validity.badInput) {
      setIssue({ ok: false, field: 'dueDate', message: t.incompleteDate });
      return;
    }
    setBusy(true);
    setIssue(null);
    const values: TaskInput = {
      title: input.title, description: input.description, priority: input.priority, dueDate: date.current?.value || null, statusId: input.statusId,
    };
    const result = await request(() => task ? api.updateTask(data.project.id, task.id, values) : api.createTask(data.project.id, values));
    if (result.ok) saved(result.value);
    else { setIssue(result); setBusy(false); }
  }
  return <Drawer title={task ? t.taskDetails : t.newTask} action={task ? t.saveChanges : t.createTask}
    kind={task ? 'task' : undefined} {...{ close, save, issue, dirty, busy, closing, afterClose }}>
    {task && <p className="task-number drawer-number">{taskNumber(data.project, task)}</p>}
    <Field name="title" label={t.taskTitle} issue={issue}>
      <input id="field-title" value={input.title} onChange={event => set('title', event.target.value)} required maxLength={200} {...invalid(issue, 'title')} />
    </Field>
    <div className="input-pair">
      <Field name="statusId" label={t.status} issue={issue}>
        <select id="field-statusId" value={input.statusId} onChange={event => set('statusId', Number(event.target.value))} required {...invalid(issue, 'statusId')}>
          {data.statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
        </select>
      </Field>
      <Field name="priority" label={t.priority} issue={issue}>
        <select id="field-priority" value={input.priority ?? ''} onChange={event => set('priority', (event.target.value || null) as TaskInput['priority'])} {...invalid(issue, 'priority')}>
          <option value="">{t.notSet}</option>
          {priorityOptions(t).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </Field>
    </div>
    <Field name="dueDate" label={t.dueDate} issue={issue}>
      <input ref={date} id="field-dueDate" lang={language === 'en' ? 'en-US' : 'zh-CN'} type="date" defaultValue={initial.dueDate ?? ''} onInput={event => {
        set('dueDate', event.currentTarget.value || null);
        setInvalidDate(event.currentTarget.validity.badInput);
      }} {...invalid(issue, 'dueDate')} />
    </Field>
    <Field name="description" label={t.description} issue={issue}>
      <textarea id="field-description" rows={7} value={input.description ?? ''} onChange={event => set('description', event.target.value || null)} maxLength={10000} {...invalid(issue, 'description')} />
    </Field>
  </Drawer>;
}

type StatusEdit = { kind: 'add' } | { kind: 'rename' | 'delete'; status: Status };

function StatusDrawer({ data, close, changed }: { data: ProjectData; close: () => void; changed: (data: ProjectData) => void }) {
  const t = useCopy();
  const [edit, setEdit] = useState<StatusEdit | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [issue, setIssue] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const projectId = data.project.id;
  const selected = edit && edit.kind !== 'add' ? edit.status : undefined;
  const count = selected ? data.tasks.filter(task => task.statusId === selected.id).length : 0;
  const title = edit?.kind === 'add' ? t.addStatus : edit?.kind === 'rename' ? t.renameStatus : edit?.kind === 'delete' ? t.deleteStatus : t.statusSettings;
  function select(next: StatusEdit | null) {
    setIssue(null);
    setName(next?.kind === 'rename' ? next.status.name : '');
    setTarget('');
    setEdit(next);
  }
  useLayoutEffect(() => { document.getElementById('drawer-title')?.focus({ preventScroll: true }); }, [edit]);
  async function apply(operation: () => Promise<Result<ProjectData>>, after?: () => void) {
    if (busy) return;
    setIssue(null);
    setBusy(true);
    const result = await request(operation);
    if (result.ok) { changed(result.value); after?.(); }
    else setIssue(result);
    setBusy(false);
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!edit) return;
    if (edit.kind === 'delete' && count > 0 && !target) {
      setIssue({ ok: false, field: 'statusId', message: t.targetRequired });
      return;
    }
    void apply(() => edit.kind === 'add' ? api.createStatus(projectId, name)
      : edit.kind === 'rename' ? api.renameStatus(projectId, edit.status.id, name)
      : api.deleteStatus(projectId, edit.status.id, target ? Number(target) : null), () => select(null));
  }
  function reorder(index: number, offset: number) {
    const order = data.statuses.map(status => status.id);
    [order[index], order[index + offset]] = [order[index + offset], order[index]];
    void apply(() => api.reorderStatuses(projectId, order), () => document.getElementById('drawer-title')?.focus({ preventScroll: true }));
  }
  return <Drawer title={title} action={edit?.kind === 'delete' ? t.confirmDelete : t.saveStatus} close={close}
    save={edit ? save : undefined} dirty={!!edit} issue={issue} busy={busy}
    extraActions={edit && <button type="button" className="secondary" disabled={busy} onClick={() => select(null)}>{t.cancel}</button>}>
    {!edit ? <>
      <p className="section-hint">{t.statusSettingsHint}</p>
      <ol className="status-settings">
        {data.statuses.map((status, index) => <li key={status.id}>
          <strong>{status.name}</strong>
          <div className="action-group">
            <button type="button" className="secondary" aria-label={t.moveUp(status.name)} disabled={index === 0} onClick={() => reorder(index, -1)}>↑</button>
            <button type="button" className="secondary" aria-label={t.moveDown(status.name)} disabled={index === data.statuses.length - 1} onClick={() => reorder(index, 1)}>↓</button>
            <button type="button" className="secondary" aria-label={t.renameNamed(status.name)} onClick={() => select({ kind: 'rename', status })}>{t.rename}</button>
            <button type="button" className="secondary" aria-label={t.deleteNamed(status.name)} disabled={data.statuses.length === 1} onClick={() => select({ kind: 'delete', status })}>{t.remove}</button>
          </div>
        </li>)}
      </ol>
      <button type="button" className="primary" onClick={() => select({ kind: 'add' })}>{t.addStatus}</button>
    </> : edit.kind !== 'delete' ? <Field name="name" label={t.statusName} issue={issue}>
      <input id="field-name" value={name} onChange={event => setName(event.target.value)} required maxLength={120} {...invalid(issue, 'name')} />
    </Field> : <>
      <p className="section-hint">{count ? t.deleteWithTasks(edit.status.name, count) : t.deleteEmpty(edit.status.name)}</p>
      {count > 0 && <Field name="statusId" label={t.moveTo} issue={issue}>
        <select id="field-statusId" value={target} onChange={event => setTarget(event.target.value)} required {...invalid(issue, 'statusId')}>
          <option value="">{t.selectStatus}</option>
          {data.statuses.filter(status => status.id !== edit.status.id).map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
        </select>
      </Field>}
    </>}
  </Drawer>;
}

function ArchiveConfirmation({ title, name, detail, close, archive }: {
  title: string; name: string; detail: string; close: () => void; archive: () => Promise<Result<unknown>>;
}) {
  const t = useCopy();
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<Failure | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setIssue(null);
    const result = await archive();
    if (result.ok) close();
    else { setIssue(result); setBusy(false); }
  }
  return <Drawer title={title} action={t.confirmArchive} issue={issue} busy={busy} close={close} save={save}
    extraActions={<button type="button" className="secondary" disabled={busy} onClick={close}>{t.cancel}</button>}>
    <p className="section-hint">{t.archivePrompt(name)}{' '}{detail}</p>
  </Drawer>;
}

function ArchivedTasks({ data, close, restored }: { data: ProjectData; close: () => void; restored: (task: Task) => void }) {
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<Failure | null>(null);
  const t = useCopy();
  const tasks = data.tasks.filter(task => task.archived);
  async function restore(task: Task) {
    if (busy) return;
    setBusy(true);
    setIssue(null);
    const result = await request(() => api.setTaskArchived(data.project.id, task.id, false));
    if (result.ok) {
      document.getElementById('drawer-title')?.focus({ preventScroll: true });
      restored(result.value);
    } else setIssue(result);
    setBusy(false);
  }
  return <Drawer title={t.archivedTasks} close={close} busy={busy} issue={issue}>
    {tasks.length === 0 && <p className="empty">{t.noArchivedTasks}</p>}
    <ul className="archive-tasks">
      {tasks.map(task => <li key={task.id}>
        <span className="task-number">{taskNumber(data.project, task)}</span>
        <strong>{task.title}</strong>
        <small>{t.archivedTaskMeta(data.statuses.find(status => status.id === task.statusId)?.name ?? '', task.priority ? t[task.priority] : t.notSet)}</small>
        {task.dueDate && <time dateTime={task.dueDate}>{t.shownDate(task.dueDate)}</time>}
        {task.description && <p>{task.description}</p>}
        <button type="button" className="secondary" aria-label={t.restoreNamed(taskNumber(data.project, task))} onClick={() => void restore(task)}>{t.restoreTask}</button>
      </li>)}
    </ul>
  </Drawer>;
}

function StatusMenu({ statuses, task, number, busy, move, archive }: {
  statuses: Status[]; task: Task; number: string; busy: boolean; move: (task: Task, statusId: number) => void;
  archive: (id: number, source: HTMLElement) => void;
}) {
  const t = useCopy();
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  function placeMenu() {
    if (!button.current || !menu.current) return;
    const anchor = button.current.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    const margin = 8;
    const gap = 4;
    const width = Math.min(300, clientWidth - 2 * margin);
    const below = clientHeight - Math.max(anchor.bottom + gap, margin) - margin;
    const above = Math.min(anchor.top - gap, clientHeight - margin) - margin;
    const down = below >= above;
    const start = Math.min(Math.max(margin, anchor.right - width), clientWidth - margin - width);
    const style = menu.current.style;
    style.inlineSize = `${width}px`;
    style.left = `${start}px`;
    style.top = down ? `${Math.max(margin, anchor.bottom + gap)}px` : 'auto';
    style.bottom = down ? 'auto' : `${Math.max(margin, clientHeight - anchor.top + gap)}px`;
    style.maxBlockSize = `${down ? below : above}px`;
  }
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', placeMenu);
    return () => window.removeEventListener('resize', placeMenu);
  }, [open]);
  return <>
    <button type="button" ref={button} id={`actions-task-${task.id}`} className="icon-button status-button" aria-label={t.taskActionsFor(number)}
      title={t.taskActions} popoverTarget={menuId} disabled={busy}>⋯</button>
    <div ref={menu} id={menuId} className="status-menu" popover="auto" aria-label={t.taskActions}
      onBeforeToggle={event => { if (event.newState === 'open') placeMenu(); }}
      onToggle={event => setOpen(event.newState === 'open')} onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        menu.current?.hidePopover();
        button.current?.focus({ preventScroll: true });
      }}>
      <span>{t.changeStatus}</span>
      {statuses.map(status => <button key={status.id} type="button" disabled={status.id === task.statusId || busy} onClick={() => {
        menu.current?.hidePopover();
        button.current?.focus({ preventScroll: true });
        move(task, status.id);
      }}>{statusMark(status)} {status.name}{status.id === task.statusId ? t.currentStatus : ''}</button>)}
      <button type="button" disabled={busy} onClick={() => {
        menu.current?.hidePopover();
        if (button.current) archive(task.id, button.current);
      }}>{t.archiveTask}</button>
    </div>
  </>;
}

function TaskItem({ data, task, board, open, archive, move, busy, dragStart, consumeClick, selected }: {
  data: ProjectData; task: Task; board: boolean; open: (id: number, source: HTMLElement) => void;
  archive: (id: number, source: HTMLElement) => void;
  move: (task: Task, statusId: number) => void; busy: boolean; selected: boolean;
  dragStart: (event: ReactPointerEvent<HTMLElement>, task: Task) => void; consumeClick: (detail: number) => boolean;
}) {
  const t = useCopy();
  const number = taskNumber(data.project, task);
  const status = data.statuses.find(value => value.id === task.statusId);
  return <article className={board ? 'task-card' : 'task-row'} data-task-id={task.id} data-selected={selected || undefined}
    onPointerDown={board && !busy ? event => dragStart(event, task) : undefined}>
    <span className="task-number">{number}</span>
    <button type="button" className="task-open" id={`open-task-${task.id}`} aria-label={`${number} ${task.title}`} disabled={busy}
      aria-haspopup="dialog" aria-expanded={selected} onClick={event => {
        if (!board || !consumeClick(event.detail)) open(task.id, event.currentTarget);
      }}>{task.title}</button>
    {board && <span className="card-grip" aria-hidden="true">⠿</span>}
    {!board && status && <span className={`status-label tone-${status.position}`}>{statusMark(status)} {status.name}</span>}
    <div className="task-meta">
      {task.priority && <span className={`priority-${task.priority}`}>⚑ {t.priorityLabel(t[task.priority])}</span>}
      {task.dueDate && <time dateTime={task.dueDate}>▣ {task.dueDate}</time>}
    </div>
    <StatusMenu statuses={data.statuses} {...{ task, number, busy, move, archive }} />
  </article>;
}

const themes: Theme[] = ['sage', 'lavender', 'blue', 'yellow', 'white'];
type ThemeIssue = 'load' | 'save';
type DropStatus = { number: string; destination: string | null };

function SettingsDrawer({ language, theme, themeIssue, changeTheme, close, changeLanguage, restored }: {
  language: Language; theme: Theme; themeIssue: ThemeIssue | null; changeTheme: (value: Theme) => void;
  close: () => void; changeLanguage: (value: Language) => void; restored: () => void;
}) {
  const t = useCopy();
  const [issue, setIssue] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!busy) { trigger.current?.focus({ preventScroll: true }); trigger.current = null; }
  }, [busy]);
  async function applyLanguage(value: Language, source: HTMLSelectElement) {
    if (busy || value === language) return;
    trigger.current = source;
    setBusy(true);
    setIssue(null);
    const result = await request(() => api.setLanguage(value));
    if (result.ok) changeLanguage(result.value);
    else setIssue(result);
    setBusy(false);
  }
  async function backup(restore: boolean, source: HTMLButtonElement) {
    if (busy) return;
    trigger.current = source;
    setBusy(true);
    setIssue(null);
    setExported(false);
    const result = await request(restore ? api.restoreBackup : api.exportBackup);
    if (!result.ok) setIssue(result);
    else if (restore && result.value) {
      restored();
      return;
    } else if (result.value) setExported(true);
    setBusy(false);
  }
  return <Drawer title={t.settings} kind="settings" {...{ close, issue, busy }}>
    <section className="settings-appearance" aria-labelledby="appearance-heading">
      <h3 id="appearance-heading">{t.appearance}</h3>
      <div className="theme-options" role="radiogroup" aria-labelledby="appearance-heading">
        {themes.map(value => <label key={value} className="theme-option" data-swatch={value}>
          <input type="radio" name="workspace-theme" value={value} checked={value === theme} onChange={() => changeTheme(value)} />
          <span className="theme-chip" aria-hidden="true" />
          <span className="theme-label">{t.themes[value]}</span>
          <span className="theme-check" aria-hidden="true">✓</span>
        </label>)}
      </div>
      {themeIssue && <p className="error" role="alert">{themeIssue === 'load' ? t.themeReadError : t.themeWriteError}</p>}
    </section>
    <Field name="language" label={t.language} issue={issue}>
      <select id="field-language" value={language} onChange={event => void applyLanguage(event.currentTarget.value as Language, event.currentTarget)}>
        <option value="zh-CN" lang="zh-CN">简体中文</option><option value="en" lang="en">English</option>
      </select>
    </Field>
    <section className="settings-backup" aria-labelledby="backup-heading">
      <h3 id="backup-heading">{t.backupTools}</h3>
      <p className="section-hint">{t.backupHint}</p>
      <div className="action-group">
        <button type="button" className="primary" onClick={event => void backup(false, event.currentTarget)}>{t.exportBackup}</button>
        <button type="button" className="secondary" onClick={event => void backup(true, event.currentTarget)}>{t.restoreBackup}</button>
      </div>
      {busy && <p className="settings-status" role="status">{t.backupWorking}</p>}
      {exported && <p className="settings-status" role="status">{t.backupSaved}</p>}
    </section>
  </Drawer>;
}

type Dialog = { kind: 'new-project' | 'edit-project' | 'status-settings' | 'archive-project' | 'archived-tasks' | 'settings' }
  | { kind: 'task'; id?: number } | { kind: 'archive-task'; id: number };
const noFilters = { query: '', status: '', priority: '' };

function inView(element: HTMLElement | undefined) {
  if (!element?.isConnected || element.matches(':disabled')) return false;
  const box = element.getBoundingClientRect();
  if (box.width === 0 || box.height === 0 || box.right <= 0 || box.bottom <= 0 || box.left >= innerWidth || box.top >= innerHeight) return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(parent);
    const clip = parent.getBoundingClientRect();
    if (overflowX !== 'visible' && (box.right <= clip.left || box.left >= clip.right)) return false;
    if (overflowY !== 'visible' && (box.bottom <= clip.top || box.top >= clip.bottom)) return false;
  }
  return true;
}

function App() {
  const [language, setLanguage] = useState<Language>('zh-CN');
  const [theme, setTheme] = useState<Theme>('sage');
  const [themeIssue, setThemeIssue] = useState<ThemeIssue | null>(null);
  const themeSave = useRef({ persisted: 'sage' as Theme, pending: Promise.resolve(), version: 0 });
  const t = copy[language];
  const [projects, setProjects] = useState<Project[]>([]);
  const [data, setData] = useState<ProjectData | null>(null);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [filters, setFilters] = useState(noFilters);
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [projectList, setProjectList] = useState<'loading' | 'error' | 'ready'>('loading');
  const [restored, setRestored] = useState(false);
  const [dropStatus, setDropStatus] = useState<DropStatus | null>(null);
  const [closing, setClosing] = useState(false);
  const { begin: startCardDrag, consumeClick } = useCardDrag(`${data?.project.id}:${view}:${!!dialog}`, () => setDropStatus(null));
  const focusView = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const opener = useRef<{ source: HTMLElement; scroll: HTMLElement | null; left: number; top: number;
    outer: HTMLElement | null; outerTop: number } | null>(null);
  const moving = useRef(false);

  async function loadProjects() {
    setBusy(true);
    const result = await request(api.listProjects);
    if (result.ok) setProjects(result.value);
    setProjectList(result.ok ? 'ready' : 'error');
    setBusy(false);
  }
  async function initialize() {
    const preference = await request(api.getLanguage);
    if (preference.ok) setLanguage(preference.value);
    else setMessage(preference.message);
    const appearance = await request(api.getTheme);
    if (appearance.ok) {
      themeSave.current.persisted = appearance.value;
      setTheme(appearance.value);
    } else setThemeIssue('load');
    await loadProjects();
  }
  useEffect(() => { void initialize(); }, []);
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.title = t.title;
  }, [language, t.title]);
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  function changeTheme(value: Theme) {
    setTheme(value);
    setThemeIssue(null);
    const save = themeSave.current;
    const version = ++save.version;
    save.pending = save.pending.then(async () => {
      const result = await request(() => api.setTheme(value));
      if (result.ok) save.persisted = result.value;
      else if (version === save.version) {
        setTheme(save.persisted);
        setThemeIssue('save');
      }
    });
  }

  async function openProject(id: number) {
    if (busy || data?.project.id === id) return;
    setBusy(true);
    setMessage('');
    const result = await request(() => api.getProject(id));
    if (result.ok) { setData(result.value); setView('board'); setFilters(noFilters); setShowArchived(false); setDropStatus(null); }
    else setMessage(result.message);
    setBusy(false);
  }

  function show(next: Dialog, source: HTMLElement) {
    if (busy || dialog) return;
    const scroll = scroller.current ?? (focusView.current?.matches('.overview') ? focusView.current : null);
    const outer = scroll?.closest<HTMLElement>('.workspace') ?? null;
    opener.current = { source, scroll, left: scroll?.scrollLeft ?? 0, top: scroll?.scrollTop ?? 0, outer, outerTop: outer?.scrollTop ?? 0 };
    setDialog(next);
  }
  useLayoutEffect(() => {
    if (dialog || !opener.current) return;
    const { source, scroll, left, top, outer, outerTop } = opener.current;
    opener.current = null;
    if (outer?.isConnected) outer.scrollTop = outerTop;
    if (scroll?.isConnected) scroll.scrollTo(left, top);
    const replacement = source.isConnected ? source : document.getElementById(source.id) ?? undefined;
    (inView(replacement) ? replacement : focusView.current)?.focus({ preventScroll: true });
  }, [dialog]);

  function taskSaved(task: Task) {
    setDropStatus(null);
    setData(previous => {
      if (!previous || task.projectId !== previous.project.id) return previous;
      const exists = previous.tasks.some(item => item.id === task.id);
      return { ...previous, tasks: exists ? previous.tasks.map(item => item.id === task.id ? task : item) : [...previous.tasks, task] };
    });
  }
  function projectSaved(saved: Project) {
    setProjects(previous => previous.some(item => item.id === saved.id)
      ? previous.map(item => item.id === saved.id ? saved : item) : [...previous, saved]);
    if (saved.archived) { setData(null); setShowArchived(false); }
    else setData(previous => previous?.project.id === saved.id ? { ...previous, project: saved } : previous);
  }
  async function restoreProject(projectId: number) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    const result = await request(() => api.setProjectArchived(projectId, false));
    if (result.ok) {
      focusView.current?.focus({ preventScroll: true });
      projectSaved(result.value);
    } else setMessage(result.message);
    setBusy(false);
  }
  function statusesChanged(next: ProjectData) {
    setDropStatus(null);
    setData(next);
    setFilters(previous => previous.status && !next.statuses.some(status => String(status.id) === previous.status)
      ? { ...previous, status: '' } : previous);
  }
  async function move(task: Task, statusId: number) {
    if (!data || busy || moving.current || task.projectId !== data.project.id || statusId === task.statusId ||
      !data.statuses.some(status => status.id === statusId)) return false;
    moving.current = true;
    setBusy(true);
    setMessage('');
    setDropStatus(null);
    const result = await request(() => api.moveTask(data.project.id, task.id, statusId));
    if (result.ok) taskSaved(result.value);
    else setMessage(result.message);
    moving.current = false;
    setBusy(false);
    return result.ok;
  }

  function dragStart(event: ReactPointerEvent<HTMLElement>, task: Task) {
    if (busy || dialog || !data) return;
    const number = taskNumber(data.project, task);
    startCardDrag(event, task, async statusId => {
      if (statusId === null) { setDropStatus({ number, destination: null }); return false; }
      const status = data.statuses.find(status => status.id === statusId);
      if (!status || !await move(task, status.id)) return false;
      setDropStatus({ number, destination: status.name });
      return true;
    });
  }

  const afterClose = useCallback(() => { setDialog(null); setClosing(false); }, []);
  const close = () => {
    if (dialog?.kind === 'task' && dialog.id !== undefined) setClosing(true);
    else afterClose();
  };
  const overview = () => { setData(null); setShowArchived(false); setMessage(''); setDropStatus(null); };
  function restoredBackup() {
    overview();
    setRestored(true);
    setProjectList('loading');
    close();
    void loadProjects();
  }
  const archiveTask = (id: number, source: HTMLElement) => show({ kind: 'archive-task', id }, source);
  const project = data?.project;
  const dropFeedback = !dropStatus ? '' : dropStatus.destination === null ? t.dropReturned(dropStatus.number)
    : t.dropMoved(dropStatus.number, dropStatus.destination);
  const listReady = projectList === 'ready';
  const activeProjects = listReady ? projects.filter(item => !item.archived) : [];
  const shownProjects = showArchived && listReady ? projects.filter(item => item.archived) : activeProjects;
  const query = filters.query.trim().toLowerCase();
  const filtering = !!(filters.query || filters.status || filters.priority);
  const shownTasks = data ? data.tasks.filter(task => !task.archived &&
    (!query || task.title.toLowerCase().includes(query) || taskNumber(data.project, task).toLowerCase().includes(query)) &&
    (!filters.status || String(task.statusId) === filters.status) &&
    (!filters.priority || (task.priority ?? 'none') === filters.priority)) : [];
  const taskToArchive = dialog?.kind === 'archive-task' ? data?.tasks.find(task => task.id === dialog.id) : undefined;
  return <LanguageContext.Provider value={language}>
    <div className="app-shell">
      <aside className="sidebar" aria-label={t.navigation}>
        <div className="brand"><span aria-hidden="true">▣</span><div><strong>{t.brand}</strong><small>{t.local}</small></div></div>
        <button className="nav-button" aria-current={!project && !showArchived ? 'page' : undefined} disabled={busy} onClick={overview}>
          <span aria-hidden="true">▦</span> {t.overview}</button>
        <div className="sidebar-heading"><strong>{t.myProjects}</strong><button type="button" className="icon-button" id="nav-new-project" aria-label={t.newProject} title={t.newProject} disabled={busy || !listReady}
          onClick={event => show({ kind: 'new-project' }, event.currentTarget)}>＋</button></div>
        <nav className="project-nav" aria-label={t.myProjects}>
          {activeProjects.map(item => <button key={item.id} className="nav-button" title={item.name} aria-current={project?.id === item.id ? 'page' : undefined} disabled={busy}
            onClick={() => void openProject(item.id)}><span aria-hidden="true">▱</span><span className="nav-label">{item.name}</span></button>)}
        </nav>
        <button type="button" id="nav-settings" className="nav-button" aria-haspopup="dialog" disabled={busy}
          onClick={event => show({ kind: 'settings' }, event.currentTarget)}><span aria-hidden="true">⚙</span> {t.settings}</button>
      </aside>
      {data && project ? <main className="workspace" aria-label={t.projectWorkspace}>
        <header className="project-head">
          <div className="crumb"><button type="button" disabled={busy} onClick={overview}>{t.projects}</button><span aria-hidden="true">›</span><span className="task-number">{project.code}</span></div>
          <div className="title-line"><h1>{project.name}</h1><div className="action-group">
            <button type="button" className="secondary" disabled={busy} onClick={event => show({ kind: 'edit-project' }, event.currentTarget)}>{t.editProject}</button>
            <button type="button" className="secondary" disabled={busy} onClick={event => show({ kind: 'archive-project' }, event.currentTarget)}>{t.archiveProject}</button>
          </div></div>
          {project.description && <p className="project-description">{project.description}</p>}
          <nav className="view-switch" aria-label={t.projectViews}>
            <button type="button" aria-pressed={view === 'board'} disabled={busy} onClick={() => { setView('board'); setMessage(''); }}>▥ {t.board}</button>
            <button type="button" aria-pressed={view === 'list'} disabled={busy} onClick={() => { setView('list'); setMessage(''); setDropStatus(null); }}>☷ {t.list}</button>
          </nav>
        </header>
        <div className="view-body">
          <div className="toolbar">
            <div className="action-group">
              <button type="button" className="primary" disabled={busy} onClick={event => show({ kind: 'task' }, event.currentTarget)}>＋ {t.newTask}</button>
              <button type="button" className="secondary" disabled={busy} onClick={event => show({ kind: 'status-settings' }, event.currentTarget)}>{t.statusSettings}</button>
              <button type="button" className="secondary" disabled={busy} onClick={event => show({ kind: 'archived-tasks' }, event.currentTarget)}>{t.archivedTasks}</button>
            </div>
            <div className="task-filters" role="group" aria-label={t.searchFilters}>
              <input id="search-tasks" type="search" aria-label={t.searchLabel} placeholder={t.searchPlaceholder} value={filters.query}
                onChange={event => setFilters({ ...filters, query: event.target.value })} />
              <select id="filter-status" aria-label={t.filterStatus} value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}>
                <option value="">{t.allStatuses}</option>
                {data.statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
              </select>
              <select id="filter-priority" aria-label={t.filterPriority} value={filters.priority} onChange={event => setFilters({ ...filters, priority: event.target.value })}>
                <option value="">{t.allPriorities}</option><option value="none">{t.noPriority}</option>
                {priorityOptions(t).map(([key, label]) => <option key={key} value={key}>{t.priorityLabel(label)}</option>)}
              </select>
            </div>
          </div>
          {message && <div className="error" role="alert">{message}</div>}
          <div className="view-scroll" key={`${project.id}:${view}`} ref={node => { scroller.current = node; focusView.current = node; }}
            role="region" tabIndex={-1} aria-label={view === 'board' ? t.taskBoard : t.taskList}>
            {shownTasks.length === 0 && (filtering ? <p className="empty">{t.noMatches}{' '}
              <button type="button" className="secondary" onClick={() => setFilters(noFilters)}>{t.clearFilters}</button></p>
              : <p className="empty">{t.noTasks}</p>)}
            {view === 'board' ? <div className="board">
              {data.statuses.map(status => {
                const tasks = shownTasks.filter(task => task.statusId === status.id);
                return <section key={status.id} aria-label={status.name} data-status-id={status.id}
                  className={`column tone-${status.position}`}>
                  <h2><span aria-hidden="true">{statusMark(status)}</span><span className="column-name">{status.name}</span><span className="count">{tasks.length}</span>
                    <span className="drop-label" aria-hidden="true">{t.dropHere}</span></h2>
                  {tasks.map(task => <TaskItem key={task.id} board {...{ data, task, busy, move, dragStart, consumeClick }}
                selected={dialog?.kind === 'task' && dialog.id === task.id} archive={archiveTask} open={(id, source) => show({ kind: 'task', id }, source)} />)}
                </section>;
              })}
            </div> : <div className="task-list">
              {shownTasks.map(task => <TaskItem key={task.id} board={false} {...{ data, task, busy, move, dragStart, consumeClick }}
                selected={dialog?.kind === 'task' && dialog.id === task.id} archive={archiveTask} open={(id, source) => show({ kind: 'task', id }, source)} />)}
            </div>}
          </div>
          <footer className="total"><span>{t.total(shownTasks.length)}</span>
            <span className="drop-feedback" role="status">{view === 'board' && dropFeedback}</span></footer>
        </div>
      </main> : <main className="overview" ref={node => { if (node) focusView.current = node; }} tabIndex={-1}>
        <div className="crumb">{t.local}</div>
        <div className="title-line"><h1>{showArchived ? t.archivedProjects : t.overview}</h1><div className="action-group">
          <button type="button" className="secondary" disabled={busy} onClick={() => { setShowArchived(!showArchived); setMessage(''); }}>
            {showArchived ? t.backToOverview : t.archivedProjects}
          </button>
          {!showArchived && <button type="button" className="primary" disabled={busy || !listReady}
            onClick={event => show({ kind: 'new-project' }, event.currentTarget)}>＋ {t.newProject}</button>}
        </div></div>
        {message && <div className="error" role="alert">{message}</div>}
        {projectList === 'error' && <div className="error" role="alert">{t.projectListError}{' '}
          <button type="button" className="secondary" disabled={busy} onClick={() => void loadProjects()}>{t.retry}</button>
        </div>}
        {restored && projectList === 'error' && <p className="settings-status" role="status">{t.backupRestoredRefreshError}</p>}
        {restored && listReady && !showArchived && !busy && <p className="settings-status" role="status">{t.backupRestored}</p>}
        {projectList === 'loading' && <p role="status">{t.loading}</p>}
        {listReady && !busy && !message && shownProjects.length === 0 && <p className="empty">{showArchived ? t.noArchivedProjects : t.noProjects}</p>}
        <div className="project-grid">
          {showArchived ? shownProjects.map(item => <article key={item.id} className="project-card archived-project">
            <span className="task-number">{item.code}</span><strong>{item.name}</strong>{item.description && <p>{item.description}</p>}
            <button type="button" className="secondary" aria-label={t.restoreNamed(item.code)} disabled={busy} onClick={() => void restoreProject(item.id)}>{t.restoreProject}</button>
          </article>) : shownProjects.map(item => <button key={item.id} className="project-card" disabled={busy} onClick={() => void openProject(item.id)}>
            <span className="task-number">{item.code}</span><strong>{item.name}</strong>{item.description && <span>{item.description}</span>}
          </button>)}
        </div>
      </main>}
    </div>
    {dialog?.kind === 'task' && data && <TaskDrawer data={data} task={data.tasks.find(task => task.id === dialog.id)} close={close} closing={closing} afterClose={afterClose} saved={task => { taskSaved(task); close(); }} />}
    {(dialog?.kind === 'new-project' || dialog?.kind === 'edit-project') && <ProjectDrawer project={dialog.kind === 'edit-project' ? project : undefined}
      close={close} saved={saved => { projectSaved(saved); close(); }} />}
    {dialog?.kind === 'status-settings' && data && <StatusDrawer data={data} close={close} changed={statusesChanged} />}
    {dialog?.kind === 'archived-tasks' && data && <ArchivedTasks data={data} close={close} restored={taskSaved} />}
    {dialog?.kind === 'archive-project' && project && <ArchiveConfirmation title={t.archiveProject} name={project.name} close={close}
      detail={t.archiveProjectHint} archive={async () => {
        const result = await request(() => api.setProjectArchived(project.id, true));
        if (result.ok) { setMessage(''); projectSaved(result.value); }
        return result;
      }} />}
    {taskToArchive && project && <ArchiveConfirmation title={t.archiveTask} name={`${taskNumber(project, taskToArchive)} ${taskToArchive.title}`} close={close}
      detail={t.archiveTaskHint} archive={async () => {
        const result = await request(() => api.setTaskArchived(project.id, taskToArchive.id, true));
        if (result.ok) { setMessage(''); taskSaved(result.value); }
        return result;
      }} />}
    {dialog?.kind === 'settings' && <SettingsDrawer {...{ language, theme, themeIssue, changeTheme, close }} changeLanguage={value => {
      setLanguage(value);
      setMessage('');
    }} restored={restoredBackup} />}
  </LanguageContext.Provider>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing React mount point');
createRoot(root).render(<App />);
