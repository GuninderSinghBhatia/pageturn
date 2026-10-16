import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { Channels, type Api } from '@shared/ipc'
import type { Book } from '@shared/types'

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

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
    set: (partial) => invoke(Channels.settingsSet, partial)
  },
  annotations: {
    listForBook: (bookId) => invoke(Channels.annotationsList, bookId),
    upsertHighlight: (h) => invoke(Channels.annotationsUpsertHighlight, h),
    deleteHighlight: (id) => invoke(Channels.annotationsDeleteHighlight, id),
    upsertNote: (n) => invoke(Channels.annotationsUpsertNote, n),
    deleteNote: (id) => invoke(Channels.annotationsDeleteNote, id),
    addInk: (strokes) => invoke(Channels.annotationsAddInk, strokes),
    deleteInk: (ids) => invoke(Channels.annotationsDeleteInk, ids),
    toggleBookmark: (bookId, page, label, id) =>
      invoke(Channels.annotationsToggleBookmark, bookId, page, label, id),
    renameBookmark: (id, label) => invoke(Channels.annotationsRenameBookmark, id, label),
    listAllNotes: () => invoke(Channels.annotationsListAllNotes)
  },
  window: {
    fitAspect: (aspect) => invoke(Channels.windowFitAspect, aspect),
    setTitleBar: (colors) => invoke(Channels.windowSetTitleBar, colors)
  }
}

contextBridge.exposeInMainWorld('api', api)
