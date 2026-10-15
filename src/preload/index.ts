import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { Channels, type Api } from '@shared/ipc'
import type { Book } from '@shared/types'

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api: Api = {
  library: {
    list: () => invoke(Channels.libraryList),
    import: (paths) => invoke(Channels.libraryImport, paths),
    openDialog: () => invoke(Channels.libraryOpenDialog),
    remove: (bookId) => invoke(Channels.libraryRemove, bookId),
    relocate: (bookId) => invoke(Channels.libraryRelocate, bookId),
    getFile: (bookId) => invoke(Channels.libraryGetFile, bookId),
    saveThumbnail: (bookId, png) => invoke(Channels.librarySaveThumbnail, bookId, png),
    updateMeta: (bookId, meta) => invoke(Channels.libraryUpdateMeta, bookId, meta),
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
  }
}

contextBridge.exposeInMainWorld('api', api)
