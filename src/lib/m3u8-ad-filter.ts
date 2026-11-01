/**
 * m3u8 广告分片过滤（纯函数，无副作用，可单元测试）
 *
 * 识别顺序（命中任意一种就不再往下走，宁可漏过，也不误杀）：
 *  1. 分片特征：域名 + 目录 + 文件名模板。时长占比最大的特征视为正片；
 *     特征不同、足够短、占比足够小的段视为广告并整段删除。
 *  2. 广告指纹：同一个资源站往往给不同影片插入“同一支广告片”，它的“分片时长序列”是固定的
 *     （实测：同一站 3 部不同影片里的广告，时长序列逐片完全相同）。命中内置 / 自定义指纹即删除。
 *  3. 兜底结构规则（广告与正片同域名同目录同命名时才用）：B 标记少的列表 / D 定长分块 /
 *     E 帧率不一致 / F 孤立的整齐块。
 *
 * 任何不确定的情况都原样返回。
 */

export interface AdFilterOptions {
  /** 播放列表自身的 URL，用于把相对路径补全后再比较特征 */
  baseUrl?: string;
  /** 正片特征的最低时长占比，低于此值视为找不到明确正片 */
  minMainShare?: number;
  /** 单个广告段最长秒数 */
  maxAdSeconds?: number;
  /** 单个广告段占总时长的上限 */
  maxAdShare?: number;
  /** 预计删除总量占总时长的上限，超过则整条不过滤 */
  maxTotalRemovedShare?: number;
  /** 额外的广告关键词（域名或路径片段，不区分大小写） */
  extraPatterns?: string[];
  /** 额外的广告指纹：每项是一支广告的“分片时长序列”（秒），可由 parseAdFingerprints 解析环境变量得到 */
  extraFingerprints?: number[][];
}

export interface AdFilterResult {
  content: string;
  removedSegments: number;
  removedSeconds: number;
  /** 命中的识别方式，便于调试：signature / fingerprint / B / D / E / F */
  method?: string;
  /** 未过滤时的原因，便于调试 */
  skippedReason?: string;
}

const DEFAULTS = {
  minMainShare: 0.6,
  maxAdSeconds: 90,
  maxAdShare: 0.1,
  maxTotalRemovedShare: 0.12,
};

// 内置的常见广告路径关键词，只用于“非正片特征”的段，不会单独造成误删
export const DEFAULT_AD_PATTERNS = ['adjump', '/ads/', '/ad/', 'advert'];

/**
 * 内置广告指纹（每项 = 一支广告片的分片时长序列，单位秒）。
 * 全部来自真实播放列表：同一支广告在同一资源站的不同影片里时长序列完全一致。
 * 只收“不是全部等长”的序列；全部等长（如 5×4.000）太容易与正片的静止画面混淆，改由规则 F 处理。
 */
export const DEFAULT_AD_FINGERPRINTS: { name: string; durations: number[] }[] = [
  { name: '爱奇艺源（3 部影片一致）', durations: [4, 4, 4, 4, 1.566667] },
  { name: '电影天堂源 A（3 部影片一致）', durations: [5.567, 2.933, 5.7, 3.333, 1.533] },
  { name: '电影天堂源 B', durations: [4.867, 3.333, 6.367, 2.1, 2.967] },
  { name: '电影天堂源 C（整块 20 秒）', durations: [4, 5, 4, 4.24, 2.76] },
  { name: '魔都源（同一列表出现两次）', durations: [3, 3, 5, 3, 3, 0.64] },
];

/**
 * 解析自定义指纹文本：多支广告之间用 ; 或 | 或换行分隔，同一支广告的各分片时长用逗号 / 空格 / 斜杠分隔。
 * 例：`5.567,2.933,5.700,3.333,1.533;4,5,4,4.24,2.76`
 */
