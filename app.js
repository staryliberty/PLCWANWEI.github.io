"use strict";

// Teaching model: one S7-1200 digital input, initially stable at 0.
// Filter time, scan interval and scan phase entered here are illustrative values.
const C = { paper: "#f8f9f4", ink: "#183c45", muted: "#566a70", line: "#dfe7e2", orange: "#dc6430", teal: "#008579", tealInk: "#00706a", pale: "#e4f3ec", warm: "#fff0e5" };
// `phase` = when the program takes its first look; the grid is phase, phase+scan, …
const presets = {
  clear: { mode: "compare", first: 3, second: 14, gap: 1, filter: 6, scan: 10, phase: 0 },
  near: { mode: "compare", first: 5.5, second: 6.5, gap: 1, filter: 6, scan: 10, phase: 0 },
  shift: { mode: "compare", first: 5.5, second: 6.5, gap: 1, filter: 6, scan: 10, phase: 2 },
  long: { mode: "compare", first: 12, second: 16, gap: 1, filter: 6, scan: 10, phase: 0 },
  bounce: { mode: "bounce", first: 5, second: 6, gap: 1, filter: 6, scan: 10, phase: 0 }
};
const fields = {
  first: document.querySelector("#first-width"),
  second: document.querySelector("#second-width"),
  gap: document.querySelector("#bounce-gap"),
  filter: document.querySelector("#filter-time"),
  scan: document.querySelector("#scan-time"),
  phase: document.querySelector("#scan-phase")
};
const stage = document.querySelector("#stage");
const outcome = document.querySelector("#outcome");
const runStatus = document.querySelector("#run-status");
const formError = document.querySelector("#form-error");
const note = document.querySelector("#form-note");
const terms = document.querySelector("#terms");
const advanced = document.querySelector("#advanced");
let mode = "compare";
let animation = 0;
let lastModel = null;

// The hint under the parameter grid lives here in one place, so touching a field can no
// longer drop the explanation of the "第一次查看的时刻" parameter.
const NOTE = "ms 是毫秒，1 ms = 千分之一秒。“PLC 等多久才确认”就是手册里的输入滤波时间（填 0 只用于模拟，实机不能设 0）；调小试试干扰会不会混进来，调大试试快速动作会不会被漏掉。“第一次查看的时刻”取 0 到“隔多久看一次”之间。";
const NOTE_ZERO = "“等多久”填 0 表示模拟中不等待；真实 S7-1200 不能设为 0，测一测“调大它会漏掉什么”。“第一次查看的时刻”取 0 到“隔多久看一次”之间。";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value) => Number(value.toFixed(3));
const fmt = (value) => Number.isInteger(value) ? String(value) : value.toFixed(1);
const safe = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const txt = (x, y, value, size = 22, color = C.ink, weight = 400, anchor = "start") => `<text x="${round(x)}" y="${round(y)}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${safe(value)}</text>`;
const line = (x1, y1, x2, y2, color = C.line, width = 2, extra = "") => `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${color}" stroke-width="${width}" ${extra}/>`;
const rect = (x, y, w, h, color, radius = 10, extra = "") => `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${radius}" fill="${color}" ${extra}/>`;

