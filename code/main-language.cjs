'use strict';

const copy = {
  'zh-CN': {
    statuses: ['待办', '进行中', '已完成'], title: '离线个人项目管理工作台',
    labels: { projectId: '项目', taskId: '任务', statusId: '任务状态', name: '项目名称', statusName: '状态名称', title: '任务标题', description: '描述' },
    invalidId: label => `${label}无效。`, invalidText: label => `${label}格式不正确。`,
    textTooLong: (label, limit) => `${label}不能超过 ${limit} 个字符。`, requiredText: label => `请输入${label}。`,
    invalidInput: '输入格式不正确。', invalidCode: '代号须为 2–10 位并以英文字母开头，只能包含英文字母和数字。',
    invalidPriority: '请选择有效的优先级。', invalidDate: '请输入有效的截止日期。', invalidArchive: '归档操作无效。',
    missingProject: '找不到这个项目。', foreignStatus: '该状态不属于当前项目。', archivedProject: '请先恢复该项目。',
    missingTask: '在当前项目中找不到这个任务。', archivedTask: '请先恢复该任务。', duplicateStatus: '当前项目已有同名状态。',
    duplicateCode: '该项目代号已使用。', invalidOrder: '状态排序必须包含当前项目的全部状态，且每项只出现一次。',
    lastStatus: '每个项目至少保留一个状态。', sameStatus: '请选择另一个状态作为迁移目标。',
    targetRequired: '该状态仍有任务，请选择迁移目标。', numbersExhausted: '该项目的任务编号已用尽。',
    invalidLanguage: '请选择受支持的语言。', invalidTheme: '请选择受支持的主题。',
    backupNotEmpty: '本机工作区已有项目（包括已归档项目），只能恢复到空工作区。',
    backupInvalid: '备份内容损坏或不符合工作台格式，没有恢复任何数据。',
    backupVersion: '不支持此备份版本，没有恢复任何数据。',
    backupLegacyTooLarge: '此文件超过旧版备份格式的 64 MiB 上限，未恢复任何数据。',
    backupDestination: '请选择一个 .json 备份文件，不要覆盖工作台数据库。',
    backupRead: '无法打开或读取备份文件。请检查文件是否存在且可读，然后重试。',
    backupWrite: '无法保存备份文件。请检查目标位置、权限和磁盘空间，然后重试。',
    backupBusy: '正在处理备份或恢复，请稍后再试。',
    saveDialog: '保存工作台备份', openDialog: '选择工作台备份', fileLabel: '工作台备份 (JSON)',
    operations: {
      listProjects: '无法读取项目列表：', getProject: '无法读取项目：', createProject: '无法创建项目：', updateProject: '无法保存项目：',
      createTask: '无法创建任务：', updateTask: '无法保存任务：', moveTask: '无法更改任务状态：',
      setProjectArchived: '无法更改项目归档状态：', setTaskArchived: '无法更改任务归档状态：', createStatus: '无法添加状态：',
      renameStatus: '无法重命名状态：', reorderStatuses: '无法调整状态顺序：', deleteStatus: '无法删除状态：',
      getLanguage: '无法读取语言偏好：', setLanguage: '无法保存语言偏好：', getTheme: '无法读取主题偏好：', setTheme: '无法保存主题：', exportBackup: '无法读取备份数据：', restoreBackup: '无法恢复备份：',
    },
    dbReasons: { 5: '本地数据库正忙。', 6: '本地数据库暂被锁定。', 8: '本地数据库为只读。', 10: '本地磁盘读写出错。',
      13: '磁盘空间不足。', 19: '本地数据库拒绝了此次更改。' },
    dbError: '本地数据库发生错误。', retry: '请重试。',
    menu: ['文件', '退出', '编辑', '撤销', '重做', '剪切', '复制', '粘贴', '删除', '全选', '视图', '重新加载', '强制重新加载', '开发者工具',
      '实际大小', '放大', '缩小', '全屏', '窗口', '最小化', '缩放', '关闭'],
    startupTitle: '启动失败', startupError: '无法打开本地工作台。请检查本机存储是否可用，然后重试。',
  },
  en: {
    statuses: ['To do', 'In progress', 'Done'], title: 'Offline Project Workspace',
    labels: { projectId: 'Project', taskId: 'Task', statusId: 'Task status', name: 'Project name', statusName: 'Status name', title: 'Task title', description: 'Description' },
    invalidId: label => `${label} is invalid.`, invalidText: label => `${label} must be valid text.`,
    textTooLong: (label, limit) => `${label} cannot exceed ${limit} characters.`, requiredText: label => `Enter a ${label.toLowerCase()}.`,
    invalidInput: 'The input format is invalid.', invalidCode: 'Use 2–10 letters or digits for the project code, starting with a letter.',
    invalidPriority: 'Select a valid priority.', invalidDate: 'Enter a valid due date.', invalidArchive: 'The archive request is invalid.',
    missingProject: 'This project could not be found.', foreignStatus: 'This status does not belong to the current project.', archivedProject: 'Restore this project first.',
    missingTask: 'This task could not be found in the current project.', archivedTask: 'Restore this task first.', duplicateStatus: 'This project already has a status with that name.',
    duplicateCode: 'This project code is already in use.', invalidOrder: 'Include every status from this project exactly once.',
    lastStatus: 'A project must keep at least one status.', sameStatus: 'Select another status to move the tasks to.',
    targetRequired: 'Select a status to move the remaining tasks to.', numbersExhausted: 'This project has run out of task numbers.',
    invalidLanguage: 'Select a supported language.', invalidTheme: 'Select a supported theme.',
    backupNotEmpty: 'This workspace already contains projects (including archived projects). Restore requires an empty workspace.',
    backupInvalid: 'The backup is damaged or has an invalid format. No data was restored.',
    backupVersion: 'This backup version is not supported. No data was restored.',
    backupLegacyTooLarge: 'This file exceeds the 64 MiB limit of the older backup format. No data was restored.',
    backupDestination: 'Choose a .json backup file. Do not replace the workspace database.',
    backupRead: 'Could not open or read the backup. Check that the file exists and is readable, then try again.',
    backupWrite: 'Could not save the backup. Check the destination, permissions, and free disk space, then try again.',
    backupBusy: 'A backup or restore is already in progress. Please try again.',
    saveDialog: 'Save workspace backup', openDialog: 'Choose workspace backup', fileLabel: 'Workspace backup (JSON)',
    operations: {
      listProjects: 'Could not load projects: ', getProject: 'Could not load the project: ', createProject: 'Could not create the project: ', updateProject: 'Could not save the project: ',
      createTask: 'Could not create the task: ', updateTask: 'Could not save the task: ', moveTask: 'Could not change the task status: ',
      setProjectArchived: 'Could not change the project archive status: ', setTaskArchived: 'Could not change the task archive status: ', createStatus: 'Could not add the status: ',
      renameStatus: 'Could not rename the status: ', reorderStatuses: 'Could not reorder statuses: ', deleteStatus: 'Could not delete the status: ',
      getLanguage: 'Could not load the language preference: ', setLanguage: 'Could not save the language preference: ', getTheme: 'Could not load the theme preference: ', setTheme: 'Could not save the theme: ', exportBackup: 'Could not read backup data: ', restoreBackup: 'Could not restore the backup: ',
    },
    dbReasons: { 5: 'The local database is busy. ', 6: 'The local database is temporarily locked. ', 8: 'The local database is read-only. ',
      10: 'A local disk read or write failed. ', 13: 'The disk is full. ', 19: 'The local database rejected the change. ' },
    dbError: 'A local database error occurred. ', retry: 'Try again.',
    menu: ['File', 'Exit', 'Edit', 'Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Select All', 'View', 'Reload', 'Force Reload', 'Developer Tools',
      'Actual Size', 'Zoom In', 'Zoom Out', 'Full Screen', 'Window', 'Minimize', 'Zoom', 'Close'],
    startupTitle: 'Startup failed', startupError: 'Could not open the local workspace. Check that local storage is available, then try again.',
  },
};

