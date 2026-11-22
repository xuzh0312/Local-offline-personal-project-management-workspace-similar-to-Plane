'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workspace', {
  getStorageStatus: () => ipcRenderer.invoke('workspace:storage-status'),
  getLanguage: () => ipcRenderer.invoke('workspace:get-language'),
  setLanguage: language => ipcRenderer.invoke('workspace:set-language', language),
  getTheme: () => ipcRenderer.invoke('workspace:get-theme'),
  setTheme: theme => ipcRenderer.invoke('workspace:set-theme', theme),
  exportBackup: () => ipcRenderer.invoke('workspace:export-backup'),
  restoreBackup: () => ipcRenderer.invoke('workspace:restore-backup'),
  listProjects: () => ipcRenderer.invoke('workspace:list-projects'),
  getProject: projectId => ipcRenderer.invoke('workspace:get-project', projectId),
  createProject: input => ipcRenderer.invoke('workspace:create-project', input),
  updateProject: (projectId, input) => ipcRenderer.invoke('workspace:update-project', projectId, input),
  createTask: (projectId, input) => ipcRenderer.invoke('workspace:create-task', projectId, input),
  updateTask: (projectId, taskId, input) => ipcRenderer.invoke('workspace:update-task', projectId, taskId, input),
  moveTask: (projectId, taskId, statusId) => ipcRenderer.invoke('workspace:move-task', projectId, taskId, statusId),
  setProjectArchived: (projectId, archived) => ipcRenderer.invoke('workspace:set-project-archived', projectId, archived),
  setTaskArchived: (projectId, taskId, archived) => ipcRenderer.invoke('workspace:set-task-archived', projectId, taskId, archived),
  createStatus: (projectId, name) => ipcRenderer.invoke('workspace:create-status', projectId, name),
  renameStatus: (projectId, statusId, name) => ipcRenderer.invoke('workspace:rename-status', projectId, statusId, name),
  reorderStatuses: (projectId, order) => ipcRenderer.invoke('workspace:reorder-statuses', projectId, order),
  deleteStatus: (projectId, statusId, targetId) => ipcRenderer.invoke('workspace:delete-status', projectId, statusId, targetId),
});
