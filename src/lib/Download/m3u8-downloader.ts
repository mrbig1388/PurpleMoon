/* eslint-disable no-console, @typescript-eslint/no-non-null-assertion */
/**
 * M3U8 视频分片下载器核心逻辑
 * 支持主播放列表最高画质自动优选、内置 M3U8 切片去广告、AES-128 解密、多线程并发分片拉取、自动重试与实时分片日志
 */

import { getCustomFingerprints } from '@/lib/ad-learn';
import { filterAdsFromM3U8 } from '@/lib/m3u8-ad-filter';

import { AESDecryptor } from './aes-decryptor';
import {
  buildIndexedDBVideoCacheKey,
  deleteIndexedDBVideoCache,
  getIndexedDBVideoCacheSize,
  saveIndexedDBVideoManifest,
  saveIndexedDBVideoSegment,
} from './indexeddb-video-cache';

export type M3U8SegmentLogStatus =
  | 'queued'
  | 'downloading'
  | 'success'
  | 'retry'
  | 'error'
  | 'timeout'
  | 'aborted';

export interface M3U8SegmentLog {
  id: string;
  index: number;
  status: M3U8SegmentLogStatus;
  message: string;
  timestamp: number;
  retryCount?: number;
  durationMs?: number;
  httpStatus?: number;
}

export interface M3U8DownloadTask {
  id: string;
  url: string;
  title: string;
  type: 'TS' | 'MP4';
  status: 'ready' | 'downloading' | 'pause' | 'done' | 'error';
  finishList: Array<{
    title: string;
    status: '' | 'is-downloading' | 'is-success' | 'is-error';
    retryCount?: number;
  }>;
  tsUrlList: string[];
  requests: XMLHttpRequest[];
  mediaFileList: ArrayBuffer[];
  downloadIndex: number;
  downloading: boolean;
  durationSecond: number;
  beginTime: Date;
  errorNum: number;
  finishNum: number;
  retryNum: number;
  retryCountdown: number;
  rangeDownload: {
    isShowRange: boolean;
    startSegment: number;
    endSegment: number;
    targetSegment: number;
  };
  aesConf: {
    method: string;
    uri: string;
    iv: Uint8Array | null;
    key: ArrayBuffer | null;
    decryption: AESDecryptor | null;
  };
  downloadMode?: 'browser' | 'filesystem' | 'indexeddb';
  filesystemDirHandle?: FileSystemDirectoryHandle;
  indexedDBCacheKey?: string;
  m3u8Content?: string;
  source?: string;
  videoId?: string;
  episodeIndex?: number;
  createdAt?: number;
  segmentLogs: M3U8SegmentLog[];
}

export interface M3U8DownloaderOptions {
  onProgress?: (task: M3U8DownloadTask) => void;
  onComplete?: (task: M3U8DownloadTask) => void;
  onError?: (task: M3U8DownloadTask, error: string) => void;
}

export class M3U8Downloader {
  private tasks: Map<string, M3U8DownloadTask> = new Map();
  private currentTask: M3U8DownloadTask | null = null;
  private options: M3U8DownloaderOptions;

  constructor(options: M3U8DownloaderOptions = {}) {
    this.options = options;
  }

  private addSegmentLog(
    task: M3U8DownloadTask,
    log: Omit<M3U8SegmentLog, 'id' | 'timestamp'>
  ): void {
    task.segmentLogs.push({
      ...log,
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    });

    if (task.segmentLogs.length > 1000) {
      task.segmentLogs = task.segmentLogs.slice(-1000);
    }

    this.options.onProgress?.(task);
  }

  /**
   * 创建下载任务
   */
  async createTask(
    url: string,
    title: string,
    type: 'TS' | 'MP4' = 'TS',
    metadata?: {
      source?: string;
      videoId?: string;
      episodeIndex?: number;
    }
  ): Promise<string> {
    const taskId = 't_' + Date.now() + Math.random().toString(36).slice(2, 11);

    try {
      const m3u8Content = await this.fetchM3U8(url);

      if (!m3u8Content.trim().startsWith('#EXTM3U')) {
        throw new Error('无效的 m3u8 链接');
      }

      if (this.isMasterPlaylist(m3u8Content)) {
        const streams = this.parseStreamInfo(m3u8Content, url);
        if (streams.length > 0) {
          url = streams[0].url;
          const subM3u8Content = await this.fetchM3U8(url);
          return this.processM3U8Content(
            taskId,
            url,
            title,
            type,
            subM3u8Content,
            metadata
          );
        }
      }

      return this.processM3U8Content(
        taskId,
        url,
        title,
        type,
        m3u8Content,
        metadata
      );
    } catch (error) {
      throw new Error(`创建任务失败: ${error}`);
    }
  }

