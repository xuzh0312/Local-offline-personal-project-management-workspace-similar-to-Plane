export type Language = 'zh-CN' | 'en';
export type Theme = 'sage' | 'lavender' | 'blue' | 'yellow' | 'white';
export type Project = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  archived: 0 | 1;
};
export type Status = { id: number; name: string; position: number };
export type TaskInput = {
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | null;
  dueDate: string | null;
  statusId: number;
};
export type Task = TaskInput & { id: number; projectId: number; number: number; archived: 0 | 1 };
export type ProjectData = { project: Project; statuses: Status[]; tasks: Task[] };
export type ProjectInput = Pick<Project, 'name' | 'description'>;
export type Failure = { ok: false; message: string; field?: string };
export type Result<T> = { ok: true; value: T } | Failure;

declare global {
  interface Window {
    readonly workspace: Readonly<{
      getStorageStatus(): Promise<'ready'>;
      getLanguage(): Promise<Result<Language>>;
      setLanguage(language: Language): Promise<Result<Language>>;
      getTheme(): Promise<Result<Theme>>;
      setTheme(theme: Theme): Promise<Result<Theme>>;
      exportBackup(): Promise<Result<true | null>>;
      restoreBackup(): Promise<Result<true | null>>;
      listProjects(): Promise<Result<Project[]>>;
      getProject(projectId: number): Promise<Result<ProjectData>>;
      createProject(input: ProjectInput & { code: string }): Promise<Result<Project>>;
      updateProject(projectId: number, input: ProjectInput): Promise<Result<Project>>;
      createTask(projectId: number, input: TaskInput): Promise<Result<Task>>;
      updateTask(projectId: number, taskId: number, input: TaskInput): Promise<Result<Task>>;
      moveTask(projectId: number, taskId: number, statusId: number): Promise<Result<Task>>;
      setProjectArchived(projectId: number, archived: boolean): Promise<Result<Project>>;
      setTaskArchived(projectId: number, taskId: number, archived: boolean): Promise<Result<Task>>;
      createStatus(projectId: number, name: string): Promise<Result<ProjectData>>;
      renameStatus(projectId: number, statusId: number, name: string): Promise<Result<ProjectData>>;
      reorderStatuses(projectId: number, order: number[]): Promise<Result<ProjectData>>;
      deleteStatus(projectId: number, statusId: number, targetId: number | null): Promise<Result<ProjectData>>;
    }>;
  }
}