function inputFailure(language, error) {
  const labels = copy[language].labels;
  const entry = copy[language][error.code];
  const message = typeof entry === 'function' ? entry(labels[error.field], error.limit) : entry;
  // These fields identify invalid IPC IDs, not focusable form inputs.
  const field = { projectId: undefined, taskId: undefined, statusName: 'name' };
  return { ok: false, message, field: Object.hasOwn(field, error.field) ? field[error.field] : error.field };
}

function menuTemplate(language) {
  const [file, exit, edit, undo, redo, cut, copyText, paste, remove, selectAll, view, reload, forceReload, tools,
    resetZoom, zoomIn, zoomOut, fullScreen, window, minimize, zoom, close] = copy[language].menu;
  const separator = { type: 'separator' };
  const item = (role, label) => ({ role, label });
  return [
    { label: file, submenu: [item('quit', exit)] },
    { label: edit, submenu: [item('undo', undo), item('redo', redo), separator, item('cut', cut), item('copy', copyText), item('paste', paste), item('delete', remove), separator, item('selectAll', selectAll)] },
    { label: view, submenu: [item('reload', reload), item('forceReload', forceReload), item('toggleDevTools', tools), separator,
      item('resetZoom', resetZoom), item('zoomIn', zoomIn), item('zoomOut', zoomOut), separator, item('togglefullscreen', fullScreen)] },
    { label: window, submenu: [item('minimize', minimize), item('zoom', zoom), item('close', close)] },
  ];
}

module.exports = { copy, inputFailure, menuTemplate };