  /**
   * 处理 M3U8 内容（集成 PurpleMoon 内置 M3U8 切片去广告过滤）
   */
  private processM3U8Content(
    taskId: string,
    url: string,
    title: string,
    type: 'TS' | 'MP4',
    rawM3u8Content: string,
    metadata?: {
      source?: string;
      videoId?: string;
      episodeIndex?: number;
    }
  ): string {
    let m3u8Content = rawM3u8Content;
    if (typeof window !== 'undefined') {
      try {
        const blockAdEnabled =
          localStorage.getItem('enable_blockad') !== 'false';
        if (blockAdEnabled) {
          const filtered = filterAdsFromM3U8(m3u8Content, {
            baseUrl: url,
            extraFingerprints: getCustomFingerprints(
              process.env.NEXT_PUBLIC_AD_FINGERPRINTS
            ),
          });
          m3u8Content = filtered.cleanContent ?? filtered.content;
        }
      } catch (e) {
        console.warn('下载任务 M3U8 去广告过滤异常，回退原始播放列表:', e);
      }
    }

    const task: M3U8DownloadTask = {
      id: taskId,
      url,
      title,
      type,
      status: 'ready',
      finishList: [],
      tsUrlList: [],
      requests: [],
      mediaFileList: [],
      downloadIndex: 0,
      downloading: false,
      durationSecond: 0,
      beginTime: new Date(),
      errorNum: 0,
      finishNum: 0,
      retryNum: 3,
      retryCountdown: 0,
      rangeDownload: {
        isShowRange: false,
        startSegment: 0,
        endSegment: 0,
        targetSegment: 0,
      },
      aesConf: {
        method: '',
        uri: '',
        iv: null,
        key: null,
        decryption: null,
      },
      m3u8Content,
      source: metadata?.source,
      videoId: metadata?.videoId,
      episodeIndex: metadata?.episodeIndex,
      createdAt: Date.now(),
      segmentLogs: [],
    };

    const lines = m3u8Content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        const duration = parseFloat(line.split('#EXTINF:')[1]);
        if (!Number.isNaN(duration)) {
          task.durationSecond += duration;
        }
      } else if (line.startsWith('#EXT-X-KEY')) {
        const keyMatch = line.match(
          /METHOD=([^,]+)(?:,URI="([^"]+)")?(?:,IV=([^,]+))?/
        );
        if (keyMatch) {
          task.aesConf.method = keyMatch[1];
          task.aesConf.uri = keyMatch[2]
            ? this.applyURL(keyMatch[2], url)
            : '';
          task.aesConf.iv = keyMatch[3] ? this.parseIV(keyMatch[3]) : null;
        }
      } else if (line && !line.startsWith('#')) {
        task.tsUrlList.push(this.applyURL(line, url));
        task.finishList.push({ title: line, status: '' });
      }
    }

    task.rangeDownload.endSegment = task.tsUrlList.length;
    task.rangeDownload.targetSegment = task.tsUrlList.length;

    this.tasks.set(taskId, task);
    return taskId;
  }

  /**
   * 开始下载任务
   */
  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error('任务不存在');
    }

    if (task.status === 'downloading') {
      return;
    }

    if (
      task.aesConf.method &&
      task.aesConf.method !== 'NONE' &&
      !task.aesConf.key
    ) {
      await this.getAESKey(task);
    }

    if (task.status === 'ready' || task.status === 'pause') {
      let firstIncompleteIndex = 0;
      for (let i = 0; i < task.finishList.length; i++) {
        if (task.finishList[i].status !== 'is-success') {
          firstIncompleteIndex = i;
          break;
        }
      }
      task.downloadIndex = firstIncompleteIndex;
    }

    task.status = 'downloading';
    this.currentTask = task;
    this.downloadTS(task);
  }

  /**
   * 暂停任务
   */
  pauseTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'pause';
    this.abortRequests(task);
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    this.abortRequests(task);

    if (
      task.downloadMode === 'filesystem' &&
      task.status !== 'done' &&
      task.filesystemDirHandle
    ) {
      await this.deleteFilesystemTask(task);
    }

    if (task.downloadMode === 'indexeddb' && task.status !== 'done') {
      await this.deleteIndexedDBTask(task);
    }

    task.mediaFileList = [];
    this.tasks.delete(taskId);

    if (this.currentTask?.id === taskId) {
      this.currentTask = null;
    }
  }

  private async deleteFilesystemTask(task: M3U8DownloadTask): Promise<void> {
    if (
      !task.filesystemDirHandle ||
      !task.source ||
      !task.videoId ||
      task.episodeIndex === undefined
    ) {
      return;
    }

    try {
      const sourceDirHandle =
        await task.filesystemDirHandle.getDirectoryHandle(task.source, {
          create: false,
        });
      const videoIdDirHandle = await sourceDirHandle.getDirectoryHandle(
        task.videoId,
        { create: false }
      );
      const epDirName = `ep${task.episodeIndex + 1}`;
      await videoIdDirHandle.removeEntry(epDirName, { recursive: true });
    } catch (error) {
      console.warn('删除文件失败（可能目录不存在）:', error);
    }
  }

  private async deleteIndexedDBTask(task: M3U8DownloadTask): Promise<void> {
    const cacheKey = this.getIndexedDBCacheKey(task);
    if (!cacheKey) return;

    try {
      await deleteIndexedDBVideoCache(cacheKey);
    } catch (error) {
      console.warn('删除 IndexedDB 视频缓存失败:', error);
    }
  }

  getTask(taskId: string): M3U8DownloadTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): M3U8DownloadTask[] {
    return Array.from(this.tasks.values());
  }

  getProgress(taskId: string): number {
    const task = this.tasks.get(taskId);
    if (!task) return 0;

    if (task.rangeDownload.targetSegment === 0) return 0;
    return (task.finishNum / task.rangeDownload.targetSegment) * 100;
  }

  /**
   * 重试所有失败的片段
   */
  retryFailedSegments(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    let hasError = false;
    task.finishList.forEach((item) => {
      if (item.status === 'is-error') {
        item.status = '';
        item.retryCount = 0;
        hasError = true;
      }
    });

    if (hasError) {
      task.errorNum = 0;
      task.status = 'downloading';

      let firstErrorIndex = task.rangeDownload.endSegment;
      for (
        let i = task.rangeDownload.startSegment;
        i < task.rangeDownload.endSegment;
        i++
      ) {
        if (task.finishList[i] && task.finishList[i].status === '') {
          firstErrorIndex = Math.min(firstErrorIndex, i);
        }
      }

      task.downloadIndex = firstErrorIndex;
      this.downloadTS(task);
    }
  }

  /**
   * 并发下载 TS 片段
   */
  private downloadTS(task: M3U8DownloadTask): void {
    const maxRetries = 3;
    const segmentTimeout =
      typeof window !== 'undefined'
        ? Number(localStorage.getItem('downloadSegmentTimeout') || 30000)
        : 30000;

    const cleanupRequest = (xhr: XMLHttpRequest) => {
      const requestIndex = task.requests.indexOf(xhr);
      if (requestIndex >= 0) {
        task.requests.splice(requestIndex, 1);
      }
    };

    const checkAllSegmentsHandled = () => {
      if (
        task.finishNum + task.errorNum === task.rangeDownload.targetSegment &&
        task.errorNum > 0
      ) {
        task.status = 'pause';
        this.options.onError?.(
          task,
          `下载完成，但有 ${task.errorNum} 个片段失败`
        );
      }
    };

    const downloadSegment = (index: number, onSettled: () => void) => {
      if (task.status === 'pause') {
        return;
      }

      if (!task.finishList[index] || task.finishList[index].status !== '') {
        onSettled();
        return;
      }

      task.finishList[index].status = 'is-downloading';
      if (!task.finishList[index].retryCount) {
        task.finishList[index].retryCount = 0;
      }
      const startTime = Date.now();
      this.addSegmentLog(task, {
        index,
        status: 'downloading',
        message: `开始下载分片 ${index + 1}`,
        retryCount: task.finishList[index].retryCount,
      });

      const xhr = new XMLHttpRequest();
      let settled = false;

      const handleFailure = (
        reason: string,
        status: M3U8SegmentLogStatus = 'error',
        httpStatus?: number
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupRequest(xhr);

        if (task.status === 'pause') {
          return;
        }

        const currentRetry = task.finishList[index].retryCount || 0;

        if (currentRetry < maxRetries) {
          task.finishList[index].retryCount = currentRetry + 1;
          task.finishList[index].status = '';
          this.addSegmentLog(task, {
            index,
            status: 'retry',
            message: `${reason}，准备第 ${currentRetry + 1}/${maxRetries} 次重试`,
            retryCount: currentRetry + 1,
            durationMs: Date.now() - startTime,
            httpStatus,
          });

          setTimeout(() => {
            if (task.status !== 'pause') {
              downloadSegment(index, onSettled);
            }
          }, 1000 * (currentRetry + 1));
        } else {
          task.errorNum++;
          task.finishList[index].status = 'is-error';
          this.addSegmentLog(task, {
            index,
            status,
            message: `${reason}，重试次数已用尽`,
            retryCount: currentRetry,
            durationMs: Date.now() - startTime,
            httpStatus,
          });
          this.options.onError?.(
            task,
            `片段 ${index + 1} ${reason}（已重试 ${maxRetries} 次）`
          );
          checkAllSegmentsHandled();
          onSettled();
        }
      };

      xhr.responseType = 'arraybuffer';
      xhr.timeout =
        Number.isFinite(segmentTimeout) && segmentTimeout > 0
          ? segmentTimeout
          : 30000;
      xhr.onload = () => {
        if (settled) {
          return;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          settled = true;
          cleanupRequest(xhr);
          this.dealTS(task, xhr.response, index, () => {
            if (task.finishList[index]?.status === 'is-success') {
              this.addSegmentLog(task, {
                index,
                status: 'success',
                message: `分片 ${index + 1} 下载完成`,
                retryCount: task.finishList[index].retryCount || 0,
                durationMs: Date.now() - startTime,
                httpStatus: xhr.status,
              });
            }
            onSettled();
          });
        } else {
          handleFailure(`下载失败 HTTP ${xhr.status}`, 'error', xhr.status);
        }
      };
      xhr.onerror = () => handleFailure('网络错误', 'error');
      xhr.ontimeout = () =>
        handleFailure(`下载超时（${xhr.timeout}ms）`, 'timeout');
      xhr.onabort = () => handleFailure('请求中止', 'aborted');

      xhr.open('GET', task.tsUrlList[index], true);
      xhr.send();
      task.requests.push(xhr);
    };

    const download = () => {
      const isPause = task.status === 'pause';
      const index = task.downloadIndex;

      if (index >= task.rangeDownload.endSegment || isPause) {
        return;
      }

      task.downloadIndex++;

      if (task.finishList[index] && task.finishList[index].status === '') {
        downloadSegment(index, () => {
          if (
            task.downloadIndex < task.rangeDownload.endSegment &&
            task.status !== 'pause'
          ) {
            download();
          }
        });
      } else if (task.downloadIndex < task.rangeDownload.endSegment) {
        if (!isPause) download();
      }
    };

    const threadsPerTask =
      typeof window !== 'undefined'
        ? Number(localStorage.getItem('downloadThreadsPerTask') || 6)
        : 6;

    const concurrency = Math.min(
      threadsPerTask,
      task.rangeDownload.targetSegment - task.finishNum
    );
    for (let i = 0; i < concurrency; i++) {
      download();
    }
  }

  private dealTS(
    task: M3U8DownloadTask,
    file: ArrayBuffer,
    index: number,
    callback: () => void
  ): void {
    const data = task.aesConf.key ? this.aesDecrypt(task, file, index) : file;

    this.saveProcessedSegment(task, data, index)
      .then(() => this.markSegmentSuccess(task, index))
      .then(() => callback())
      .catch((error) => {
        console.error('保存分片失败:', error);
        task.finishList[index].status = 'is-error';
        task.errorNum++;
        this.options.onError?.(task, `保存分片 ${index + 1} 失败: ${error}`);
        callback();
      });
  }

  private async saveProcessedSegment(
    task: M3U8DownloadTask,
    data: ArrayBuffer,
    index: number
  ): Promise<void> {
    if (task.downloadMode === 'filesystem') {
      await this.saveSegmentToFilesystem(task, data, index);
      return;
    }

    if (task.downloadMode === 'indexeddb') {
      await this.saveSegmentToIndexedDB(task, data, index);
      return;
    }

    task.mediaFileList[index] = data;
  }

  private async markSegmentSuccess(
    task: M3U8DownloadTask,
    index: number
  ): Promise<void> {
    task.finishList[index].status = 'is-success';
    task.finishNum++;

    this.options.onProgress?.(task);

    if (task.finishNum !== task.rangeDownload.targetSegment) {
      return;
    }

    if (task.downloadMode === 'filesystem') {
      await this.generateLocalPlaylist(task);
    } else if (task.downloadMode === 'indexeddb') {
      await this.generateIndexedDBPlaylist(task);
    } else {
      this.downloadFile(task);
    }

    task.status = 'done';
    this.options.onComplete?.(task);
  }

  private downloadFile(task: M3U8DownloadTask): void {
    const validSegments = task.mediaFileList.filter(Boolean);
    const fileBlob = new Blob(validSegments, {
      type: task.type === 'MP4' ? 'video/mp4' : 'video/MP2T',
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(fileBlob);
    a.download = `${task.title}.${task.type === 'MP4' ? 'mp4' : 'ts'}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    // 释放内存缓冲
    task.mediaFileList = [];
  }

  private async fetchM3U8(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText);
          } else {
            reject(new Error(`HTTP ${xhr.status}`));
          }
        }
      };
      xhr.onerror = () => reject(new Error('网络请求失败'));
      xhr.open('GET', url, true);
      xhr.send();
    });
  }

  private isMasterPlaylist(m3u8Str: string): boolean {
    return m3u8Str.includes('#EXT-X-STREAM-INF');
  }

  private parseStreamInfo(
    m3u8Str: string,
    baseUrl: string
  ): Array<{
    url: string;
    bandwidth: number;
    resolution: string;
    name: string;
  }> {
    const streams: Array<{
      url: string;
      bandwidth: number;
      resolution: string;
      name: string;
    }> = [];
    const lines = m3u8Str.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bandwidth = line.match(/BANDWIDTH=(\d+)/)?.[1] || '';
        const resolution = line.match(/RESOLUTION=([^\s,]+)/)?.[1] || '';
        const name = line.match(/NAME="([^"]+)"/)?.[1] || '';

        if (i + 1 < lines.length) {
          const nextUrl = lines[i + 1].trim();
          if (nextUrl && !nextUrl.startsWith('#')) {
            streams.push({
              url: this.applyURL(nextUrl, baseUrl),
              bandwidth: parseInt(bandwidth, 10) || 0,
              resolution: resolution || 'Unknown',
              name:
                name ||
                `${resolution || ''} ${
                  bandwidth ? parseInt(bandwidth, 10) / 1000 + 'kbps' : 'Unknown'
                }`,
            });
            i++;
          }
        }
      }
    }

    streams.sort((a, b) => b.bandwidth - a.bandwidth);
    return streams;
  }

  private applyURL(targetURL: string, baseURL: string): string {
    if (targetURL.indexOf('http') === 0) {
      if (targetURL.includes('0.0.0.0') && typeof window !== 'undefined') {
        const currentOrigin = `${window.location.protocol}//${window.location.host}`;
        return targetURL.replace(/https?:\/\/0\.0\.0\.0:\d+/, currentOrigin);
      }
      return targetURL;
    } else if (targetURL[0] === '/') {
      const domain = baseURL.split('/');
      let origin = domain[0] + '//' + domain[2];
      if (origin.includes('0.0.0.0') && typeof window !== 'undefined') {
        origin = `${window.location.protocol}//${window.location.host}`;
      }
      return origin + targetURL;
    } else {
      const domain = baseURL.split('/');
      domain.pop();
      let result = domain.join('/') + '/' + targetURL;
      if (result.includes('0.0.0.0') && typeof window !== 'undefined') {
        const currentOrigin = `${window.location.protocol}//${window.location.host}`;
        result = result.replace(/https?:\/\/0\.0\.0\.0:\d+/, currentOrigin);
      }
      return result;
    }
  }

  private parseIV(ivString: string): Uint8Array {
    const hex = ivString.replace(/^0x/, '');
    return new Uint8Array(
      hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );
  }

  private async getAESKey(task: M3U8DownloadTask): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.responseType = 'arraybuffer';
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) {
            task.aesConf.key = xhr.response;
            if (task.aesConf.key) {
              task.aesConf.decryption = new AESDecryptor();
              task.aesConf.decryption.expandKey(task.aesConf.key);
            }
            resolve();
          } else {
            reject(new Error('获取 AES 密钥失败'));
          }
        }
      };
      xhr.onerror = () => reject(new Error('获取 AES 密钥网络错误'));
      xhr.open('GET', task.aesConf.uri, true);
      xhr.send();
    });
  }

  private aesDecrypt(
    task: M3U8DownloadTask,
    data: ArrayBuffer,
    index: number
  ): ArrayBuffer {
    if (!task.aesConf.decryption || !task.aesConf.key) {
      return data;
    }

    let iv: Uint8Array;
    if (task.aesConf.iv) {
      iv = task.aesConf.iv;
    } else {
      iv = new Uint8Array(16);
      for (let i = 12; i < 16; i++) {
        iv[i] = (index >> (8 * (15 - i))) & 0xff;
      }
    }

    try {
      return task.aesConf.decryption.decrypt(
        data,
        0,
        iv.buffer as ArrayBuffer,
        true
      );
    } catch (error) {
      console.error('AES 解密失败:', error);
      return data;
    }
  }

  private abortRequests(task: M3U8DownloadTask): void {
    task.requests.forEach((xhr) => {
      if (xhr.readyState !== 4) {
        xhr.abort();
      }
    });
    task.requests = [];
  }

  private getIndexedDBCacheKey(task: M3U8DownloadTask): string | null {
    if (task.indexedDBCacheKey) {
      return task.indexedDBCacheKey;
    }

    if (task.source && task.videoId && task.episodeIndex !== undefined) {
      task.indexedDBCacheKey = buildIndexedDBVideoCacheKey(
        task.source,
        task.videoId,
        task.episodeIndex
      );
      return task.indexedDBCacheKey;
    }

    task.indexedDBCacheKey = `task::${task.id}`;
    return task.indexedDBCacheKey;
  }

  private async saveSegmentToIndexedDB(
    task: M3U8DownloadTask,
    data: ArrayBuffer,
    index: number
  ): Promise<void> {
    const cacheKey = this.getIndexedDBCacheKey(task);
    if (!cacheKey) {
      throw new Error('无法生成 IndexedDB 视频缓存 Key');
    }

    await saveIndexedDBVideoSegment({
      cacheKey,
      index,
      data,
      mimeType: task.type === 'MP4' ? 'video/mp4' : 'video/MP2T',
    });
  }

  private async saveSegmentToFilesystem(
    task: M3U8DownloadTask,
    data: ArrayBuffer,
    index: number
  ): Promise<void> {
    if (!task.filesystemDirHandle) {
      throw new Error('未选择保存目录');
    }

    let targetDirHandle = task.filesystemDirHandle;

    if (task.source && task.videoId && task.episodeIndex !== undefined) {
      const sourceDirHandle =
        await task.filesystemDirHandle.getDirectoryHandle(task.source, {
          create: true,
        });
      const videoIdDirHandle = await sourceDirHandle.getDirectoryHandle(
        task.videoId,
        { create: true }
      );
      const epDirHandle = await videoIdDirHandle.getDirectoryHandle(
        `ep${task.episodeIndex + 1}`,
        { create: true }
      );
      targetDirHandle = epDirHandle;
    }

    const filename = `segment_${index.toString().padStart(5, '0')}.ts`;
    const fileHandle = await targetDirHandle.getFileHandle(filename, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  private async generateLocalPlaylist(task: M3U8DownloadTask): Promise<void> {
    if (!task.filesystemDirHandle || !task.m3u8Content) {
      return;
    }

    let targetDirHandle = task.filesystemDirHandle;

    if (task.source && task.videoId && task.episodeIndex !== undefined) {
      try {
        const sourceDirHandle =
          await task.filesystemDirHandle.getDirectoryHandle(task.source, {
            create: false,
          });
        const videoIdDirHandle = await sourceDirHandle.getDirectoryHandle(
          task.videoId,
          { create: false }
        );
        const epDirHandle = await videoIdDirHandle.getDirectoryHandle(
          `ep${task.episodeIndex + 1}`,
          { create: false }
        );
        targetDirHandle = epDirHandle;
      } catch (error) {
        console.error('获取子目录失败:', error);
        return;
      }
    }

    try {
      const lines = task.m3u8Content.split('\n');
      const modifiedLines: string[] = [];
      let segmentIndex = task.rangeDownload.startSegment;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // 已在下载时完成 AES 解密，因此本地播放列表不再保留 EXT-X-KEY
        if (
          trimmedLine.startsWith('#EXT-X-KEY:') &&
          task.aesConf.method &&
          task.aesConf.method !== 'NONE'
        ) {
          continue;
        } else if (trimmedLine && !trimmedLine.startsWith('#')) {
          if (segmentIndex < task.rangeDownload.endSegment) {
            const indent = line.match(/^\s*/)?.[0] || '';
            const filename = `segment_${segmentIndex
              .toString()
              .padStart(5, '0')}.ts`;
            modifiedLines.push(indent + filename);
            segmentIndex++;
          } else {
            modifiedLines.push(line);
          }
        } else {
          modifiedLines.push(line);
        }
      }

      const playlistContent = modifiedLines.join('\n');
      const fileHandle = await targetDirHandle.getFileHandle('playlist.m3u8', {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(playlistContent);
      await writable.close();
    } catch (error) {
      console.error('生成播放列表失败:', error);
    }
  }

  private async generateIndexedDBPlaylist(
    task: M3U8DownloadTask
  ): Promise<void> {
    const cacheKey = this.getIndexedDBCacheKey(task);
    if (!cacheKey || !task.m3u8Content) {
      throw new Error('无法生成 IndexedDB 播放列表：缺少缓存 Key 或 M3U8 内容');
    }

    if (!task.source || !task.videoId || task.episodeIndex === undefined) {
      throw new Error('无法生成 IndexedDB 播放列表：缺少视频标识信息');
    }

    const lines = task.m3u8Content.split('\n');
    const modifiedLines: string[] = [];
    let segmentIndex = task.rangeDownload.startSegment;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (
        trimmedLine.startsWith('#EXT-X-KEY:') &&
        task.aesConf.method &&
        task.aesConf.method !== 'NONE'
      ) {
        continue;
      }

      if (trimmedLine && !trimmedLine.startsWith('#')) {
        if (segmentIndex < task.rangeDownload.endSegment) {
          const indent = line.match(/^\s*/)?.[0] || '';
          const filename = `segment_${segmentIndex
            .toString()
            .padStart(5, '0')}.ts`;
          modifiedLines.push(indent + filename);
          segmentIndex++;
        } else {
          modifiedLines.push(line);
        }
      } else {
        modifiedLines.push(line);
      }
    }

    const totalSize = await getIndexedDBVideoCacheSize(cacheKey);
    await saveIndexedDBVideoManifest({
      cacheKey,
      source: task.source,
      videoId: task.videoId,
      episodeIndex: task.episodeIndex,
      title: task.title,
      playlistContent: modifiedLines.join('\n'),
      m3u8Content: task.m3u8Content,
      segmentCount: task.rangeDownload.targetSegment,
      completed: true,
      mimeType: task.type === 'MP4' ? 'video/mp4' : 'video/MP2T',
      totalSize,
    });
  }
}