export function parseAdFingerprints(text?: string | null): number[][] {
  if (!text) return [];
  return text
    .split(/[;|\n]+/)
    .map((part) =>
      part
        .split(/[,\s/]+/)
        .map((x) => parseFloat(x))
        .filter((x) => isFinite(x) && x > 0)
    )
    .filter((a) => a.length >= 3);
}

interface Seg {
  lines: string[]; // 该分片的全部行（EXTINF、URI 及其前面的零散标签）
  duration: number;
  decimals: number; // EXTINF 里写了几位小数，用来决定“帧网格”比较的容差
  sig: string;
  dirKey: string;
  uri: string;
  discontinuityBefore: boolean;
}

interface Run {
  segs: Seg[];
  start: number; // 第一个分片在全部分片中的下标
  sig: string;
  dirKey: string;
  duration: number;
  discontinuityBefore: boolean;
}

function resolveUri(uri: string, baseUrl?: string): string {
  if (!baseUrl) return uri;
  try {
    return new URL(uri, baseUrl).toString();
  } catch {
    return uri;
  }
}

export function segmentSignature(uri: string, baseUrl?: string): string {
  const full = resolveUri(uri, baseUrl);
  let host = '';
  let path = full;
  try {
    const u = new URL(full);
    host = u.host;
    path = u.pathname;
  } catch {
    // 相对路径且没有 baseUrl：只用路径部分
    path = full.split('?')[0];
  }
  const idx = path.lastIndexOf('/');
  const dir = idx >= 0 ? path.slice(0, idx + 1) : '';
  const rawName = idx >= 0 ? path.slice(idx + 1) : path;
  return `${host}${dir}${normalizeName(rawName)}`;
}

/**
 * 文件名模板化：
 * - “字母 + 数字”的顺序命名（seg001.ts / index00123.ts）→ 数字替换为 #
 * - 其余 8 位以上的字母数字串视为随机/哈希文件名（如 a3f9c2d41b.ts、Q2NNHhgL.ts），
 *   只保留“长度档位 + 扩展名”。注意随机串可能全是字母、也可能全是数字，不能依赖“含数字”来判断，
 *   否则同一目录的正片会被拆成许多“不同特征”的短段而被误删。
 */
function normalizeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  if (/^[A-Za-z_-]*\d+$/.test(stem)) return name.replace(/\d+/g, '#');
  if (/^[0-9a-zA-Z_-]{8,}$/.test(stem)) return `~${Math.round(stem.length / 4) * 4}${ext}`;
  return name.replace(/\d+/g, '#');
}

/** 域名 + 目录（不含文件名），用于判断“来源是否不同” */
function dirKeyOf(uri: string, baseUrl?: string): string {
  const sig = segmentSignature(uri, baseUrl);
  const idx = sig.lastIndexOf('/');
  return idx >= 0 ? sig.slice(0, idx + 1) : '';
}

const isKeyOrMap = (l: string) => l.startsWith('#EXT-X-KEY') || l.startsWith('#EXT-X-MAP');

const EPS_EQ = 0.002; // “时长相同”的容差（秒）

/** 指纹匹配容差：兼容 2~3 位小数的四舍五入 */
const FP_TOL = 0.006;

/**
 * 广告指纹：在整条列表里找“分片时长序列与某支已知广告逐片一致”的窗口（可以跨 DISCONTINUITY）。
 * 至少 3 个分片、总长至少 5 秒；序列里 ≥4 个分片且全部等长的指纹只接受调用方显式传入的（见 trusted）。
 */
function matchFingerprints(segs: Seg[], fps: number[][], trusted: Set<number[]>): boolean[] {
  const mask: boolean[] = segs.map(() => false);
  for (const fp of fps) {
    const n = fp.length;
    if (n < 3 || fp.reduce((a, b) => a + b, 0) < 5) continue;
    const uniform = fp.every((x) => Math.abs(x - fp[0]) < EPS_EQ);
    if (uniform && !trusted.has(fp)) continue;
    for (let i = 0; i + n <= segs.length; i++) {
      let ok = true;
      for (let k = 0; k < n; k++) {
        if (Math.abs(segs[i + k].duration - fp[k]) > FP_TOL) {
          ok = false;
          break;
        }
      }
      if (ok) for (let k = 0; k < n; k++) mask[i + k] = true;
    }
  }
  return mask;
}

