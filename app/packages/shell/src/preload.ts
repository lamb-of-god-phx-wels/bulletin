import { contextBridge, ipcRenderer } from "electron";
import { M4_PRELOAD_GLOBAL, createM4PreloadApi } from "./ipc/preloadApi.js";

const bridge = createM4PreloadApi({
  invoke: (channel, request) => ipcRenderer.invoke(channel, request) as Promise<unknown>,
});

contextBridge.exposeInMainWorld(M4_PRELOAD_GLOBAL, bridge);
