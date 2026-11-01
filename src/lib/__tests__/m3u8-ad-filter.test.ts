/** @jest-environment node */
import * as fs from 'fs';
import * as path from 'path';

import {
  DEFAULT_AD_FINGERPRINTS,
  filterAdsFromM3U8,
  fingerprintForRange,
  formatFingerprint,
  parseAdFingerprints,
  stripDiscontinuityLegacy,
} from '../m3u8-ad-filter';

const HEAD = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n';
const BASE = 'https://v.cdn-b.example/20240101/hls/index.m3u8';
const seg = (dur: number, uri: string) => `#EXTINF:${dur},\n${uri}\n`;
const main = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => seg(10, `seg${from + i}.ts`)).join('');
const ad = (n: number, host = 'https://ad.cdn-a.example/adjump') =>
  Array.from({ length: n }, (_, i) => seg(3, `${host}/a${i}.ts`)).join('');
const D = '#EXT-X-DISCONTINUITY\n';
const END = '#EXT-X-ENDLIST\n';
const uris = (s: string) => s.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
const count = (s: string, t: string) => s.split(t).length - 1;

describe('filterAdsFromM3U8', () => {
  it('T01 开头广告', () => {
    const r = filterAdsFromM3U8(HEAD + ad(4) + D + main(60) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(4);
    expect(uris(r.content).every((u) => u.startsWith('seg'))).toBe(true);
    expect(r.content.startsWith('#EXTM3U')).toBe(true);
    expect(r.content.indexOf('#EXT-X-DISCONTINUITY')).toBe(-1);
  });

  it('T02 中间广告，两侧标记只保留一个', () => {
    const r = filterAdsFromM3U8(HEAD + main(30) + D + ad(5) + D + main(30, 30) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(5);
    expect(uris(r.content)).toHaveLength(60);
    expect(count(r.content, '#EXT-X-DISCONTINUITY')).toBe(1);
  });

  it('T03 结尾广告', () => {
    const r = filterAdsFromM3U8(HEAD + main(60) + D + ad(5) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(5);
    expect(r.content).toContain('#EXT-X-ENDLIST');
    expect(uris(r.content)).toHaveLength(60);
  });

  it('T04 多段广告', () => {
    const r = filterAdsFromM3U8(
      HEAD + ad(3) + D + main(30) + D + ad(3, 'https://x.example/promo') + D + main(30, 30) + END,
      { baseUrl: BASE }
    );
    expect(r.removedSegments).toBe(6);
    expect(uris(r.content)).toHaveLength(60);
  });

  it('T05 被删广告段声明的 KEY 会补回给正片', () => {
    const key = '#EXT-X-KEY:METHOD=AES-128,URI="k.key"\n';
    const r = filterAdsFromM3U8(HEAD + key + ad(3) + D + main(40) + END, { baseUrl: BASE });
    // 广告段与正片都在 KEY 生效范围内，KEY 必须出现在第一个正片分片之前
    expect(r.content.indexOf('#EXT-X-KEY')).toBeGreaterThan(-1);
    expect(r.content.indexOf('#EXT-X-KEY')).toBeLessThan(r.content.indexOf('seg0.ts'));
  });

  it('T06 fMP4 的 EXT-X-MAP 保留', () => {
    const map = '#EXT-X-MAP:URI="init.mp4"\n';
    const r = filterAdsFromM3U8(HEAD + map + ad(3) + D + main(40) + END, { baseUrl: BASE });
    expect(r.content.indexOf('#EXT-X-MAP')).toBeLessThan(r.content.indexOf('seg0.ts'));
  });

  it('T07 正片自身带标记（同特征多组）不删分片，保留标记', () => {
    const input = HEAD + main(20) + D + main(20, 20) + D + main(20, 40) + END;
    const r = filterAdsFromM3U8(input, { baseUrl: BASE });
    expect(r.removedSegments).toBe(0);
    expect(r.content).toBe(input);
  });

  it('T08 直播列表原样返回', () => {
    const input = HEAD + ad(3) + D + main(20);
    const r = filterAdsFromM3U8(input, { baseUrl: BASE });
    expect(r.content).toBe(input);
    expect(r.skippedReason).toBe('live-playlist');
  });

  it('T09 找不到明确正片原样返回', () => {
    const input = HEAD + ad(5, 'https://a.example/x') + D + ad(5, 'https://b.example/y') + D + ad(5, 'https://c.example/z') + END;
    const r = filterAdsFromM3U8(input, { baseUrl: BASE });
    expect(r.content).toBe(input);
  });

  it('T10 删除量超限原样返回', () => {
    const input = HEAD + main(14) + D + Array.from({ length: 7 }, (_, i) => seg(10, `https://o.example/p/q${i}.ts`)).join('') + END;
    const r = filterAdsFromM3U8(input, { baseUrl: BASE, maxAdSeconds: 200, maxAdShare: 0.9 });
    expect(r.content).toBe(input);
    expect(r.skippedReason).toBe('remove-too-much');
  });

  it('T11 相对路径与绝对路径广告混合', () => {
    const r = filterAdsFromM3U8(HEAD + main(40) + D + ad(4) + D + main(40, 40) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(4);
  });

  it('T12 主列表原样返回', () => {
    const input = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow/index.m3u8\n';
    expect(filterAdsFromM3U8(input).content).toBe(input);
  });

  it('T13 损坏/空内容不抛异常', () => {
    expect(filterAdsFromM3U8('').content).toBe('');
    expect(filterAdsFromM3U8('garbage').content).toBe('garbage');
    expect(filterAdsFromM3U8('#EXTM3U\n#EXTINF:3,\n').content).toContain('#EXTINF');
  });

  it('T14 额外关键词命中较长的广告段', () => {
    const longAd = Array.from({ length: 12 }, (_, i) => seg(10, `https://v.cdn-b.example/20240101/promo-x/p${i}.ts`)).join('');
    const input = HEAD + main(100) + D + longAd + D + main(100, 100) + END;
    const without = filterAdsFromM3U8(input, { baseUrl: BASE });
    expect(without.removedSegments).toBe(0); // 120 秒 > 90 秒上限
    const withPattern = filterAdsFromM3U8(input, { baseUrl: BASE, extraPatterns: ['promo-x'] });
    expect(withPattern.removedSegments).toBe(12);
  });

  it('保持 CRLF 换行', () => {
    const r = filterAdsFromM3U8((HEAD + ad(3) + D + main(40) + END).replace(/\n/g, '\r\n'), { baseUrl: BASE });
    expect(r.removedSegments).toBe(3);
    expect(r.content).toContain('\r\n');
  });

  // ---- 方案二 / 哈希文件名（真实源常见：广告与正片同域名同目录） ----
  const hashMain = (n: number) =>
    Array.from({ length: n }, (_, i) => seg(10, `${(i * 7919 + 123457).toString(16)}a${i}f9c2d41b.ts`)).join('');
  const sameDirAd = (n: number, dur = 4) =>
    Array.from({ length: n }, (_, i) => seg(dur, `ad${i}.ts`)).join('');

  it('T15 哈希文件名的正片不再导致“找不到正片”而放弃', () => {
    const r = filterAdsFromM3U8(HEAD + ad(4) + D + hashMain(60) + END, { baseUrl: BASE });
    expect(r.skippedReason).toBeUndefined();
    expect(r.removedSegments).toBe(4);
  });

  it('T16 广告与正片同目录，仅靠标记分隔：开头广告被删', () => {
    const r = filterAdsFromM3U8(HEAD + sameDirAd(5) + D + main(60) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(5);
    expect(uris(r.content).every((u) => /^seg\d+\.ts$/.test(u))).toBe(true);
  });

  it('T17 同目录结尾广告被删', () => {
    const r = filterAdsFromM3U8(HEAD + main(60) + D + sameDirAd(4) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(4);
  });

  it('T18 同目录中间广告：分片时长与正片明显不同才删', () => {
    const r = filterAdsFromM3U8(HEAD + main(30) + D + sameDirAd(5, 4) + D + main(30, 30) + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(5);
    // 时长与正片相同的中间段无法判断，保持原样
    const same = HEAD + main(30) + D + main(5, 100) + D + main(30, 30) + END;
    expect(filterAdsFromM3U8(same, { baseUrl: BASE }).removedSegments).toBe(0);
  });

  it('T19 标记过多（每几片一个）不启用兜底', () => {
    let body = '';
    for (let i = 0; i < 20; i++) body += D + main(3, i * 3);
    const input = HEAD + body + END;
    expect(filterAdsFromM3U8(input, { baseUrl: BASE }).removedSegments).toBe(0);
  });

  it('T20 原有规则：删除全部 DISCONTINUITY 行，其余原样', () => {
    const input = HEAD + main(3) + D + ad(2) + D + main(3, 3) + '#EXT-X-DISCONTINUITY-SEQUENCE:1\n' + END;
    const out = stripDiscontinuityLegacy(input);
    expect(out).not.toContain('#EXT-X-DISCONTINUITY');
    expect(uris(out)).toHaveLength(8);
    expect(stripDiscontinuityLegacy('')).toBe('');
  });

  it('T21 组合：先识别删除广告分片，再执行原有规则', () => {
    const r = filterAdsFromM3U8(HEAD + ad(4) + D + main(30) + D + sameDirAd(3) + D + main(30, 30) + END, { baseUrl: BASE });
    const out = stripDiscontinuityLegacy(r.content);
    expect(r.removedSegments).toBe(7);
    expect(out).not.toContain('#EXT-X-DISCONTINUITY');
    expect(uris(out)).toHaveLength(60);
  });

  // ---- 真实播放列表回归（用户抓取：如意 / 爱奇艺 / 电影天堂 / iKun） ----
  const fixture = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', `${n}.m3u8`), 'utf8');
  const removedUris = (orig: string, out: string) => {
    const keep = new Set(uris(out));
    return uris(orig).filter((u) => !keep.has(u));
  };

  it('R1 iKun：只删 3 段 6 片的广告目录，绝不误删正片（曾误删 307 片）', () => {
    const src = fixture('ikun');
    const r = filterAdsFromM3U8(src, { baseUrl: 'https://kkzycdn.com:65/20251225/xa8G2g6Z/2598kb/hls/index.m3u8' });
    expect(r.removedSegments).toBe(18);
    expect(r.removedSeconds).toBeGreaterThan(52);
    expect(r.removedSeconds).toBeLessThan(54);
    const gone = removedUris(src, r.content);
    expect(gone).toHaveLength(18);
    expect(gone.every((u) => u.includes('/20261009/AcAa7mOH/10103kb/'))).toBe(true);
  });

  it('R2 爱奇艺：删中间 5 片（17.6 秒）广告', () => {
    const src = fixture('iqiyi');
    const r = filterAdsFromM3U8(src, { baseUrl: 'https://x.example/videos/20250313/67d2f4593ea9ee0b65133c76/dbc99b/index.m3u8' });
    expect(r.removedSegments).toBe(5);
    expect(removedUris(src, r.content).every((u) => u.startsWith('/stream/20261009/'))).toBe(true);
  });

  it('R3 如意：同目录哈希命名，删 5 个整 4 秒的广告块', () => {
    const src = fixture('ruyi');
    const r = filterAdsFromM3U8(src, { baseUrl: 'https://x.example/20260101/index.m3u8' });
    expect(r.removedSegments).toBe(5);
    expect(r.removedSeconds).toBeCloseTo(20, 1);
  });

  const removedRanges = (orig: string, out: string) => {
    const keep = new Set(uris(out));
    let pos = 0;
    let dur = 0;
    const rm: Array<[number, number]> = [];
    for (const l of orig.split(/\r?\n/)) {
      if (l.startsWith('#EXTINF')) {
        dur = parseFloat(l.split(':')[1]);
      } else if (l && !l.startsWith('#')) {
        if (!keep.has(l)) rm.push([pos, pos + dur]);
        pos += dur;
      }
    }
    return rm;
  };

  it('R4 电影天堂（用户标注广告 4m58s-5m17s）：精确删除这一段', () => {
    const src = fixture('dyttzy-ad-4m58s');
    const r = filterAdsFromM3U8(src, { baseUrl: 'https://x.example/a/index.m3u8' });
    expect(r.removedSegments).toBe(5);
    expect(r.removedSeconds).toBeCloseTo(19.07, 1);
    const rm = removedRanges(src, r.content);
    expect(rm[0][0]).toBeCloseTo(298.2, 0);
    expect(rm[rm.length - 1][1]).toBeCloseTo(317.2, 0);
    // 其余内容原样保留
    expect(uris(r.content)).toHaveLength(uris(src).length - 5);
  });

  it('R4b 电影天堂另两份列表：同样的 2+3 片广告被删，其余不动', () => {
    const a = fixture('dyttzy');
    const ra = filterAdsFromM3U8(a, { baseUrl: 'https://x.example/a/index.m3u8' });
    // 5 片是用户标注的那支广告；另外 4 片（约 25:15）是同一部片里 30fps 的第二支广告，靠帧率差异识别
    expect(ra.removedSegments).toBe(9);
    expect(removedRanges(a, ra.content)[0][0]).toBeCloseTo(298.6, 0);
    expect(removedRanges(a, ra.content)[5][0]).toBeCloseTo(1515.3, 0);
    const b = fixture('dyttzy-b');
    const rb = filterAdsFromM3U8(b, { baseUrl: 'https://x.example/a/index.m3u8' });
    expect(rb.removedSegments).toBe(5);
    expect(removedRanges(b, rb.content)[0][0]).toBeCloseTo(357.5, 0);
  });

  it('R4c iKun 1720kb / 魔都 3450kb：删广告目录的分片', () => {
    const a = fixture('kk-1720kb');
    expect(filterAdsFromM3U8(a, { baseUrl: 'https://x.example/20260821/8lDgvQQr/1720kb/hls/i.m3u8' }).removedSegments).toBe(6);
    const b = fixture('modu-3450kb');
    expect(filterAdsFromM3U8(b, { baseUrl: 'https://bf.modujx17.com/20260810/Y55PFmr3/3450kb/hls/i.m3u8' }).removedSegments).toBe(12);
  });

  it('R4d 整条同目录、无标记、带加密的列表（gszyi）：列表里没有任何特征，原样返回', () => {
    const src = fixture('gszyi-nomark');
    const r = filterAdsFromM3U8(src, { baseUrl: 'https://gs.gszyi.com:999/hls/661/20250712/2674876/index.m3u8' });
    expect(r.removedSegments).toBe(0);
    expect(r.content).toBe(src);
  });

  it('R5 随机文件名（含全字母 / 全数字）的正片不会被拆成广告', () => {
    const rnd = (i: number) => ['Q2NNHhgL', 'OPgAoWYf', 'tl6uPdt4', '12345678', 'ETNkman6', 'abcdefgh'][i % 6] + i;
    const body = Array.from({ length: 80 }, (_, i) => seg(5, `${rnd(i).slice(0, 8)}.ts`)).join('');
    const r = filterAdsFromM3U8(HEAD + body + END, { baseUrl: BASE });
    expect(r.removedSegments).toBe(0);
  });
  // ---------------- 第 2 批真实列表（用户标注了广告位置） ----------------
  const BASE2 = 'https://x.example/a/index.m3u8';

  it('R6 电影天堂（标注 7m42s-8m01s）：整块 20 秒广告被删，片尾 4 秒整齐块绝不误删（旧版曾误删 80 秒）', () => {
    const src = fixture('dyttzy-c-7m42s');
    const r = filterAdsFromM3U8(src, { baseUrl: BASE2 });
    expect(r.removedSegments).toBe(5);
    expect(r.removedSeconds).toBeCloseTo(20, 1);
    const rm = removedRanges(src, r.content);
    expect(rm[0][0]).toBeCloseTo(461.6, 0);
    expect(rm[rm.length - 1][1]).toBeCloseTo(481.6, 0);
    // 片尾那 6 个 5×4.000 秒的块必须原样保留
    expect(uris(r.content)).toHaveLength(uris(src).length - 5);
    expect(r.content).toContain('\r\n'); // 原文件是 CRLF，输出保持 CRLF
  });

  it('R7 电影天堂（标注 4m56s-5m15s）：删 296.4–315.5 秒；另一支 30fps 小广告靠帧率差异识别；片尾不动', () => {
    const src = fixture('dyttzy-d-4m56s');
    const r = filterAdsFromM3U8(src, { baseUrl: BASE2 });
    const rm = removedRanges(src, r.content);
    expect(rm[0][0]).toBeCloseTo(296.4, 0);
    expect(rm[4][1]).toBeCloseTo(315.5, 0);
    // 第二处：约 25:17，6.667 / 2.133 / 3.233 / 3.733 四片（30fps，而正片是 25fps）
    expect(r.removedSegments).toBe(9);
    expect(rm[5][0]).toBeCloseTo(1516.6, 0);
    expect(rm[8][1]).toBeCloseTo(1532.4, 0);
    // 片尾那一组整 4 秒分片必须保留
    expect(src.split(/\r?\n/).filter((l) => l.startsWith('#EXTINF:4.000')).length - r.content.split(/\r?\n/).filter((l) => l.startsWith('#EXTINF:4.000')).length).toBe(0);
  });

  it('R8 爱奇艺另两份列表：同一支广告（4×4.000+1.567 秒）被删', () => {
    for (const n of ['iqiyi-2', 'iqiyi-3']) {
      const src = fixture(n);
      const r = filterAdsFromM3U8(src, { baseUrl: 'https://x.example/videos/20250313/abc/def/index.m3u8' });
      expect(r.removedSegments).toBe(5);
      expect(r.removedSeconds).toBeCloseTo(17.57, 1);
      expect(removedUris(src, r.content).every((u) => u.startsWith('/stream/20261009/'))).toBe(true);
    }
  });

  it('R9 没有任何标记 / 命名线索的列表（jisuts / hhwenjian，带加密）：原样返回', () => {
    for (const n of ['nomark-jisuts', 'nomark-hhwenjian']) {
      const src = fixture(n);
      const r = filterAdsFromM3U8(src, { baseUrl: 'https://p.example:999/hls/877/20260208/3945126/index.m3u8' });
      expect(r.removedSegments).toBe(0);
      expect(r.content).toBe(src);
    }
  });

  it('R10 如意：孤立的整 4 秒块（5×4.000）仍然被删，且是规则 F 而不是误伤', () => {
    const r = filterAdsFromM3U8(fixture('ruyi'), { baseUrl: 'https://x.example/20260101/index.m3u8' });
    expect(r.method).toBe('F');
    expect(r.removedSegments).toBe(5);
  });

  it('R11 所有真实样本的删除量都在 5~60 秒之间，没有一条被整段吞掉', () => {
    for (const n of fs.readdirSync(path.join(__dirname, 'fixtures')).map((f) => f.replace(/\.m3u8$/, ''))) {
      const r = filterAdsFromM3U8(fixture(n), { baseUrl: BASE2 });
      expect(r.removedSeconds).toBeLessThan(60);
    }
  });
});

// ---------------- 广告指纹 / 规则 E / 规则 F ----------------
describe('广告指纹与结构规则', () => {
  const D = '#EXT-X-DISCONTINUITY\n';
  const END = '#EXT-X-ENDLIST\n';
  const HEAD = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:8\n';
  const B = 'https://x.example/a/index.m3u8';
  const f3 = (d: number) => d.toFixed(3);
  // 25fps 正片：时长都是 0.04 的整数倍（用 3 位小数写出，如 4.120）
  const film = (n: number, from = 0) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const d = 2 + ((i * 37) % 130) * 0.04; // 2.00 ~ 7.16 秒
      s += `#EXTINF:${f3(d)},\n${(from + i).toString(16).padStart(8, '0')}abcdef0123456789abcdef.ts\n`;
    }
    return s;
  };
  const clip = (durs: number[], tag: string) =>
    durs.map((d, i) => `#EXTINF:${f3(d)},\n${tag}${i}0123456789abcdef0123456789ab.ts\n`).join('');

  it('T22 parseAdFingerprints：分隔符与非法值', () => {
    expect(parseAdFingerprints('5.567,2.933, 5.7 ;4/5/4/4.24/2.76|abc,1')).toEqual([
      [5.567, 2.933, 5.7],
      [4, 5, 4, 4.24, 2.76],
    ]);
    expect(parseAdFingerprints('')).toEqual([]);
    expect(parseAdFingerprints(undefined)).toEqual([]);
  });

  it('T23 内置指纹：同目录同命名、没有任何标记也能删（跨 DISCONTINUITY 也行）', () => {
    const fp = DEFAULT_AD_FINGERPRINTS[2].durations; // 电影天堂 B
    const body = HEAD + film(60) + clip(fp, 'z') + film(60, 60) + END;
    const r = filterAdsFromM3U8(body, { baseUrl: B });
    expect(r.removedSegments).toBe(fp.length);
    expect(r.method).toContain('fingerprint');
    // 广告被 DISCONTINUITY 切成两半也一样
    const half = HEAD + film(60) + D + clip(fp.slice(0, 2), 'z') + D + clip(fp.slice(2), 'y') + D + film(60, 60) + END;
    expect(filterAdsFromM3U8(half, { baseUrl: B }).removedSegments).toBe(fp.length);
  });

  it('T24 指纹只在“逐片时长都一致”时命中：差 0.05 秒就不算', () => {
    const fp = DEFAULT_AD_FINGERPRINTS[2].durations.slice();
    fp[3] += 0.05;
    const r = filterAdsFromM3U8(HEAD + film(60) + clip(fp, 'z') + film(60, 60) + END, { baseUrl: B });
    expect(r.removedSegments).toBe(0);
  });

  it('T25 自定义指纹（extraFingerprints）生效；全等长指纹内置不收，自定义显式给出才收', () => {
    const custom = [3.1, 4.7, 2.2, 5.9];
    const body = HEAD + film(60) + clip(custom, 'z') + film(60, 60) + END;
    expect(filterAdsFromM3U8(body, { baseUrl: B }).removedSegments).toBe(0);
    expect(filterAdsFromM3U8(body, { baseUrl: B, extraFingerprints: [custom] }).removedSegments).toBe(4);
    const uni = HEAD + film(60) + clip([4, 4, 4, 4, 4], 'z') + film(60, 60) + END;
    expect(filterAdsFromM3U8(uni, { baseUrl: B, extraFingerprints: [[4, 4, 4, 4, 4]] }).removedSegments).toBe(5);
  });

  it('T26 规则 E：25fps 正片里夹 30fps 的广告（3 位小数、被标记隔开）会被删', () => {
    const ad30 = [5.567, 2.933, 5.7, 3.333];
    const body = HEAD + film(80) + D + clip(ad30, 'q') + D + film(80, 80) + END;
    const r = filterAdsFromM3U8(body, { baseUrl: B });
    expect(r.removedSegments).toBe(4);
    expect(r.method).toBe('E');
  });

  it('T27 规则 E 的保险：只有 2 位小数 / 只有 2 片 / 没有标记且不足 5 片 → 不删', () => {
    const ad = clip([5.567, 2.933, 5.7, 3.333], 'q').replace(/#EXTINF:(\d+\.\d{2})\d,/g, (_, a) => `#EXTINF:${a},`);
    expect(filterAdsFromM3U8(HEAD + film(80) + D + ad + D + film(80, 80) + END, { baseUrl: B }).removedSegments).toBe(0);
    const short = clip([5.567, 2.933], 'q');
    expect(filterAdsFromM3U8(HEAD + film(80) + D + short + D + film(80, 80) + END, { baseUrl: B }).removedSegments).toBe(0);
    const noMark = clip([5.567, 2.933, 5.7, 3.333], 'q');
    expect(filterAdsFromM3U8(HEAD + film(80) + noMark + film(80, 80) + END, { baseUrl: B }).removedSegments).toBe(0);
  });

  it('T28 规则 F：孤立的 5×4.000 块被删；连续的整齐块（片尾字幕）和邻居里有大量 4.000 的不删', () => {
    const u = (tag: string) => D + clip([4, 4, 4, 4, 4], tag);
    const chunk = (n: number, from: number) => D + film(n, from);
    let isolated = HEAD;
    for (let i = 0; i < 12; i++) isolated += chunk(5, i * 5);
    isolated += u('u') + chunk(5, 100) + chunk(5, 105) + END;
    const r = filterAdsFromM3U8(isolated, { baseUrl: B });
    expect(r.removedSegments).toBe(5);
    expect(r.method).toBe('F');
    // 片尾：连续 4 个整齐块
    let credits = HEAD;
    for (let i = 0; i < 12; i++) credits += chunk(5, i * 5);
    credits += u('a') + u('b') + u('c') + u('d') + END;
    expect(filterAdsFromM3U8(credits, { baseUrl: B }).removedSegments).toBe(0);
    // 整齐块前一段里有一串 4.000（静止画面）
    let still = HEAD;
    for (let i = 0; i < 12; i++) still += chunk(5, i * 5);
    still += D + clip([4, 4, 4, 4, 4, 4, 4, 4], 'p') + u('u') + chunk(5, 200) + END;
    expect(filterAdsFromM3U8(still, { baseUrl: B }).removedSegments).toBe(0);
  });

  it('T29 同一条列表里有两种广告（目录不同 + 指纹）一起删，并只保留必要的标记', () => {
    const fp = DEFAULT_AD_FINGERPRINTS[0].durations;
    const adDir = clip([3, 3, 3], 'x').replace(/\n([a-z0-9]+\.ts)/g, '\nhttps://ad.cdn-a.example/adjump/$1');
    const body = HEAD + film(60) + D + adDir + D + film(60, 60) + clip(fp, 'w') + film(60, 120) + END;
    const r = filterAdsFromM3U8(body, { baseUrl: B });
    expect(r.removedSegments).toBe(3 + fp.length);
    expect(r.method).toBe('signature,fingerprint');
    expect(r.content.split('#EXT-X-DISCONTINUITY').length - 1).toBe(1);
  });

  it('T30 自助学习：按进度条上的起止时间取出广告的时长序列（真实样本 4m56s-5m15s）', () => {
    const c = fs.readFileSync(path.join(__dirname, 'fixtures', 'dyttzy-d-4m56s.m3u8'), 'utf8');
    const fp = fingerprintForRange(c, 296, 315);
    expect(fp).toEqual([5.567, 2.933, 5.7, 3.333, 1.533]);
    expect(parseAdFingerprints(formatFingerprint(fp))).toEqual([fp]);
    // 范围里什么都没有 / 起止颠倒
    expect(fingerprintForRange(c, 5000, 5010)).toEqual([]);
    expect(fingerprintForRange(c, 315, 296)).toEqual([]);
  });

  it('T31 自助学习：同目录同命名、无标记的广告，学过一次后在另一部影片里被删；没学过时原样返回', () => {
    // 第一部：广告夹在正片里，没有任何结构线索
    const ad1 = [3.12, 4.72, 2.92, 6.32, 1.72]; // 与正片同为 25fps 网格，规则 E 也看不出来
    const ep1 = HEAD + film(60) + clip(ad1, 'q') + film(60, 60) + END;
    expect(filterAdsFromM3U8(ep1, { baseUrl: B }).removedSegments).toBe(0);
    // 用户在进度条上看到广告的起止秒数
    let t = 0;
    for (let i = 0; i < 60; i++) t += 2 + ((i * 37) % 130) * 0.04;
    const learned = fingerprintForRange(ep1, t + 0.2, t + ad1.reduce((a, b) => a + b, 0) - 0.2);
    expect(learned).toEqual(ad1);
    // 另一部影片：同一支广告出现在别处
    const ep2 = HEAD + film(40, 500) + clip(ad1, 'z') + film(80, 540) + END;
    expect(filterAdsFromM3U8(ep2, { baseUrl: B }).removedSegments).toBe(0);
    const r = filterAdsFromM3U8(ep2, { baseUrl: B, extraFingerprints: [learned] });
    expect(r.removedSegments).toBe(5);
    expect(r.method).toBe('fingerprint');
    expect(uris(r.content).every((u) => !u.startsWith('z'))).toBe(true);
  });
});
