import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { Channels, type Api, type WindowState } from '@shared/ipc'
import type { Book } from '@shared/types'

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

/** Listens to a main → renderer event; returns the unsubscribe function. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  library: {
    list: () => invoke(Channels.libraryList),
    import: (paths) => invoke(Channels.libraryImport, paths),
    openDialog: () => invoke(Channels.libraryOpenDialog),
    remove: (bookId, deleteAnnotations) =>
      invoke(Channels.libraryRemove, bookId, deleteAnnotations),
    relocate: (bookId) => invoke(Channels.libraryRelocate, bookId),
    getFile: (bookId) => invoke(Channels.libraryGetFile, bookId),
    saveThumbnail: (bookId, png) => invoke(Channels.librarySaveThumbnail, bookId, png),
    updateMeta: (bookId, meta) => invoke(Channels.libraryUpdateMeta, bookId, meta),
    setLiked: (bookId, liked) => invoke(Channels.librarySetLiked, bookId, liked),
    onOpenRequest: (cb) => {
      const listener = (_e: IpcRendererEvent, book: Book): void => cb(book)
      ipcRenderer.on(Channels.libraryOpenRequest, listener)
      return () => ipcRenderer.removeListener(Channels.libraryOpenRequest, listener)
    },
    onChanged: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(Channels.libraryChanged, listener)
      return () => ipcRenderer.removeListener(Channels.libraryChanged, listener)
    },
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  reader: {
    saveProgress: (bookId, page) => invoke(Channels.readerSaveProgress, bookId, page)
  },
  settings: {
    get: () => invoke(Channels.settingsGet),
    set: (partial) => invoke(Channels.settingsSet, partial),
    setApiKey: (p, key) => invoke(Channels.settingsSetApiKey, p, key),
    hasApiKey: (p) => invoke(Channels.settingsHasApiKey, p),
    clearApiKey: (p) => invoke(Channels.settingsClearApiKey, p)
  },
  annotations: {
    listForBook: (bookId) => invoke(Channels.annotationsList, bookId),
    upsertHighlight: (h) => invoke(Channels.annotationsUpsertHighlight, h),
    deleteHighlight: (id) => invoke(Channels.annotationsDeleteHighlight, id),
    upsertNote: (n) => invoke(Channels.annotationsUpsertNote, n),
    deleteNote: (id) => invoke(Channels.annotationsDeleteNote, id),
    setNoteTags: (id, tags) => invoke(Channels.annotationsSetNoteTags, id, tags),
    addInk: (strokes) => invoke(Channels.annotationsAddInk, strokes),
    deleteInk: (ids) => invoke(Channels.annotationsDeleteInk, ids),
    toggleBookmark: (bookId, page, label, id) =>
      invoke(Channels.annotationsToggleBookmark, bookId, page, label, id),
    renameBookmark: (id, label) => invoke(Channels.annotationsRenameBookmark, id, label),
    listAllNotes: () => invoke(Channels.annotationsListAllNotes)
  },
  ai: {
    testKey: (p) => invoke(Channels.aiTestKey, p),
    explain: (id, req) => invoke(Channels.aiExplain, id, req),
    followUp: (id, text) => invoke(Channels.aiFollowUp, id, text),
    cancel: (id) => invoke(Channels.aiCancel, id),
    onToken: (cb) => subscribe(Channels.aiToken, cb),
    onDone: (cb) => subscribe(Channels.aiDone, cb),
    onError: (cb) => subscribe(Channels.aiError, cb)
  },
  app: {
    setUnsaved: (count) => invoke(Channels.appSetUnsaved, count),
    reportError: (message, stack) => invoke(Channels.appReportError, message, stack),
    version: () => invoke(Channels.appVersion),
    checkForUpdates: () => invoke(Channels.appCheckForUpdates),
    installUpdate: () => invoke(Channels.appInstallUpdate),
    openLogs: () => invoke(Channels.appOpenLogs),
    onUpdateAvailable: (cb) => subscribe(Channels.updateAvailable, cb),
    onUpdateDownloaded: (cb) => subscribe(Channels.updateDownloaded, cb)
  },
  export: {
    markdown: (bookId) => invoke(Channels.exportMarkdown, bookId),
    markdownText: (bookId) => invoke(Channels.exportMarkdownText, bookId),
    backup: () => invoke(Channels.exportBackup),
    importBackup: () => invoke(Channels.exportImportBackup),
    openDataFolder: () => invoke(Channels.exportOpenDataFolder)
  },
  web: {
    show: (query, bounds, title) => invoke(Channels.webShow, query, bounds, title),
    reveal: (bounds) => invoke(Channels.webReveal, bounds),
    setBounds: (bounds) => invoke(Channels.webSetBounds, bounds),
    hide: () => invoke(Channels.webHide),
    back: () => invoke(Channels.webBack),
    forward: () => invoke(Channels.webForward),
    reload: () => invoke(Channels.webReload),
    openExternal: () => invoke(Channels.webOpenExternal),
    onState: (cb) => subscribe(Channels.webState, cb)
  },
  lookup: {
    wikipedia: (query, lang) => invoke(Channels.lookupWikipedia, query, lang),
    open: (url, where) => invoke(Channels.lookupOpen, url, where)
  },
  window: {
    fitAspect: (aspect) => invoke(Channels.windowFitAspect, aspect),
    control: (action) => invoke(Channels.windowControl, action),
    getState: () => invoke(Channels.windowGetState),
    onState: (cb) => {
      const listener = (_e: IpcRendererEvent, s: WindowState): void => cb(s)
      ipcRenderer.on(Channels.windowState, listener)
      return () => ipcRenderer.removeListener(Channels.windowState, listener)
    },
    platform: process.platform
  }
}

contextBridge.exposeInMainWorld('api', api)