/**
 * 规则 E（帧率不一致）：广告与正片通常是两次独立转码，帧率不同。
 * 实测电影天堂源：正片 25fps（所有分片时长都是 0.04 的整数倍），广告 30fps（1/30 的整数倍，如 5.567、2.933）。
 * 只在“正片明显只落在一种帧网格上”时启用，并且只认连续 ≥3 个“只落在另一种网格上”的分片。
 * 小数位数不足 3 位的分片无法可靠判断，一律当作“未知”。
 */
function detectForeignFps(segs: Seg[], total: number, opt: typeof DEFAULTS): boolean[] | null {
  const kinds = segs.map((s) => {
    if (s.decimals < 3) return 'u'; // 未知
    const tol = 0.5 * Math.pow(10, -s.decimals) + 1e-4;
    const near = (p: number) => {
      const k = Math.round(s.duration / p);
      return k > 0 && Math.abs(s.duration - k * p) <= tol;
    };
    const a = near(0.04); // 25fps
    const b = near(1 / 30); // 30fps
    return a && b ? 'x' : a ? 'A' : b ? 'B' : 'o';
  });
  const nA = kinds.filter((k) => k === 'A').length;
  const nB = kinds.filter((k) => k === 'B').length;
  const main = nA >= nB ? 'A' : 'B';
  const other = main === 'A' ? 'B' : 'A';
  const nMain = main === 'A' ? nA : nB;
  const nOther = main === 'A' ? nB : nA;
  if (nMain < segs.length * 0.5) return null; // 正片不是明确的 25/30fps
  if (nOther === 0 || nOther / (nMain + nOther) > 0.06) return null;

  const mask: boolean[] = segs.map(() => false);
  let windows = 0;
  let i = 0;
  while (i < segs.length) {
    if (kinds[i] !== other) {
      i++;
      continue;
    }
    let j = i;
    let cnt = 0;
    let last = i;
    // 窗口 = 连续的“另一种网格”或“两种网格都符合（如 4.000）”的分片，首尾必须是“另一种网格”
    while (j < segs.length && (kinds[j] === other || kinds[j] === 'x')) {
      if (kinds[j] === other) {
        cnt++;
        last = j;
      }
      j++;
    }
    const a = i;
    const b = last; // 含
    let secs = 0;
    for (let k = a; k <= b; k++) secs += segs[k].duration;
    const bounded = segs[a].discontinuityBefore || (segs[b + 1] ? segs[b + 1].discontinuityBefore : false);
    if (cnt >= 3 && (bounded || cnt >= 5) && secs <= opt.maxAdSeconds && secs / total <= opt.maxAdShare) {
      for (let k = a; k <= b; k++) mask[k] = true;
      windows++;
    }
    i = Math.max(j, b + 1);
  }
  return windows > 0 && windows <= 4 ? mask : null;
}

/**
 * 从播放列表里取出“时间轴 [startSec, endSec] 内”的分片时长序列，用作自定义广告指纹。
 * 时间轴按未过滤的原始列表计算（也就是播放器进度条上看到的时间）。
 * 分片只要有一半以上落在区间内就算；返回序列的总长至少 5 秒、至少 3 片才有意义。
 */
export function fingerprintForRange(m3u8Content: string, startSec: number, endSec: number): number[] {
  if (!m3u8Content || !(endSec > startSec)) return [];
  const out: number[] = [];
  let t = 0;
  let d = 0;
  for (const raw of m3u8Content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      const m = /#EXTINF:\s*(\d+(?:\.\d*)?)/.exec(line);
      d = m ? parseFloat(m[1]) : 0;
    } else if (line && !line.startsWith('#')) {
      const overlap = Math.min(t + d, endSec) - Math.max(t, startSec);
      if (d > 0 && overlap >= d * 0.5) out.push(d);
      t += d;
      d = 0;
    }
  }
  return out;
}

