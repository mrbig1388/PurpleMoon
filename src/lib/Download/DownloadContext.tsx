/* eslint-disable no-console, react-hooks/exhaustive-deps, @typescript-eslint/no-non-null-assertion */
'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { downloadDB } from './download-db';
import {
  buildIndexedDBVideoCacheKey,
  getBrowserStorageEstimate,
  getIndexedDBVideoCacheSize,
  isIndexedDBVideoDownloaded,
  requestIndexedDBVideoPersistentStorage,
} from './indexeddb-video-cache';
import { M3U8Downloader, M3U8DownloadTask } from './m3u8-downloader';
import Toast from './Toast';

interface DownloadContextType {
  downloader: M3U8Downloader;
  tasks: M3U8DownloadTask[];
  addDownloadTask: (
    url: string,
    title: string,
    type?: 'TS' | 'MP4',
    metadata?: {
      source?: string;
      videoId?: string;
      episodeIndex?: number;
    }
  ) => Promise<void>;
  startTask: (taskId: string) => void;
  pauseTask: (taskId: string) => void;
  cancelTask: (taskId: string) => Promise<void>;
  retryFailedSegments: (taskId: string) => void;
  getProgress: (taskId: string) => number;
  downloadingCount: number;
  showDownloadPanel: boolean;
  setShowDownloadPanel: (show: boolean) => void;
}

