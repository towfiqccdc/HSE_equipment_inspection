'use strict';
/* Builds the Word (.docx) inspection report. Works in the browser (needs the `docx` library loaded) and in Node (for tests).
   HSEReport.makeDoc(inspection, { lang, photos }) -> docx Document. Pack it with docx.Packer.toBlob / toBuffer.
   photos: { [storagePath]: { data: Uint8Array (jpeg), w, h } } — videos cannot go into a Word file and are only counted. */
(function (root) {
  const D = root.docx || (typeof require === 'function' ? require('docx') : null);

  const STR = {
    en: {
      title: 'Equipment Inspection Report', header: 'CCDC HSE', report_no: 'Report no.', page: 'Page', of: 'of', end: '',
      type: { crane: 'Crane', forklift: 'Forklift' },
      verdict: { accept: 'ACCEPTED', conditions: 'ACCEPTED WITH CONDITIONS', reject: 'REJECTED' },
      verdict_sub: { accept: 'Cleared to work on the rig.', conditions: 'May work only after the conditions below are met.', reject: 'Not allowed to work on the rig.' },
      sev: { ok: 'OK', minor: 'Minor', major: 'Major', critical: 'Critical', na: 'N/A' },
      d: { type: 'Equipment type', tag: 'Tag / ID', serial: 'Serial number', company: 'Contractor', rig: 'Rig / location', date: 'Inspection date', inspector: 'Inspector', cert: 'Certificate expiry' },
      cert_none: 'Not recorded', cert_expired: 'Expired {n} days ago', cert_left: '{n} days left',
      h_summary: 'Summary of findings', h_action: 'Findings that need action', h_cond: 'Conditions before use', h_comment: 'Inspector\'s comment',
      h_check: 'Inspection checklist', h_others: 'Others: additional observations', h_sign: 'Sign-off',
      none: 'No findings. Every item is OK.', col_item: 'Item', col_rating: 'Rating', col_note: 'Note',
      reading: 'Reading', videos: 'Video recorded: {n} (kept in the inspection record)', photos_missing: 'Photo could not be loaded',
      by: 'Inspected by', recv: 'Received by', name: 'Name', sign: 'Signature', date: 'Date', obs: 'Observation {n}',
      foot: 'Generated {d}', no_photo: 'No photo'
    },
    zh: {
      title: '设备检查报告', header: 'CCDC HSE', report_no: '报告编号', page: '第', of: '页，共', end: '页',
      type: { crane: '吊车', forklift: '叉车' },
      verdict: { accept: '准予使用', conditions: '有条件准予使用', reject: '不予使用（拒收）' },
      verdict_sub: { accept: '可在钻井现场作业。', conditions: '须满足以下条件后方可作业。', reject: '不得在钻井现场作业。' },
      sev: { ok: '正常', minor: '轻微', major: '严重', critical: '危急', na: '不适用' },
      d: { type: '设备类型', tag: '编号 / 标识', serial: '序列号', company: '承包商', rig: '钻机 / 位置', date: '检查日期', inspector: '检查人', cert: '证书到期日' },
      cert_none: '未记录', cert_expired: '已过期 {n} 天', cert_left: '剩余 {n} 天',
      h_summary: '检查结果汇总', h_action: '需要处理的问题', h_cond: '使用前须满足的条件', h_comment: '检查人意见',
      h_check: '检查清单', h_others: '其他：补充发现', h_sign: '签字确认',
      none: '无问题，所有项目正常。', col_item: '项目', col_rating: '评级', col_note: '说明',
      reading: '读数', videos: '已录视频：{n} 段（保存在检查记录中）', photos_missing: '照片无法加载',
      by: '检查人', recv: '接收人', name: '姓名', sign: '签名', date: '日期', obs: '发现 {n}',
      foot: '生成时间 {d}', no_photo: '无照片'
    }
  };
  const SEV = { ok: ['2B8A57', 'FFFFFF'], minor: ['F0C02E', '2A2208'], major: ['D9741A', 'FFFFFF'], critical: ['C4352C', 'FFFFFF'], na: ['76838D', 'FFFFFF'] };
  const VERD = { accept: ['2B8A57', 'FFFFFF'], conditions: ['F0C02E', '2A2208'], reject: ['C4352C', 'FFFFFF'] };
  const STEEL = '1B2630', STEEL2 = '34454F', GREY = '5D6C78', LINE = 'CDD4D9', PALE = 'EEF1F3', ORANGE = 'E0560C';
  const W = 9906; // content width in twips (A4, 1000 margins)
  const isVideo = p => /\.(mp4|mov|webm)$/i.test(p || '');
  const fill = (n, v) => String(n).split('{n}').join(v);

  function makeDoc(ins, opts) {
    const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, AlignmentType, VerticalAlign,
      ImageRun, Header, Footer, PageNumber, TabStopType, HeightRule } = D;
    opts = opts || {};
    const lang = opts.lang === 'zh' ? 'zh' : 'en';
    const R = STR[lang];
    const photos = opts.photos || {};
    const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', cs: 'Calibri', eastAsia: 'Microsoft YaHei' };
    const lab = (o, base) => (lang === 'zh' && o[base + '_zh']) || o[base + '_en'] || '';
    const fmtDate = d => {
      if (!d) return '—';
      const x = new Date(String(d).length === 10 ? d + 'T00:00:00' : d);
      return x.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const run = (text, o) => new TextRun(Object.assign({ text: String(text == null ? '' : text), font: FONT }, o || {}));
    const para = (children, o) => new Paragraph(Object.assign({ children: Array.isArray(children) ? children : [children], spacing: { before: 0, after: 0 } }, o || {}));
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: none, bottom: none, left: none, right: none };
    const thin = c => ({ style: BorderStyle.SINGLE, size: 4, color: c || LINE });
    const allThin = c => ({ top: thin(c), bottom: thin(c), left: thin(c), right: thin(c) });
    const shade = f => ({ type: ShadingType.CLEAR, color: 'auto', fill: f });
    const cell = (children, o) => new TableCell(Object.assign({ children: Array.isArray(children) ? children : [children], margins: { top: 70, bottom: 70, left: 120, right: 120 }, borders: allThin() }, o || {}));
    const row = (cells, o) => new TableRow(Object.assign({ children: cells, cantSplit: true }, o || {}));
    const table = (rows, widths, o) => new Table(Object.assign({ rows, width: { size: W, type: WidthType.DXA }, columnWidths: widths, layout: D.TableLayoutType ? D.TableLayoutType.FIXED : undefined }, o || {}));
    const gap = (n) => para([run('')], { spacing: { before: 0, after: n || 120 } });
    const h2 = text => para([run(text, { bold: true, size: 28, color: STEEL })], { spacing: { before: 280, after: 100 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ORANGE, space: 3 } } });

    const items = Array.isArray(ins.items) ? ins.items : [];
    const others = Array.isArray(ins.others) ? ins.others : [];
    const count = k => items.filter(i => i.sev === k).length + others.filter(o => o.sev === k).length;
    const sevChip = (sev, size) => {
      const [bg, fg] = SEV[sev] || SEV.na;
      return cell([para([run(R.sev[sev] || sev, { bold: true, color: fg, size: size || 22 })], { alignment: AlignmentType.CENTER })], { shading: shade(bg), verticalAlign: VerticalAlign.CENTER, borders: allThin(bg) });
    };

    /* ---- title block ---- */
    const typeName = R.type[ins.equipment_type] || ins.equipment_type;
    const titleBlock = table([row([cell([
      para([run(R.header, { bold: true, color: 'F2A65A', size: 22 })], { spacing: { after: 40 } }),
      para([run(R.title, { bold: true, color: 'FFFFFF', size: 52 })], { spacing: { after: 60 } }),
      para([run(`${typeName}  ·  ${ins.tag}`, { color: 'DDE3E8', size: 30 })])
    ], { shading: shade(STEEL), borders: noBorders, margins: { top: 260, bottom: 260, left: 300, right: 300 } })])], [W]);
    const orangeBar = table([row([cell([para([run('', { size: 4 })])], { shading: shade(ORANGE), borders: noBorders, margins: { top: 0, bottom: 0, left: 0, right: 0 } })], { height: { value: 70, rule: HeightRule ? HeightRule.EXACT : 'exact' } })], [W]);

    /* ---- verdict ---- */
    const [vbg, vfg] = VERD[ins.verdict] || VERD.reject;
    const verdictBlock = table([row([
      cell([para([run(R.verdict[ins.verdict] || ins.verdict, { bold: true, color: vfg, size: 40 })]), para([run(R.verdict_sub[ins.verdict] || '', { color: vfg, size: 21 })], { spacing: { before: 40 } })],
        { shading: shade(vbg), borders: allThin(vbg), margins: { top: 200, bottom: 200, left: 300, right: 300 }, verticalAlign: VerticalAlign.CENTER })
    ])], [W]);

    /* ---- details ---- */
    let certTxt = R.cert_none, certColor = GREY;
    if (ins.cert_expiry) {
      const days = Math.round((new Date(ins.cert_expiry + 'T00:00:00') - new Date((ins.inspected_on || new Date().toISOString().slice(0, 10)) + 'T00:00:00')) / 86400000);
      certTxt = fmtDate(ins.cert_expiry) + '  (' + (days < 0 ? fill(R.cert_expired, -days) : fill(R.cert_left, days)) + ')';
      certColor = days < 0 ? 'C4352C' : '18222B';
    }
    const dpair = (k, v, color) => [
      cell([para([run(k, { color: GREY, size: 19 })])], { shading: shade(PALE), width: { size: 1700, type: WidthType.DXA } }),
      cell([para([run(v || '—', { bold: true, size: 21, color: color || '18222B' })])], { width: { size: 3253, type: WidthType.DXA } })
    ];
    const details = table([
      row([...dpair(R.d.type, typeName), ...dpair(R.d.tag, ins.tag)]),
      row([...dpair(R.d.serial, ins.serial), ...dpair(R.d.company, ins.company)]),
      row([...dpair(R.d.rig, ins.rig), ...dpair(R.d.date, fmtDate(ins.inspected_on))]),
      row([...dpair(R.d.inspector, ins.inspector_name), ...dpair(R.d.cert, certTxt, certColor)])
    ], [1700, 3253, 1700, 3253]);

    /* ---- summary counts ---- */
    const sevs = ['ok', 'minor', 'major', 'critical', 'na'];
    const w5 = Math.floor(W / 5);
    const summary = table([
      row(sevs.map(s => cell([para([run(String(count(s)), { bold: true, size: 40, color: SEV[s][1] })], { alignment: AlignmentType.CENTER }), para([run(R.sev[s], { size: 20, color: SEV[s][1] })], { alignment: AlignmentType.CENTER })], { shading: shade(SEV[s][0]), borders: allThin('FFFFFF'), width: { size: w5, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 60, right: 60 } })))
    ], sevs.map(() => w5));

    /* ---- findings that need action ---- */
    const label = (it, idx) => `${idx}. ${lab(it, 'label')}`;
    const issues = [];
    items.forEach((it, i) => { if (['minor', 'major', 'critical'].includes(it.sev)) issues.push({ name: label(it, i + 1), sev: it.sev, note: it.note }); });
    others.forEach((o, i) => { if (o.note) issues.push({ name: fill(R.obs, i + 1), sev: o.sev, note: o.note }); });
    const rank = { critical: 0, major: 1, minor: 2 };
    issues.sort((a, b) => rank[a.sev] - rank[b.sev]);
    const actionBlock = issues.length
      ? table([
        row([R.col_item, R.col_rating, R.col_note].map((t, i) => cell([para([run(t, { bold: true, color: 'FFFFFF', size: 19 })])], { shading: shade(STEEL2), borders: allThin(STEEL2) })), { tableHeader: true }),
        ...issues.map(x => row([
          cell([para([run(x.name, { bold: true, size: 20 })])], { width: { size: 3600, type: WidthType.DXA } }),
          sevChip(x.sev, 19),
          cell([para([run(x.note || '—', { size: 20 })])], { width: { size: 4306, type: WidthType.DXA } })
        ]))
      ], [3600, 2000, 4306])
      : para([run(R.none, { size: 21, color: '2B8A57', bold: true })]);

    /* ---- conditions + comment ---- */
    const condParas = String(ins.conditions || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      .map((s, i) => para([run(`${i + 1}.  `, { bold: true, size: 21 }), run(s.replace(/^\s*\d+[.)]\s*/, ''), { size: 21 })], { spacing: { after: 60 }, indent: { left: 360, hanging: 360 } }));
    const commentParas = String(ins.comment || '').split(/\r?\n/).filter(s => s.trim()).map(s => para([run(s, { size: 21 })], { spacing: { after: 80 } }));

    /* ---- checklist with photos ---- */
    const fitBox = (p, maxW, maxH) => {
      const k = Math.min(maxW / p.w, maxH / p.h, 1);
      return { width: Math.max(20, Math.round(p.w * k)), height: Math.max(20, Math.round(p.h * k)) };
    };
    const photoRows = files => {
      const pics = (files || []).filter(f => !isVideo(f));
      const cols = pics.length >= 3 ? 3 : pics.length;
      const cw = cols === 3 ? 3253 : cols === 2 ? 4880 : 9760, box = cols === 3 ? [200, 150] : cols === 2 ? [285, 214] : [300, 225];
      const out = [];
      for (let i = 0; i < pics.length; i += cols) {
        const cells = [];
        for (let j = 0; j < cols; j++) {
          const path = pics[i + j];
          let inner;
          if (!path) inner = para([run('')]);
          else if (photos[path] && photos[path].data) {
            const sz = fitBox(photos[path], box[0], box[1]);
            inner = para([new ImageRun({ data: photos[path].data, transformation: sz, type: 'jpg' })], { alignment: AlignmentType.CENTER, keepNext: true });
          } else inner = para([run(R.photos_missing, { italics: true, color: GREY, size: 18 })], { alignment: AlignmentType.CENTER });
          cells.push(cell([inner], { borders: noBorders, width: { size: cw, type: WidthType.DXA }, margins: { top: 60, bottom: 40, left: 60, right: 60 }, verticalAlign: VerticalAlign.CENTER }));
        }
        out.push(row(cells));
      }
      return { rows: out, widths: Array(cols).fill(cw) };
    };
    const videoCount = files => (files || []).filter(isVideo).length;
    const itemBlock = (num, name, sev, note, reading, files) => {
      const IW = 9760;
      const head = table([row([
        cell([para([run(num, { bold: true, color: 'FFFFFF', size: 20 })], { alignment: AlignmentType.CENTER })], { shading: shade(STEEL2), borders: allThin(STEEL2), width: { size: 560, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER }),
        cell([para([run(name, { bold: true, size: 22 })])], { shading: shade(PALE), borders: allThin(PALE), width: { size: IW - 560 - 1700, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER }),
        sevChip(sev, 20)
      ])], [560, IW - 560 - 1700, 1700], { width: { size: IW, type: WidthType.DXA } });
      const inner = [head];
      if (note) inner.push(para([run(note, { size: 20 })], { spacing: { before: 70, after: 30 }, indent: { left: 80 } }));
      if (reading) inner.push(para([run(`${reading.label}: `, { color: GREY, size: 19 }), run(reading.value, { bold: true, size: 20 })], { spacing: { before: 30 }, indent: { left: 80 } }));
      const vc = videoCount(files);
      if (vc) inner.push(para([run(fill(R.videos, vc), { italics: true, color: GREY, size: 18 })], { spacing: { before: 40 }, indent: { left: 80 } }));
      const pr = photoRows(files);
      if (pr.rows.length) inner.push(table(pr.rows, pr.widths, { width: { size: pr.widths.reduce((x, y) => x + y, 0), type: WidthType.DXA }, borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none } }));
      inner.push(para([run('', { size: 2 })]));
      // one row that cannot split: the whole item stays on one page
      return [table([row([cell(inner, { margins: { top: 40, bottom: 20, left: 60, right: 60 }, borders: allThin() })])], [W]), gap(120)];
    };

    const body = [];
    body.push(titleBlock, orangeBar, gap(160), verdictBlock, gap(160), details);
    body.push(h2(R.h_summary), summary, gap(100));
    body.push(para([run(R.h_action, { bold: true, size: 24, color: STEEL })], { spacing: { before: 120, after: 80 }, keepNext: true }), actionBlock);
    if (ins.verdict === 'conditions' && condParas.length) body.push(h2(R.h_cond), ...condParas);
    if (commentParas.length) body.push(h2(R.h_comment), ...commentParas);

    // checklist, grouped by section
    body.push(h2(R.h_check));
    let lastSec = null;
    items.forEach((it, i) => {
      const sec = lab(it, 'section');
      if (sec && sec !== lastSec) {
        lastSec = sec;
        body.push(para([run(sec, { bold: true, size: 24, color: ORANGE })], { spacing: { before: 200, after: 80 }, keepNext: true }));
      }
      const reading = it.reading ? { label: lab(it, 'reading_label') || R.reading, value: `${it.reading} ${it.reading_unit || ''}`.trim() } : null;
      body.push(...itemBlock(String(i + 1), lab(it, 'label'), it.sev, it.note, reading, it.files));
    });
    const oth = others.filter(o => o.note);
    if (oth.length) {
      body.push(h2(R.h_others));
      oth.forEach((o, i) => body.push(...itemBlock('+', fill(R.obs, i + 1), o.sev, o.note, null, o.files)));
    }

    // sign-off
    const sigCell = (title, name) => cell([
      para([run(title, { bold: true, size: 21, color: STEEL })], { spacing: { after: 360 } }),
      para([run(`${R.name}: ${name || ''}`, { size: 20 })], { spacing: { after: 300 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GREY, space: 2 } } }),
      para([run(`${R.sign}:`, { size: 20 })], { spacing: { after: 300 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GREY, space: 3 } } }),
      para([run(`${R.date}:`, { size: 20 })], { border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GREY, space: 1 } } })
    ], { width: { size: W / 2, type: WidthType.DXA }, margins: { top: 140, bottom: 140, left: 200, right: 200 } });
    body.push(h2(R.h_sign), table([row([sigCell(R.by, ins.inspector_name), sigCell(R.recv, '')])], [W / 2, W / 2]));

    const rno = String(ins.id || '').slice(0, 8).toUpperCase();
    return new Document({
      creator: 'CCDC HSE', title: `${R.title} ${ins.tag}`, description: `${typeName} ${ins.tag}`,
      styles: { default: { document: { run: { font: FONT, size: 21 } } } },
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, right: 1000, bottom: 1000, left: 1000, header: 450, footer: 450 } } },
        headers: { default: new Header({ children: [para([run(R.header + '   ', { bold: true, size: 18, color: STEEL2 }), run(`${typeName} ${ins.tag}`, { size: 18, color: GREY })], { border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } } })] }) },
        footers: { default: new Footer({ children: [para([run(`${R.report_no} ${rno}`, { size: 17, color: GREY }), run('\t', { size: 17 }), run(R.page + ' ', { size: 17, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], size: 17, color: GREY, font: FONT }), run(' ' + R.of + ' ', { size: 17, color: GREY }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 17, color: GREY, font: FONT }), run(R.end, { size: 17, color: GREY })], { tabStops: [{ type: TabStopType.RIGHT, position: W }], border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } } })] }) },
        children: body
      }]
    });
  }

  const api = { makeDoc, STR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HSEReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