/** 把一支广告的时长序列写成 parseAdFingerprints 能读回的文本，如 `5.567,2.933,5.7` */
export function formatFingerprint(durations: number[]): string {
  return durations.map((x) => String(Math.round(x * 1e6) / 1e6)).join(',');
}

export function filterAdsFromM3U8(
  m3u8Content: string,
  options: AdFilterOptions = {}
): AdFilterResult {
  const passthrough = (reason: string): AdFilterResult => ({
    content: m3u8Content || '',
    removedSegments: 0,
    removedSeconds: 0,
    skippedReason: reason,
  });

  if (!m3u8Content) return passthrough('empty');
  const opt = { ...DEFAULTS, ...options };

  try {
    const eol = m3u8Content.includes('\r\n') ? '\r\n' : '\n';
    const lines = m3u8Content.split(/\r?\n/);

    if (!lines.some((l) => l.startsWith('#EXTINF'))) return passthrough('not-media-playlist');
    if (!lines.some((l) => l.startsWith('#EXT-X-ENDLIST'))) return passthrough('live-playlist');

    // ---- 解析 ----
    const header: string[] = [];
    const footer: string[] = [];
    const segs: Seg[] = [];
    let pending: string[] = [];
    let pendingDisc = false;
    let duration = 0;
    let decimals = 0;
    let started = false;
    let curKey: string | null = null;
    let curMap: string | null = null;
    const segKey: (string | null)[] = [];
    const segMap: (string | null)[] = [];
    // 记录每个分片“开始前”最近出现的 KEY/MAP 声明状态
    for (const line of lines) {
      if (line === '') continue;
      if (line.startsWith('#EXT-X-ENDLIST')) {
        footer.push(line);
        continue;
      }
      if (!started && !line.startsWith('#EXTINF') && !line.startsWith('#EXT-X-DISCONTINUITY') && !isKeyOrMap(line) && !line.startsWith('#EXT-X-PROGRAM-DATE-TIME')) {
        header.push(line);
        continue;
      }
      started = true;
      if (line.startsWith('#EXT-X-DISCONTINUITY')) {
        // 不含 -SEQUENCE
        if (line.trim() === '#EXT-X-DISCONTINUITY') {
          pendingDisc = true;
          continue;
        }
        header.push(line);
        continue;
      }
      if (line.startsWith('#EXT-X-KEY')) curKey = line;
      if (line.startsWith('#EXT-X-MAP')) curMap = line;
      if (line.startsWith('#EXTINF')) {
        const m = /#EXTINF:\s*(\d+(?:\.(\d*))?)/.exec(line);
        duration = m ? parseFloat(m[1]) : 0;
        decimals = m && m[2] ? m[2].length : 0;
        pending.push(line);
        continue;
      }
      if (line.startsWith('#')) {
        pending.push(line);
        continue;
      }
      // URI 行
      pending.push(line);
      segs.push({
        lines: pending,
        duration,
        decimals,
        sig: segmentSignature(line.trim(), options.baseUrl),
        dirKey: dirKeyOf(line.trim(), options.baseUrl),
        uri: resolveUri(line.trim(), options.baseUrl),
        discontinuityBefore: pendingDisc,
      });
      segKey.push(curKey);
      segMap.push(curMap);
      pending = [];
      pendingDisc = false;
      duration = 0;
      decimals = 0;
    }
    if (pending.length > 0) return passthrough('dangling-lines');
    if (segs.length === 0) return passthrough('no-segments');

    // ---- 切成 run：遇到分隔标记（或特征变化）就开新段 ----
    const makeRuns = (splitOnSig: boolean): Run[] => {
      const rs: Run[] = [];
      segs.forEach((s, i) => {
        const last = rs[rs.length - 1];
        if (last && !s.discontinuityBefore && (!splitOnSig || last.sig === s.sig)) {
          last.segs.push(s);
          last.duration += s.duration;
        } else {
          rs.push({
            segs: [s],
            start: i,
            sig: s.sig,
            dirKey: s.dirKey,
            duration: s.duration,
            discontinuityBefore: s.discontinuityBefore,
          });
        }
      });
      return rs;
    };

    const patterns = [...DEFAULT_AD_PATTERNS, ...(opt.extraPatterns || [])]
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);

    const total = segs.reduce((a, s) => a + s.duration, 0);
    if (total <= 0) return passthrough('zero-duration');

    const mask: boolean[] = segs.map(() => false);
    const methods: string[] = [];
    const expand = (rs: Run[], flags: boolean[]) => {
      rs.forEach((r, i) => {
        if (flags[i]) r.segs.forEach((_, k) => (mask[r.start + k] = true));
      });
    };
    let reason = '';

    // ---- 方法 1：按分片特征（域名/目录/文件名模板）区分 ----
    const runs = makeRuns(true);
    const bySig = new Map<string, number>();
    for (const r of runs) bySig.set(r.sig, (bySig.get(r.sig) || 0) + r.duration);
    let mainSig = '';
    let mainDur = 0;
    bySig.forEach((d, sig) => {
      if (d > mainDur) {
        mainDur = d;
        mainSig = sig;
      }
    });
    if (mainDur / total < opt.minMainShare) {
      reason = 'no-clear-main';
    } else {
      const mainRun = runs.find((r) => r.sig === mainSig);
      const mainDir = mainRun ? mainRun.dirKey : '';
      const isAd = runs.map((r, i) => {
        if (r.sig === mainSig) return false;
        if (r.duration > opt.maxAdSeconds) return false;
        if (r.duration / total > opt.maxAdShare) return false;
        // 只有文件名模板不同不算证据（命名噪声会把正片误判成广告）：
        // 必须“域名/目录与正片不同”或“两侧有 DISCONTINUITY 分隔”
        const boundary = r.discontinuityBefore || !!(runs[i + 1] && runs[i + 1].discontinuityBefore);
        return r.dirKey !== mainDir || boundary;
      });
      // 命中关键词的非正片段，即使略长也算（仍受总量上限约束）
      runs.forEach((r, i) => {
        if (isAd[i] || r.sig === mainSig) return;
        const u = r.segs[0].uri.toLowerCase();
        if (patterns.some((p) => u.includes(p)) && r.duration / total <= opt.maxAdShare) isAd[i] = true;
      });
      if (isAd.some(Boolean)) {
        expand(runs, isAd);
        methods.push('signature');
      } else {
        reason = 'no-ads-found';
      }
    }

    // ---- 方法 2：广告指纹（内置 + 自定义），不依赖命名，也不受方法 1 有无结果影响 ----
    const custom = (opt.extraFingerprints || []).filter((f) => Array.isArray(f) && f.length >= 3);
    const trusted = new Set<number[]>(custom);
    const fpMask = matchFingerprints(segs, [...DEFAULT_AD_FINGERPRINTS.map((f) => f.durations), ...custom], trusted);
    if (fpMask.some(Boolean)) {
      fpMask.forEach((v, i) => {
        if (v) mask[i] = true;
      });
      methods.push('fingerprint');
    }

    // ---- 方法 3（兜底）：上面都没结果时，用结构规则 ----
    if (!mask.some(Boolean)) {
      const dRuns = makeRuns(false);
      const dTotal = dRuns.reduce((a, r) => a + r.duration, 0);
      const cand: boolean[] = dRuns.map(() => false);
      const used: string[] = [];
      if (dRuns.length >= 2 && dTotal > 0) {
        // 规则 B（标记较少的列表，2~12 段）：最长一段占 ≥55% 时长作为正片；候选段 ≤ maxAdSeconds，
        //        位于开头/结尾，或中间段的分片时长与正片明显不同。
        if (dRuns.length <= 12) {
          let longest = 0;
          dRuns.forEach((r, i) => {
            if (r.duration > dRuns[longest].duration) longest = i;
          });
          if (dRuns[longest].duration / dTotal >= 0.55) {
            const median = (r: Run) => {
              const d = r.segs.map((x) => x.duration).sort((x, y) => x - y);
              return d[Math.floor(d.length / 2)] || 0;
            };
            const mainMed = median(dRuns[longest]);
            dRuns.forEach((r, i) => {
              if (i === longest) return;
              if (r.duration > opt.maxAdSeconds || r.duration / dTotal > opt.maxAdShare) return;
              if (i === 0 || i === dRuns.length - 1) {
                cand[i] = true;
                used.push('B');
                return;
              }
              const m = median(r);
              if (mainMed > 0 && Math.abs(m - mainMed) / mainMed > 0.2) {
                cand[i] = true;
                used.push('B');
              }
            });
          }
        }
        // 规则 D（“定长分块”型源，如电影天堂）：提供方把正片每 5 个分片切成一块并插入标记；
        //        广告插入后，块边界被打乱，出现“相邻的几个不足整块的小段，且分片数之和恰好等于整块大小”。
        //        实测：4m58s–5m17s 的广告 = 相邻两段（2 片 + 3 片，共 19.07 秒）。
        //        只在“绝大多数段都是同一个整块大小”时启用，并要求窗口时长 5~40 秒。
        const sizeCount = new Map<number, number>();
        dRuns.forEach((r) => sizeCount.set(r.segs.length, (sizeCount.get(r.segs.length) || 0) + 1));
        let chunk = 0;
        let chunkN = 0;
        sizeCount.forEach((n, sz) => {
          if (n > chunkN) {
            chunkN = n;
            chunk = sz;
          }
        });
        if (chunk >= 3 && chunkN / dRuns.length >= 0.5) {
          for (let a = 0; a < dRuns.length; a++) {
            let sum = 0;
            let secs = 0;
            let b = a;
            while (b < dRuns.length && dRuns[b].segs.length < chunk && sum < chunk) {
              sum += dRuns[b].segs.length;
              secs += dRuns[b].duration;
              b++;
            }
            if (sum === chunk && b - a >= 2 && secs >= 5 && secs <= 40) {
              for (let x = a; x < b; x++) cand[x] = true;
              used.push('D');
              a = b - 1;
            }
          }
        }
        // 规则 F（孤立的整齐块，如意源）：一个被标记隔开、所有分片时长完全相同（如 5×4.000 秒）的块——
        //        广告片按固定分片长度单独转码，而正片按关键帧切、时长参差不齐。
        //        但片尾字幕 / 静止画面的正片也会出现整齐的 4.000 秒，所以必须同时满足：
        //        ① 块本身 ≥4 片、≤maxAdSeconds；② 前后相邻的段都不是“整齐块”，且各自最多含 1 个同时长分片；
        //        ③ 整条列表里这样的整齐块不超过 2 个；④ 该时长的分片在其余部分占比 ≤20%。
        const uni = dRuns.map(
          (r) => r.segs.length >= 4 && r.segs.every((x) => Math.abs(x.duration - r.segs[0].duration) < EPS_EQ)
        );
        const nUni = uni.filter(Boolean).length;
        if (nUni > 0 && nUni <= 2 && dRuns.length >= 8) {
          dRuns.forEach((r, i) => {
            if (!uni[i] || r.duration > opt.maxAdSeconds) return;
            const d0 = r.segs[0].duration;
            const eq = (x: Run | undefined) => (x ? x.segs.filter((s) => Math.abs(s.duration - d0) < EPS_EQ).length : 0);
            const prev = dRuns[i - 1];
            const next = dRuns[i + 1];
            if ((prev && uni[i - 1]) || (next && uni[i + 1])) return;
            if (eq(prev) > 1 || eq(next) > 1) return;
            const rest = segs.filter((s) => Math.abs(s.duration - d0) < EPS_EQ).length - r.segs.length;
            if (rest / Math.max(1, segs.length - r.segs.length) > 0.2) return;
            cand[i] = true;
            used.push('F');
          });
        }
        // 相邻候选合并为“簇”：簇总时长超过 maxAdSeconds 视为信息不足（可能是片尾字幕等），整簇放弃
        let k = 0;
        while (k < dRuns.length) {
          if (!cand[k]) {
            k++;
            continue;
          }
          let e = k;
          let sum = 0;
          while (e < dRuns.length && cand[e]) {
            sum += dRuns[e].duration;
            e++;
          }
          if (sum > opt.maxAdSeconds) for (let x = k; x < e; x++) cand[x] = false;
          k = e;
        }
        if (cand.some(Boolean)) {
          expand(dRuns, cand);
          methods.push(Array.from(new Set(used)).join('+'));
        }
      }
    }

    // ---- 规则 E（帧率不一致）：与以上方法互补，同一部影片里可能不止一支广告，所以总是检查 ----
    {
      const e = detectForeignFps(segs, total, opt);
      if (e) {
        let added = false;
        e.forEach((v, i) => {
          if (v && !mask[i]) {
            mask[i] = true;
            added = true;
          }
        });
        if (added) methods.push('E');
      }
    }

    const removedSegments = mask.filter(Boolean).length;
    if (removedSegments === 0) return passthrough(reason || 'no-ads-found');
    const removedSeconds = segs.reduce((a, s, i) => a + (mask[i] ? s.duration : 0), 0);
    if (removedSeconds / total > opt.maxTotalRemovedShare) return passthrough('remove-too-much');
    if (removedSegments === segs.length) return passthrough('would-be-empty');

    // ---- 重建（按分片）----
    const out: string[] = [...header];
    let emittedKey: string | null = null;
    let emittedMap: string | null = null;
    let carryDisc = false;
    let firstOut = true;
    segs.forEach((s, i) => {
      if (mask[i]) {
        if (s.discontinuityBefore) carryDisc = true;
        return;
      }
      const needDisc = (s.discontinuityBefore || carryDisc) && !firstOut;
      carryDisc = false;
      if (needDisc) out.push('#EXT-X-DISCONTINUITY');
      const ownKey = s.lines.some((l) => l.startsWith('#EXT-X-KEY'));
      const ownMap = s.lines.some((l) => l.startsWith('#EXT-X-MAP'));
      // 被删分片里声明的 KEY/MAP 需要补回，否则后面的分片会解不开
      if (!ownKey && segKey[i] && segKey[i] !== emittedKey) out.push(segKey[i] as string);
      if (!ownMap && segMap[i] && segMap[i] !== emittedMap) out.push(segMap[i] as string);
      s.lines.forEach((l) => {
        if (l.startsWith('#EXT-X-KEY')) emittedKey = l;
        if (l.startsWith('#EXT-X-MAP')) emittedMap = l;
        out.push(l);
      });
      if (!ownKey && segKey[i]) emittedKey = segKey[i];
      if (!ownMap && segMap[i]) emittedMap = segMap[i];
      firstOut = false;
    });
    out.push(...footer);

    return {
      content: out.join(eol) + eol,
      removedSegments,
      removedSeconds,
      method: methods.join(','),
    };
  } catch {
    return passthrough('parse-error');
  }
}

/**
 * 原有规则（与最初版本 play 页中的 filterAdsFromM3U8 完全一致，保持不变）：
 * 删除播放列表里所有包含 #EXT-X-DISCONTINUITY 的行。
 * 实测在多数源上能让播放器越过广告；配合 filterAdsFromM3U8 使用时必须放在它之后
 * （后者要靠这些标记来识别广告段）。
 */
export function stripDiscontinuityLegacy(m3u8Content: string): string {
  if (!m3u8Content) return '';
  const lines = m3u8Content.split('\n');
  const filteredLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('#EXT-X-DISCONTINUITY')) {
      filteredLines.push(line);
    }
  }
  return filteredLines.join('\n');
}
