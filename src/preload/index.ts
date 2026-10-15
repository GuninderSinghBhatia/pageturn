import { contextBridge } from 'electron'

// The full typed Api (src/shared/ipc.ts) is exposed here from Task 4 onward.
const api = {}

contextBridge.exposeInMainWorld('api', api)