const DownloadContext = createContext<DownloadContextType | undefined>(
  undefined
);

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<M3U8DownloadTask[]>([]);
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [, setStartingTaskIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const startNextPendingTask = useCallback(
    (currentDownloader: M3U8Downloader) => {
      const maxConcurrentDownloads =
        typeof window !== 'undefined'
          ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
          : 6;

      const allTasks = currentDownloader.getAllTasks();
      const activeCount = allTasks.filter(
        (t) => t.status === 'downloading'
      ).length;

      if (activeCount < maxConcurrentDownloads) {
        const readyTask = allTasks.find((t) => t.status === 'ready');
        if (readyTask) {
          currentDownloader.startTask(readyTask.id);
          setTasks(currentDownloader.getAllTasks());
        }
      }
    },
    []
  );

  const saveTasks = useCallback(async (allTasks: M3U8DownloadTask[]) => {
    if (typeof window === 'undefined') return;

    try {
      const tasksToSave = allTasks
        .filter((task) => {
          if (task.downloadMode === 'browser' && task.status === 'done') {
            return false;
          }
          return true;
        })
        .map((task) => ({
          id: task.id,
          url: task.url,
          title: task.title,
          type: task.type,
          status: task.status,
          finishList: task.finishList,
          downloadIndex: task.downloadIndex,
          finishNum: task.finishNum,
          errorNum: task.errorNum,
          source: task.source,
          videoId: task.videoId,
          episodeIndex: task.episodeIndex,
          downloadMode: task.downloadMode,
          rangeDownload: task.rangeDownload,
          m3u8Content: task.m3u8Content,
          createdAt: task.createdAt || Date.now(),
          segmentLogs: task.segmentLogs,
        }));

      await downloadDB.saveActiveTasks(tasksToSave);
    } catch (error) {
      console.error('保存任务失败:', error);
    }
  }, []);

  const [downloader] = useState(
    () =>
      new M3U8Downloader({
        onProgress: () => {
          const current = downloader.getAllTasks();
          setTasks([...current]);
          saveTasks(current);
        },
        onComplete: async (task) => {
          const current = downloader.getAllTasks();
          setTasks([...current]);

          if (
            (task.downloadMode === 'filesystem' ||
              task.downloadMode === 'indexeddb') &&
            task.source &&
            task.videoId &&
            task.episodeIndex !== undefined
          ) {
            try {
              let fileSize: number | undefined;
              if (
                task.downloadMode === 'filesystem' &&
                task.filesystemDirHandle
              ) {
                try {
                  const sourceDirHandle =
                    await task.filesystemDirHandle.getDirectoryHandle(
                      task.source,
                      { create: false }
                    );
                  const videoIdDirHandle =
                    await sourceDirHandle.getDirectoryHandle(task.videoId, {
                      create: false,
                    });
                  const epDirHandle =
                    await videoIdDirHandle.getDirectoryHandle(
                      `ep${task.episodeIndex + 1}`,
                      { create: false }
                    );

                  let totalSize = 0;
                  const iter = epDirHandle.values();
                  for (;;) {
                    const step = await iter.next();
                    if (step.done) break;
                    const entry = step.value;
                    if (entry.kind === 'file') {
                      const fileHandle = entry as FileSystemFileHandle;
                      const file = await fileHandle.getFile();
                      totalSize += file.size;
                    }
                  }
                  fileSize = totalSize;
                } catch (error) {
                  console.error('计算文件大小失败:', error);
                }
              } else if (task.downloadMode === 'indexeddb') {
                try {
                  const cacheKey =
                    task.indexedDBCacheKey ||
                    buildIndexedDBVideoCacheKey(
                      task.source,
                      task.videoId,
                      task.episodeIndex
                    );
                  fileSize = await getIndexedDBVideoCacheSize(cacheKey);
                } catch (error) {
                  console.error('计算 IndexedDB 缓存大小失败:', error);
                }
              }

              await downloadDB.saveCompletedTask({
                id: task.id,
                title: task.title,
                source: task.source,
                videoId: task.videoId,
                episodeIndex: task.episodeIndex,
                completedAt: Date.now(),
                downloadMode: task.downloadMode,
                fileSize,
              });
            } catch (error) {
              console.error('保存已完成任务失败:', error);
            }
          }

          setToast({
            message: `${task.title} 下载完成！`,
            type: 'success',
          });
          saveTasks(downloader.getAllTasks());
          startNextPendingTask(downloader);
        },
        onError: (_task, error) => {
          console.error('下载错误:', error);
          const current = downloader.getAllTasks();
          setTasks([...current]);
          saveTasks(current);
          startNextPendingTask(downloader);
        },
      })
  );

  // 从 IndexedDB 恢复未完成的任务
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const restoreTasks = async () => {
      try {
        const savedTasks = await downloadDB.getActiveTasks();
        if (!savedTasks || savedTasks.length === 0) return;

        const tasksToDelete: string[] = [];

        for (const savedTask of savedTasks) {
          if (savedTask.downloadMode === 'browser') {
            tasksToDelete.push(savedTask.id);
            continue;
          }

          if (
            (savedTask.downloadMode === 'filesystem' ||
              savedTask.downloadMode === 'indexeddb') &&
            savedTask.status === 'done'
          ) {
            tasksToDelete.push(savedTask.id);
            continue;
          }

          if (
            (savedTask.downloadMode === 'filesystem' ||
              savedTask.downloadMode === 'indexeddb') &&
            (savedTask.status === 'downloading' ||
              savedTask.status === 'pause' ||
              savedTask.status === 'ready')
          ) {
            try {
              const taskId = await downloader.createTask(
                savedTask.url,
                savedTask.title,
                savedTask.type,
                {
                  source: savedTask.source,
                  videoId: savedTask.videoId,
                  episodeIndex: savedTask.episodeIndex,
                }
              );

              const task = downloader.getTask(taskId);
              if (task) {
                task.status =
                  savedTask.status === 'downloading'
                    ? 'pause'
                    : savedTask.status;
                task.finishList = savedTask.finishList;
                task.downloadIndex = savedTask.downloadIndex;
                task.finishNum = savedTask.finishNum;
                task.errorNum = savedTask.errorNum;
                task.downloadMode = savedTask.downloadMode;
                task.rangeDownload = savedTask.rangeDownload;
                task.segmentLogs = savedTask.segmentLogs || [];

                if (
                  savedTask.downloadMode === 'indexeddb' &&
                  savedTask.source &&
                  savedTask.videoId &&
                  savedTask.episodeIndex !== undefined
                ) {
                  task.indexedDBCacheKey = buildIndexedDBVideoCacheKey(
                    savedTask.source,
                    savedTask.videoId,
                    savedTask.episodeIndex
                  );
                }
              }
            } catch (error) {
              console.error('恢复任务失败:', savedTask.title, error);
              tasksToDelete.push(savedTask.id);
            }
          } else {
            tasksToDelete.push(savedTask.id);
          }
        }

        if (tasksToDelete.length > 0) {
          await downloadDB.deleteActiveTasks(tasksToDelete);
        }

        setTasks([...downloader.getAllTasks()]);
      } catch (error) {
        console.error('恢复任务失败:', error);
      }
    };

    restoreTasks();
  }, [downloader]);

  const addDownloadTask = useCallback(
    async (
      url: string,
      title: string,
      type: 'TS' | 'MP4' = 'TS',
      metadata?: {
        source?: string;
        videoId?: string;
        episodeIndex?: number;
      }
    ) => {
      try {
        const downloadMode =
          typeof window !== 'undefined'
            ? (localStorage.getItem('downloadMode') as
                | 'browser'
                | 'filesystem'
                | 'indexeddb') || 'browser'
            : 'browser';

        if (
          downloadMode === 'indexeddb' &&
          typeof window !== 'undefined' &&
          metadata?.source &&
          metadata?.videoId &&
          metadata?.episodeIndex !== undefined
        ) {
          try {
            const alreadyDownloaded = await isIndexedDBVideoDownloaded(
              metadata.source,
              metadata.videoId,
              metadata.episodeIndex
            );

            if (alreadyDownloaded) {
              setToast({
                message: `${title} 已经离线缓存过了，无需重复下载`,
                type: 'info',
              });
              return;
            }

            requestIndexedDBVideoPersistentStorage().catch(() => undefined);

            const estimate = await getBrowserStorageEstimate();
            if (estimate?.quota && estimate?.usage) {
              const freeBytes = estimate.quota - estimate.usage;
              if (freeBytes > 0 && freeBytes < 512 * 1024 * 1024) {
                setToast({
                  message: '浏览器可用存储空间较低，IndexedDB 缓存可能失败',
                  type: 'info',
                });
              }
            }
          } catch (error) {
            console.error('检查 IndexedDB 下载状态失败:', error);
          }
        }

        const taskId = await downloader.createTask(url, title, type, metadata);

        const task = downloader.getTask(taskId);
        if (task) {
          task.downloadMode = downloadMode;
          if (
            downloadMode === 'indexeddb' &&
            metadata?.source &&
            metadata?.videoId &&
            metadata?.episodeIndex !== undefined
          ) {
            task.indexedDBCacheKey = buildIndexedDBVideoCacheKey(
              metadata.source,
              metadata.videoId,
              metadata.episodeIndex
            );
          }
        }

        setTasks([...downloader.getAllTasks()]);

        const maxConcurrentDownloads =
          typeof window !== 'undefined'
            ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
            : 6;

        setStartingTaskIds((prev) => {
          const allTasks = downloader.getAllTasks();
          const currentDownloadingCount = allTasks.filter(
            (t) => t.status === 'downloading'
          ).length;
          const totalActiveCount = currentDownloadingCount + prev.size;

          if (totalActiveCount < maxConcurrentDownloads) {
            const newSet = new Set(prev);
            newSet.add(taskId);

            downloader.startTask(taskId).then(() => {
              setTasks([...downloader.getAllTasks()]);
              setStartingTaskIds((current) => {
                const updated = new Set(current);
                updated.delete(taskId);
                return updated;
              });
            });

            return newSet;
          }

          return prev;
        });
      } catch (error) {
        console.error('添加下载任务失败:', error);
        throw error;
      }
    },
    [downloader]
  );

  const startTask = useCallback(
    (taskId: string) => {
      const maxConcurrentDownloads =
        typeof window !== 'undefined'
          ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
          : 6;

      const currentDownloadingCount = downloader
        .getAllTasks()
        .filter((t) => t.status === 'downloading').length;

      if (currentDownloadingCount < maxConcurrentDownloads) {
        downloader.startTask(taskId);
        setTasks([...downloader.getAllTasks()]);
      }
    },
    [downloader]
  );

  const pauseTask = useCallback(
    (taskId: string) => {
      downloader.pauseTask(taskId);
      setTasks([...downloader.getAllTasks()]);
      startNextPendingTask(downloader);
    },
    [downloader, startNextPendingTask]
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      await downloader.cancelTask(taskId);
      setTasks([...downloader.getAllTasks()]);
      saveTasks(downloader.getAllTasks());
      startNextPendingTask(downloader);
    },
    [downloader, startNextPendingTask, saveTasks]
  );

  const retryFailedSegments = useCallback(
    (taskId: string) => {
      downloader.retryFailedSegments(taskId);
      setTasks([...downloader.getAllTasks()]);
    },
    [downloader]
  );

  const getProgress = useCallback(
    (taskId: string) => {
      return downloader.getProgress(taskId);
    },
    [downloader]
  );

  const downloadingCount = tasks.filter(
    (t) => t.status === 'downloading'
  ).length;

  return (
    <DownloadContext.Provider
      value={{
        downloader,
        tasks,
        addDownloadTask,
        startTask,
        pauseTask,
        cancelTask,
        retryFailedSegments,
        getProgress,
        downloadingCount,
        showDownloadPanel,
        setShowDownloadPanel,
      }}
    >
      {children}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </DownloadContext.Provider>
  );
}

export function useDownload() {
  const context = useContext(DownloadContext);
  if (context === undefined) {
    throw new Error('useDownload must be used within a DownloadProvider');
  }
  return context;
}