function showPreset(name) {
  const p = presets[name];
  mode = p.mode;
  fields.first.value = p.first;
  fields.second.value = p.second;
  fields.gap.value = p.gap;
  fields.filter.value = p.filter;
  fields.scan.value = p.scan;
  fields.phase.value = p.phase;
  document.querySelector("#first-label").textContent = mode === "bounce" ? "第一次接通多久" : "干扰持续多久";
  document.querySelector("#second-label").textContent = mode === "bounce" ? "再次接通多久" : "真正动作持续多久";
  document.querySelector(".bounce-only").hidden = mode !== "bounce";
  const story = {
    clear: "先来一小段干扰，再来一段真正的动作。",
    near: "两段时间只差一点点，结果还能稳定吗？",
    shift: "信号和等待时间都不变，只把程序第一次查看的时刻挪 2 毫秒。",
    long: "第一段干扰也持续很久，会怎样？",
    bounce: "这仍是同一次按下，中间只短暂断开。"
  };
  document.querySelector(".lab-heading>p").textContent = story[name];
  document.querySelectorAll("[data-preset]").forEach(button => {
    const active = button.dataset.preset === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  markDirty();
}

function markDirty() {
  cancelAnimationFrame(animation);
  animation = 0;
  lastModel = null;
  formError.hidden = true;
  runStatus.textContent = "参数已就绪";
  note.textContent = fields.filter.value.trim() === "0" ? NOTE_ZERO : NOTE;
  outcome.className = "outcome";
  outcome.innerHTML = '<span class="outcome-icon">→</span><p>点击 <strong>看看会发生什么</strong>，查看新参数的结果。</p>';
  stage.innerHTML = drawBlank();
  stage.setAttribute("aria-label", "参数已更改，等待运行实验");
}

function readParameters() {
  const numberIn = input => input.value.trim() === "" ? NaN : Number(input.value);
  const p = {
    mode,
    first: numberIn(fields.first),
    second: numberIn(fields.second),
    gap: numberIn(fields.gap),
    filter: numberIn(fields.filter),
    scan: numberIn(fields.scan),
    phase: numberIn(fields.phase)
  };
  const ranges = [
    [p.first, .5, 40, "第一段持续时间"],
    [p.second, .5, 40, "第二段持续时间"],
    [p.scan, 2, 30, "程序查看间隔"],
    [p.phase, 0, p.scan, "第一次查看的时刻"]
  ];
  if (mode === "bounce") ranges.push([p.gap, .5, 10, "中途断开时间"]);
  for (const [value, min, max, label] of ranges) {
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}请输入 ${min}～${max} ms。`);
  }
  if (!Number.isFinite(p.filter) || (p.filter !== 0 && (p.filter < .5 || p.filter > 20))) {
    throw new Error("PLC 等待确认的时间请输入 0，或 0.5～20 ms。");
  }
  return p;
}

// One integration of the filter rule, shared by the free lab and the guided steps,
// so the two can never drift apart.
function accumulate(rawEvents, filter, end) {
  const accumulator = [{ t: 0, v: 0 }];
  const acceptedEvents = [{ t: 0, v: 0 }];
  let level = 0;
  let accepted = 0;
  for (let index = 0; index < rawEvents.length; index++) {
    const start = rawEvents[index].t;
    const finish = index + 1 < rawEvents.length ? rawEvents[index + 1].t : end;
    const raw = rawEvents[index].v;
    const duration = finish - start;
    if (raw === 1 && level < filter && duration >= filter - level - 1e-8) {
      const crossing = start + filter - level;
      accumulator.push({ t: crossing, v: filter });
      if (accepted !== 1) { accepted = 1; acceptedEvents.push({ t: crossing, v: 1 }); }
    }
    if (raw === 0 && level > 0 && duration >= level - 1e-8) {
      const crossing = start + level;
      accumulator.push({ t: crossing, v: 0 });
      if (accepted !== 0) { accepted = 0; acceptedEvents.push({ t: crossing, v: 0 }); }
    }
    level = clamp(level + (raw ? duration : -duration), 0, filter);
    accumulator.push({ t: finish, v: level });
  }
  accumulator.sort((a, b) => a.t - b.t);
  return { accumulator, acceptedEvents };
}

// The program reads the confirmed signal on a grid: phase, phase + scan, …
function sampleGrid(acceptedEvents, scan, end, phase = 0) {
  const samples = [];
  for (let index = 0; phase + index * scan <= end + 1e-8; index++) {
    const t = round(phase + index * scan);
    samples.push({ t, v: stepValue(acceptedEvents, t) });
  }
  return samples;
}

function buildModel(p) {
  const firstStart = 4;
  const firstEnd = firstStart + p.first;
  const secondStart = p.mode === "bounce" ? firstEnd + p.gap : firstEnd + Math.max(p.filter * 2 + 4, 9);
  const secondEnd = secondStart + p.second;
  const end = Math.ceil((secondEnd + p.filter + p.scan * 1.7 + 5) / 5) * 5;
  const rawEvents = [
    { t: 0, v: 0 },
    { t: firstStart, v: 1 },
    { t: firstEnd, v: 0 },
    { t: secondStart, v: 1 },
    { t: secondEnd, v: 0 }
  ];
  const shape = { p, end, firstStart, firstEnd, secondStart, secondEnd, rawEvents };
  if (p.filter === 0) {
    // Teaching special case: nothing to wait for, the confirmed signal follows the field input.
    const acceptedEvents = rawEvents.map(event => ({ ...event }));
    return { ...shape, accumulator: [{ t: 0, v: 0 }], acceptedEvents, samples: sampleGrid(acceptedEvents, p.scan, end, p.phase) };
  }
  const { accumulator, acceptedEvents } = accumulate(rawEvents, p.filter, end);
  return { ...shape, accumulator, acceptedEvents, samples: sampleGrid(acceptedEvents, p.scan, end, p.phase) };
}

function stepValue(events, time) {
  let value = 0;
  for (const event of events) {
    if (event.t > time + 1e-8) break;
    value = event.v;
  }
  return value;
}

function accumulatorAt(points, time) {
  if (time <= 0) return 0;
  let previous = points[0];
  for (let index = 1; index < points.length; index++) {
    const next = points[index];
    if (next.t >= time) {
      if (next.t === previous.t) return next.v;
      const fraction = (time - previous.t) / (next.t - previous.t);
      return previous.v + fraction * (next.v - previous.v);
    }
    previous = next;
  }
  return previous.v;
}

function stepPath(events, now, low, high, x) {
  let d = `M${round(x(0))} ${low}`;
  for (const event of events) {
    if (event.t <= 0 || event.t > now) continue;
    d += `H${round(x(event.t))}V${event.v ? high : low}`;
  }
  return `${d}H${round(x(now))}`;
}

function accumulationPath(model, now, x) {
  if (model.p.filter === 0) return "";
  const y = value => 326 - value / model.p.filter * 44;
  let d = `M${round(x(0))} ${y(0)}`;
  for (const point of model.accumulator) {
    if (point.t <= 0 || point.t > now) continue;
    d += `L${round(x(point.t))} ${round(y(point.v))}`;
  }
  d += `L${round(x(now))} ${round(y(accumulatorAt(model.accumulator, now)))}`;
  return d;
}

function stageCaption(model, now) {
  if (model.p.filter === 0) return "不等待确认：现场一变，第三行就跟着变。";
  if (now < model.firstStart) return "现场还没有变化，确认进度从 0 开始。";
  if (now < model.firstEnd) return model.p.mode === "bounce" ? "第一次接通：确认进度向上走。" : "干扰来了：确认进度向上走。";
  if (now < model.secondStart) return "现场回到 0，确认进度往回退。";
  if (now < model.secondEnd) return model.p.mode === "bounce" ? "再次接通：从剩下的进度继续走。" : "真正的动作来了：这次能走满吗？";
  return "进度走满才确认 1；退回 0 才确认 0。";
}

function svgFrame(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" style="font-family:LessonSans,'Noto Sans SC',sans-serif">${body}</svg>`;
}

function baseFrame(title, status) {
  let body = rect(0, 0, 1200, 630, C.paper, 0);
  body += txt(68, 52, "PLC 应用技术", 21, C.muted, 500);
  body += txt(1132, 52, "PLC 信号入门 · 教学示意", 20, C.muted, 400, "end");
  body += txt(68, 111, title, 37, C.ink, 700);
  body += txt(1132, 111, status, 22, C.teal, 650, "end");
  body += line(68, 145, 1132, 145, C.line, 2);
  return body;
}

function drawBlank() {
  let body = baseFrame("程序最后会看见什么？", "等待运行");
  const rows = [["现场信号", "实际的 0 / 1"], ["确认进度", "短变化可能退回去"], ["PLC 确认的信号", "走满后才改变"], ["程序记住的值", "下次看前不变"]];
  rows.forEach((row, index) => {
    const low = 235 + index * 91;
    body += txt(83, low - 23, row[0], 23, index === 0 ? C.orange : C.ink, 650);
    body += txt(83, low + 7, row[1], 16, C.muted);
    body += line(340, low, 1020, low, C.line, 2);
  });
  body += rect(350, 271, 660, 65, "#edf3ec", 12);
  body += txt(680, 311, "填好数字，点击“看看会发生什么”", 25, C.teal, 600, "middle");
  body += rect(68, 570, 1064, 50, C.ink, 12);
  body += txt(600, 603, "先猜一猜：第一段短变化会进程序吗？", 22, "#ffffff", 500, "middle");
  return svgFrame(body);
}

function drawModel(model, fraction) {
  const now = model.end * clamp(fraction, 0, 1);
  const x = time => 340 + time / model.end * 680;
  const levels = [235, 326, 417, 508];
  const raw = stepValue(model.rawEvents, now);
  const accumulated = accumulatorAt(model.accumulator, now);
  const filtered = stepValue(model.acceptedEvents, now);
  const input = stepValue(model.samples, now);
  let body = baseFrame("程序最后会看见什么？", `${fmt(now)} ms`);
  const noFilter = model.p.filter === 0;
  const rows = [
    ["现场信号", model.p.mode === "bounce" ? "一次按下，中途抖动" : "先干扰 · 后真正动作", raw, C.orange],
    ["确认进度", noFilter ? "不等待确认" : `走满 ${fmt(model.p.filter)} ms 才确认`, noFilter ? "跳过" : `${accumulated.toFixed(1)} / ${fmt(model.p.filter)}`, C.orange],
    ["PLC 确认的信号", noFilter ? "直接跟随现场" : "进度走满才变 1", filtered, C.teal],
    ["程序记住的值", `每隔 ${fmt(model.p.scan)} ms 看一次`, input, C.teal]
  ];
  rows.forEach((row, index) => {
    const low = levels[index];
    body += txt(83, low - 23, row[0], 23, index === 0 ? C.orange : C.ink, 650);
    body += txt(83, low + 7, row[1], 16, C.muted);
    if (index !== 1) body += line(340, low - 40, 1020, low - 40, C.line, 1);
    body += line(340, low, 1020, low, C.line, index === 1 ? 1 : 1.5);
    if (index !== 1) {
      body += txt(321, low - 32, "1", 15, C.muted, 400, "end");
      body += txt(321, low + 7, "0", 15, C.muted, 400, "end");
    }
    const active = row[2] === 1 || (index === 1 && !noFilter && accumulated >= model.p.filter);
    body += rect(1053, low - 57, 78, 67, active ? (index === 0 ? C.warm : C.pale) : "#edf1eb", 12);
    body += txt(1092, low - 9, String(row[2]), index === 1 ? 17 : 42, active ? row[3] : C.muted, 700, "middle");
  });

  // Vertical scan marks are distinct from the continuously changing filter accumulator.
  // The last time label can sit at the axis end, so the unit lives in the legend instead
  // of a separate "ms" string that would collide with it.
  const labelStep = Math.max(1, Math.ceil(model.samples.length / 7));
  model.samples.forEach((sample, index) => {
    const px = x(sample.t);
    body += line(px, 179, px, 525, "#cadbd2", 1.2, 'stroke-dasharray="3 8"');
    if (sample.t <= now + 1e-8) body += `<circle cx="${round(px)}" cy="${sample.v ? 468 : 508}" r="5" fill="${sample.v ? C.teal : "#9eb7aa"}" stroke="${C.paper}" stroke-width="2"/>`;
    if (index % labelStep === 0) body += txt(px, 553, fmt(sample.t), 14, C.muted, 400, "middle");
  });
  body += txt(340, 175, "竖线 = PLC 看一眼的时刻（横轴单位 ms）", 16, C.muted);
  if (!noFilter) {
    body += line(340, 282, 1020, 282, "#9bc7b3", 1.5, 'stroke-dasharray="5 8"');
    body += txt(1020, 279, "走满", 15, C.teal, 600, "end");
  } else {
    body += line(340, 326, 1020, 326, C.orange, 3, 'stroke-dasharray="8 10"');
    body += txt(680, 310, "不等待 · 直接进入下一关", 19, C.orange, 600, "middle");
  }

  body += `<path d="${stepPath(model.rawEvents, now, 235, 195, x)}" fill="none" stroke="${C.orange}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (!noFilter) body += `<path d="${accumulationPath(model, now, x)}" fill="none" stroke="${C.orange}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  body += `<path d="${stepPath(model.acceptedEvents, now, 417, 377, x)}" fill="none" stroke="${C.teal}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  body += `<path d="${stepPath(model.samples, now, 508, 468, x)}" fill="none" stroke="${C.teal}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const cursor = x(now);
  body += line(cursor, 183, cursor, 525, "#82a69b", 2, 'stroke-dasharray="6 8" opacity=".75"');
  body += `<circle cx="${round(cursor)}" cy="183" r="6" fill="${C.teal}"/>`;
  body += rect(68, 570, 1064, 50, C.ink, 12);
  body += txt(600, 603, stageCaption(model, now), 22, "#ffffff", 500, "middle");
  return svgFrame(body);
}

// Width of the narrowest confirmed-1 interval, or null if nothing was confirmed.
function narrowestConfirmed(acceptedEvents, end) {
  let start = null;
  let narrowest = null;
  const note = width => { narrowest = narrowest === null ? width : Math.min(narrowest, width); };
  for (const event of acceptedEvents) {
    if (event.v === 1) start = event.t;
    else if (start !== null) { note(event.t - start); start = null; }
  }
  if (start !== null) note(end - start);
  return narrowest;
}

function showOutcome(model) {
  const filteredHigh = model.acceptedEvents.filter(event => event.v === 1);
  const firstPassed = filteredHigh.some(event => event.t >= model.firstStart - 1e-8 && event.t <= model.firstEnd + 1e-8);
  const secondPassed = filteredHigh.some(event => event.t >= model.secondStart - 1e-8 && event.t <= model.secondEnd + 1e-8);
  const firstRead = model.samples.some(sample => sample.v === 1 && sample.t >= model.firstStart && sample.t < model.secondStart);
  const secondRead = model.samples.some(sample => sample.v === 1 && sample.t >= model.secondStart);
  let title;
  let detail;
  let kind;
  if (model.p.filter === 0) {
    title = "不等待：现场一变，PLC 就确认。";
    detail = model.p.mode === "bounce"
      ? `抖动也直接进入下一关；程序${firstRead || secondRead ? "看到过 1" : "没有看到 1"}。`
      : `两段变化都进入下一关；程序${firstRead ? "看到了前段" : "没看到前段"}，${secondRead ? "看到了后段" : "没看到后段"}。`;
    kind = "warn";
  } else if (model.p.mode === "bounce") {
    const got = secondPassed || firstPassed;
    title = got ? "短暂断开，进度只退一点又走满。" : "这次抖动没有让进度走满。";
    detail = `PLC ${got ? "确认了 1" : "还没确认 1"}；程序${firstRead || secondRead ? "在一次查看中读到了 1" : "几次查看都没有读到 1"}。`;
    kind = got && (firstRead || secondRead) ? "good" : "warn";
  } else if (!firstPassed && secondPassed) {
    title = "短干扰被拦住了。";
    detail = `真正的动作被确认；程序${secondRead ? "也看到了 1" : "这次却没看到 1"}。`;
    kind = secondRead ? "good" : "warn";
    const margin = Math.min(model.p.filter - model.p.first, model.p.second - model.p.filter);
    if (margin < 1.2) detail += " 两段时间太接近，现实中可能不稳定。";
  } else if (firstPassed && secondPassed) {
    title = "干扰也被当成了真变化。";
    detail = `它持续得够久，PLC 也确认了它；程序${firstRead ? "这次看到了它" : "这次没看到它"}。`;
    kind = "warn";
  } else if (!firstPassed && !secondPassed) {
    title = "真正的动作也没被确认。";
    detail = "等待时间太长，或动作太短；程序看不到这次变化。";
    kind = "warn";
  } else {
    title = "第一段被确认，第二段没有。";
    detail = "试着改变两段持续的时间，再看结果。";
    kind = "warn";
  }
  if (model.p.mode === "compare" && model.p.first >= model.p.scan && model.p.second >= model.p.scan) {
    detail += " 两段都长于查看间隔；只改查看间隔分不清真假。";
  }
  let why;
  let name;
  if (model.p.filter === 0) {
    why = "本图把等待设为 0，所以现场一变就进入已确认状态；程序仍只在查看竖线处取值。";
    name = "输入滤波：先确认变化是否够久。这里的 0 只用于教学模拟，不是 S7-1200 的实际可选值。";
  } else if (model.p.mode === "bounce") {
    why = "短暂断开会让确认进度往回退；再接通时又向上走，是否走满取决于两段接通和中间断开的时间。";
    name = "接点抖动：一次按下中出现短暂的“通—断—通”；输入滤波会处理这段变化。";
  } else if (!firstPassed && secondPassed) {
    why = `短干扰没让确认进度走满，后一次动作走满了。${secondRead ? "查看竖线碰到已确认的 1，程序因此记住 1。" : "已确认的 1 落在两次查看之间，程序因此错过。"}`;
    name = "输入滤波：先判断变化够不够久。扫描读取：程序每轮再取一次已确认状态。";
  } else if (firstPassed && secondPassed) {
    why = "两段变化都让确认进度走满；PLC 只能按信号和时间判断，无法知道哪段是干扰。";
    name = "输入滤波：拦住过短变化，但不能识别信号的真实意图。";
  } else if (!firstPassed && !secondPassed) {
    why = "两段变化都在确认进度走满前结束，PLC 便一直没有确认 1。";
    name = "输入滤波：等得太久也可能漏掉真正的短动作。";
  } else {
    why = "前后两段持续时间与设定的等待时间不同，只有第一段让确认进度走满。";
    name = "输入滤波：是否确认取决于信号持续多久和设定的确认时间。";
  }
  // A confirmed 1 lasts long enough that reading it is guaranteed once that interval
  // is at least as wide as the scan interval; narrower intervals are decided by timing luck.
  const narrowest = narrowestConfirmed(model.acceptedEvents, model.end);
  if (model.p.filter > 0 && narrowest !== null && narrowest < model.p.scan) {
    const missedConfirmed = (firstPassed && !firstRead) || (secondPassed && !secondRead);
    if (missedConfirmed) {
      why += ` 已确认的 1 最窄只有 ${fmt(narrowest)} ms，比 ${fmt(model.p.scan)} ms 的查看间隔还窄；读到与否只取决于查看时刻是否正好落在里面。`;
    } else {
      why += ` 已确认的 1 最窄只有 ${fmt(narrowest)} ms，比查看间隔窄；这次查看刚好落在里面，把“第一次查看的时刻”挪一挪，可能就读不到了。`;
    }
  }
  outcome.className = `outcome ${kind}`;
  outcome.innerHTML = `<span class="outcome-icon">${kind === "good" ? "✓" : "!"}</span><div class="outcome-copy"><p><strong>看到：${safe(title)}</strong> ${safe(detail)}</p><p><b>为什么：</b>${safe(why)}</p><p><b>它叫：</b>${safe(name)}</p></div>`;
  runStatus.textContent = "观察完成";
  stage.setAttribute("aria-label", `${title} ${detail}`);
  terms.hidden = false;
  advanced.hidden = false;
}

function runExperiment(event) {
  event.preventDefault();
  let p;
  try { p = readParameters(); }
  catch (error) { formError.textContent = error.message; formError.hidden = false; return; }
  formError.hidden = true;
  cancelAnimationFrame(animation);
  lastModel = buildModel(p);
  runStatus.textContent = "正在展开波形…";
  outcome.className = "outcome";
  outcome.innerHTML = p.filter === 0
    ? '<span class="outcome-icon">···</span><p>不等待确认时，看看程序能看见哪一段。</p>'
    : '<span class="outcome-icon">···</span><p>看第二行：确认进度会走满吗？</p>';
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) { stage.innerHTML = drawModel(lastModel, 1); showOutcome(lastModel); return; }
  const duration = 4700;
  const started = performance.now();
  const frame = now => {
    const fraction = clamp((now - started) / duration, 0, 1);
    stage.innerHTML = drawModel(lastModel, fraction);
    if (fraction < 1) animation = requestAnimationFrame(frame);
    else { animation = 0; showOutcome(lastModel); }
  };
  animation = requestAnimationFrame(frame);
}

document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => showPreset(button.dataset.preset)));
Object.values(fields).forEach(input => input.addEventListener("input", () => {
  document.querySelectorAll("[data-preset]").forEach(button => { button.classList.remove("active"); button.setAttribute("aria-pressed", "false"); });
  markDirty();
}));
document.querySelector("#experiment-form").addEventListener("submit", runExperiment);
stage.innerHTML = drawBlank();

// A guided path introduces one idea at a time before the free parameter lab.
document.querySelector(".guided").after(terms);
const guided = {
  step: 0,
  pick: "tap",
  shift: 1,
  guess: null,
  tapAndHold: new Set(),
  scanOutcomes: new Set(),
  bounceDone: false,
  unlocked: 0,
  animation: 0
};
const guideChart = document.querySelector("#guide-chart");
const guideResult = document.querySelector("#guide-result");
const guideHint = document.querySelector("#guide-hint");
const guideNext = document.querySelector("#guide-next");
const guideRun = document.querySelector("#guide-run");
const guideConcept = document.querySelector("#guide-concept");

function guideModel() {
  const step = guided.step;
  const width = guided.pick === "tap" ? 3 : 14;
  const start = step === 1 ? guided.shift : 4;
  const rawEvents = step === 2
    ? [{ t: 0, v: 0 }, { t: 4, v: 1 }, { t: 9, v: 0 }, { t: 10, v: 1 }, { t: 20, v: 0 }]
    : [{ t: 0, v: 0 }, { t: start, v: 1 }, { t: start + (step === 1 ? 7 : width), v: 0 }];
  const end = step === 0 ? 30 : 32;
  const filter = 6;
  const scan = 10;
  const { accumulator, acceptedEvents } = accumulate(rawEvents, filter, end);
  return { rawEvents, accumulator, acceptedEvents, samples: sampleGrid(acceptedEvents, scan, end), end, filter, scan };
}

function guideProgressPath(model, now, x, base) {
  const y = value => base - value / model.filter * 48;
  let d = `M${round(x(0))} ${base}`;
  for (const point of model.accumulator) {
    if (point.t <= 0 || point.t > now) continue;
    d += `L${round(x(point.t))} ${round(y(point.v))}`;
  }
  return d + `L${round(x(now))} ${round(y(accumulatorAt(model.accumulator, now)))}`;
}

function drawGuide(model, fraction = 1, reveal = false) {
  const first = guided.step === 0;
  const height = first ? 365 : 540;
  const now = reveal ? model.end * clamp(fraction, 0, 1) : model.end;
  const x = time => 230 + time / model.end * 690;
  const rows = first
    ? [["现场信号", 165], ["确认进度", 295]]
    : [["现场信号", 160], ["确认进度", 265], ["PLC 已确认", 370], ["程序记住", 475]];
  let body = rect(0, 0, 1000, height, C.paper, 0);
  body += txt(35, 48, "0 = 没信号　1 = 有信号", 19, C.ink, 650);
  body += txt(945, 48, "时间向右走 →", 17, C.muted, 500, "end");
  if (!first) {
    model.samples.forEach(sample => {
      body += line(x(sample.t), 87, x(sample.t), 505, "#cbded0", 1.5, 'stroke-dasharray="4 8"');
      body += txt(x(sample.t), 518, String(sample.t), 13, C.muted, 400, "middle");
    });
    body += txt(230, 81, "竖线 = PLC 看一眼", 15, C.muted);
  }
  rows.forEach(([name, base], index) => {
    body += txt(35, base - 25, name, 23, index === 0 ? C.orange : C.ink, 700);
    body += line(230, base, 920, base, C.line, 2);
    if (index !== 1) body += line(230, base - 43, 920, base - 43, C.line, 1);
  });
  body += `<path d="${stepPath(model.rawEvents, now, rows[0][1], rows[0][1] - 43, x)}" fill="none" stroke="${C.orange}" stroke-width="6" stroke-linejoin="round"/>`;
  if (reveal) {
    body += line(230, rows[1][1] - 48, 920, rows[1][1] - 48, "#9bc7b3", 1.5, 'stroke-dasharray="5 8"');
    body += txt(920, rows[1][1] - 54, "走满", 15, C.teal, 600, "end");
    body += `<path d="${guideProgressPath(model, now, x, rows[1][1])}" fill="none" stroke="${C.orange}" stroke-width="6" stroke-linejoin="round"/>`;
    if (!first) {
      body += `<path d="${stepPath(model.acceptedEvents, now, rows[2][1], rows[2][1] - 43, x)}" fill="none" stroke="${C.teal}" stroke-width="6" stroke-linejoin="round"/>`;
      body += `<path d="${stepPath(model.samples, now, rows[3][1], rows[3][1] - 43, x)}" fill="none" stroke="${C.teal}" stroke-width="6" stroke-linejoin="round"/>`;
      model.samples.filter(sample => sample.t <= now + 1e-8).forEach(sample => {
        body += `<circle cx="${round(x(sample.t))}" cy="${sample.v ? rows[3][1] - 43 : rows[3][1]}" r="4" fill="${C.teal}"/>`;
      });
    }
    body += line(x(now), 92, x(now), first ? 320 : 495, "#8caea2", 2, 'stroke-dasharray="5 8"');
  } else {
    body += txt(575, rows[1][1] - 12, "先猜，再看这里怎样变化", 19, C.muted, 550, "middle");
    if (!first) body += txt(575, rows[3][1] - 11, "程序会记住什么？", 19, C.muted, 550, "middle");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height}" width="1000" height="${height}" role="img" style="font-family:LessonSans,'Noto Sans SC',sans-serif">${body}</svg>`;
}

function resetGuidePreview() {
  cancelAnimationFrame(guided.animation);
  guided.animation = 0;
  guided.guess = null;
  guideHint.textContent = "";
  guideResult.className = "guide-result";
  guideResult.textContent = "先猜，再点“揭晓结果”。";
  guideChart.innerHTML = drawGuide(guideModel());
  document.querySelectorAll("#guide-answers button").forEach(button => {
    button.classList.remove("selected");
    button.setAttribute("aria-pressed", "false");
  });
}

// Respect the motion preference for programmatic scrolling too (CSS only covers native scrolling).
function scrollToElement(element) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

function updateGuideNavigation() {
  const step = guided.step;
  const complete = step === 0 ? guided.tapAndHold.size === 2 : step === 1 ? guided.scanOutcomes.size === 2 : guided.bounceDone;
  guideNext.disabled = !complete;
  guideNext.textContent = step === 2 ? "回看整条路 →" : "下一次实验 →";
  document.querySelector("#guide-progress").textContent = step === 0
    ? `轻点与按住：已试 ${guided.tapAndHold.size} / 2`
    : step === 1 ? `不同位置：已看到 ${guided.scanOutcomes.size} 种结果 / 2` : guided.bounceDone ? "三次小实验已完成" : "运行一次，看看进度怎么走";
  document.querySelectorAll("[data-guide-step]").forEach(button => {
    const index = Number(button.dataset.guideStep);
    button.disabled = index > guided.unlocked;
    button.classList.toggle("active", index === step);
    if (index === step) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
}

function renderGuideStep() {
  const step = guided.step;
  cancelAnimationFrame(guided.animation);
  const kicker = ["第 1 次 · 先看确认过程", "第 2 次 · 再看读取时机", "第 3 次 · 最后看一次抖动"];
  const titles = ["轻点一下，和按住一会儿，会一样吗？", "同样长的信号，换个时机会怎样？", "一次按下，中间短暂断开会怎样？"];
  const descriptions = [
    "先试“轻点”，再试“按住”。这一步只看现场和 PLC 的确认进度。",
    "信号持续时间不变。左右挪一挪，再看程序会不会看见。",
    "这仍是同一次按下，只是中间短暂断开。观察确认进度会不会清零。"
  ];
  document.querySelector("#guide-kicker").textContent = kicker[step];
  document.querySelector("#guide-title").textContent = titles[step];
  document.querySelector("#guide-description").textContent = descriptions[step];
  guideConcept.hidden = step !== 0;
  const controls = document.querySelector("#guide-controls");
  if (step === 0) {
    controls.innerHTML = `<button type="button" data-guide-pick="tap" class="${guided.pick === "tap" ? "selected" : ""}" aria-pressed="${guided.pick === "tap"}">轻点一下 · 3 毫秒</button><button type="button" data-guide-pick="hold" class="${guided.pick === "hold" ? "selected" : ""}" aria-pressed="${guided.pick === "hold"}">按住一会儿 · 14 毫秒</button>`;
    controls.querySelectorAll("[data-guide-pick]").forEach(button => button.addEventListener("click", () => {
      guided.pick = button.dataset.guidePick;
      renderGuideStep();
    }));
  } else if (step === 1) {
    controls.innerHTML = `<button type="button" data-shift="1">靠左</button><label>向右挪信号 <input id="guide-shift" type="range" min="1" max="6" step="1" value="${guided.shift}"><output id="guide-shift-value">从 ${guided.shift} ms 开始</output></label><button type="button" data-shift="6">靠右</button><small>ms 是毫秒，1 ms = 千分之一秒</small>`;
    const slider = controls.querySelector("#guide-shift");
    slider.addEventListener("input", () => {
      guided.shift = Number(slider.value);
      controls.querySelector("#guide-shift-value").textContent = `从 ${guided.shift} ms 开始`;
      resetGuidePreview();
    });
    controls.querySelectorAll("[data-shift]").forEach(button => button.addEventListener("click", () => {
      guided.shift = Number(button.dataset.shift);
      slider.value = guided.shift;
      controls.querySelector("#guide-shift-value").textContent = `从 ${guided.shift} ms 开始`;
      resetGuidePreview();
    }));
  } else {
    controls.innerHTML = '<span class="signal-key">接通 → 短暂断开 → 再接通</span>';
  }
  const question = ["PLC 会确认这次变化吗？", "程序会看见这次变化吗？", "短暂断开会让进度直接回到 0 吗？"];
  const choices = step === 2 ? [["reset", "会清零"], ["partial", "只退一点"], ["unsure", "还不确定"]]
    : [["yes", step === 0 ? "会确认" : "会看见"], ["no", step === 0 ? "不会确认" : "看不见"], ["unsure", "还不确定"]];
  document.querySelector("#guide-question").textContent = question[step];
  const answers = document.querySelector("#guide-answers");
  answers.innerHTML = choices.map(([value, label]) => `<button type="button" data-guess="${value}" aria-pressed="false">${label}</button>`).join("");
  answers.querySelectorAll("[data-guess]").forEach(button => button.addEventListener("click", () => {
    guided.guess = button.dataset.guess;
    answers.querySelectorAll("button").forEach(item => {
      const on = item === button;
      item.classList.toggle("selected", on);
      item.setAttribute("aria-pressed", String(on));
    });
    guideHint.textContent = "";
  }));
  resetGuidePreview();
  updateGuideNavigation();
}

function revealGuidedResult(model) {
  const step = guided.step;
  const confirmed = model.acceptedEvents.some(event => event.v === 1);
  const seen = model.samples.some(sample => sample.v === 1);
  const answer = step === 2 ? "partial" : step === 0 ? (confirmed ? "yes" : "no") : (seen ? "yes" : "no");
  const verdict = guided.guess === "unsure" ? "一起来看结果" : guided.guess === answer ? "你猜对了" : "再看一次图";
  let observed;
  let reason;
  let name;
  if (step === 0) {
    guided.tapAndHold.add(guided.pick);
    observed = confirmed ? "按住后，确认进度走满，PLC 才确认输入是 1。" : "轻点后，确认进度没走满，PLC 仍认为输入是 0。";
    reason = confirmed
      ? "按下的时间够长，确认条持续上升并到顶；松开后，它才开始往回退。"
      : "按下时确认条刚往上走，按钮就松开了；进度退回去，没机会走到顶。";
    name = "输入滤波：信号稳定保持够久才被承认，短于确认时间 T 的跳变直接被忽略。";
  } else if (step === 1) {
    guided.scanOutcomes.add(seen);
    observed = seen ? "这次程序记住了 1。" : "这次 PLC 确认过 1，程序却始终记着 0。";
    reason = seen
      ? "查看的竖线碰到了“已确认 = 1”的时段，所以这一轮程序读到 1。"
      : "“已确认 = 1”的时段夹在两条查看竖线之间，程序每次查看都只看到 0。";
    name = "扫描读取：PLC 每轮取一次已确认的输入。输入 I：程序这一轮使用的 0 或 1，下一次读取前保持不变。";
  } else {
    guided.bounceDone = true;
    observed = `中间断开了一下，确认进度只退一点，随后又走满；程序${seen ? "在一次查看时读到了这次 1" : "几次查看都错过了这次 1"}。`;
    reason = "信号变回 0 时，确认条往回走；但断开的时间太短，还没退到 0 就再次接通。";
    name = "接点抖动：一次按下时，接点短暂出现“通—断—通”。输入滤波按这段变化继续确认。";
    terms.hidden = false;
    advanced.hidden = false;
    document.querySelector(".lab").hidden = false;
  }
  guideResult.className = `guide-result ${guided.guess === answer ? "good" : "warn"}`;
  guideResult.innerHTML = `<strong class="guide-result-head">${safe(verdict)}</strong><div class="guide-explain"><span>看到</span><p>${safe(observed)}</p><span>为什么</span><p>${safe(reason)}</p><span>它叫</span><p>${safe(name)}</p></div>`;
  guideChart.setAttribute("aria-label", `${observed} ${reason}`);
  guided.unlocked = Math.max(guided.unlocked, step === 0 && guided.tapAndHold.size === 2 ? 1 : step === 1 && guided.scanOutcomes.size === 2 ? 2 : guided.unlocked);
  updateGuideNavigation();
}

guideRun.addEventListener("click", () => {
  if (!guided.guess) { guideHint.textContent = "先选一个预测；不确定也可以选。"; return; }
  cancelAnimationFrame(guided.animation);
  const model = guideModel();
  guideHint.textContent = "";
  guideResult.className = "guide-result";
  guideResult.textContent = "信号正在向前走…";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) { guideChart.innerHTML = drawGuide(model, 1, true); revealGuidedResult(model); return; }
  const began = performance.now();
  const frame = now => {
    const fraction = clamp((now - began) / 3200, 0, 1);
    guideChart.innerHTML = drawGuide(model, fraction, true);
    if (fraction < 1) guided.animation = requestAnimationFrame(frame);
    else { guided.animation = 0; revealGuidedResult(model); }
  };
  guided.animation = requestAnimationFrame(frame);
});

guideNext.addEventListener("click", () => {
  if (guideNext.disabled) return;
  if (guided.step < 2) {
    guided.step += 1;
    renderGuideStep();
    document.querySelector("#guide-title").focus({ preventScroll: true });
    scrollToElement(document.querySelector(".guided"));
  } else {
    scrollToElement(terms);
  }
});
document.querySelectorAll("[data-guide-step]").forEach(button => button.addEventListener("click", () => {
  const target = Number(button.dataset.guideStep);
  if (target > guided.unlocked) return;
  guided.step = target;
  renderGuideStep();
}));
renderGuideStep();
