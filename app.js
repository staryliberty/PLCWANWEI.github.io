(() => {
  const $ = (id) => document.getElementById(id);
  const ids = ['raw', 'filtered', 'normal', 'caught'];
  const colors = ['#e46835', '#dc9a31', '#137f79', '#14565d'];
  const inputs = {
    width: $('pulse-width'),
    start: $('pulse-start'),
    filter: $('filter-time'),
    scan: $('scan-time')
  };
  const limits = {
    width: ['脉冲宽度', 0.1, 40],
    start: ['到来时刻', 0, 40],
    filter: ['滤波时间', 0, 20],
    scan: ['扫描周期', 1, 40]
  };
  const emit = $('emit');
  const result = document.querySelector('.result');
  const explanation = $('explanation');
  const counts = [$('filtered-count'), $('normal-count'), $('caught-count')];
  const motionReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frame = 0;
  let current = null;

  const fmt = (n) => String(Number(n.toPrecision(6)));
  const x = (t, total) => Math.max(0, Math.min(1000, t / total * 1000));
  const y = (v) => v ? 12 : 42;

  function readSettings() {
    const values = {};
    for (const [key, input] of Object.entries(inputs)) {
      const [label, low, high] = limits[key];
      const value = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(value) || value < low || value > high) {
        return { error: label + '请输入 ' + fmt(low) + '～' + fmt(high) + ' ms。' };
      }
      values[key] = value;
    }
    return values;
  }

  function simulate(p) {
    const rawEnd = p.start + p.width;
    const passed = p.width >= p.filter - 1e-9;
    const filteredStart = passed ? p.start + p.filter : Infinity;
    const filteredEnd = passed ? rawEnd + p.filter : Infinity;
    const total = Math.max(4 * p.scan, Math.ceil((rawEnd + p.filter + 2 * p.scan) / p.scan) * p.scan);
    const regular = [];
    const caught = [];
    let regularSeen = false;
    let caughtSeen = false;

    for (let t = 0; t <= total + 1e-9; t += p.scan) {
      const normalValue = passed && t >= filteredStart - 1e-9 && t < filteredEnd - 1e-9 ? 1 : 0;
      const previous = t - p.scan;
      const edgeSinceLastRead = passed && filteredStart > previous + 1e-9 && filteredStart <= t + 1e-9;
      const caughtValue = normalValue || edgeSinceLastRead ? 1 : 0;
      regular.push({ t, v: normalValue });
      caught.push({ t, v: caughtValue });
      regularSeen ||= Boolean(normalValue);
      caughtSeen ||= Boolean(caughtValue);
    }
    return { ...p, rawEnd, passed, filteredStart, filteredEnd, total, regular, caught, regularSeen, caughtSeen };
  }

  function squareEvents(start, end, total) {
    return start < total ? [{ t: start, v: 1 }, { t: Math.min(end, total), v: 0 }] : [];
  }

  function pathFor(events, total, low = 42, high = 12) {
    let path = 'M 0 ' + low;
    let value = 0;
    for (const event of events) {
      if (event.t < 0 || event.t > total || event.v === value) continue;
      const px = x(event.t, total);
      path += ' L ' + px + ' ' + (value ? high : low) + ' L ' + px + ' ' + (event.v ? high : low);
      value = event.v;
    }
    return path + ' L 1000 ' + (value ? high : low);
  }

  function filterCharge(t, s) {
    if (s.filter === 0 || t <= s.start) return 0;
    if (t <= s.rawEnd) return Math.min(s.filter, t - s.start);
    return Math.max(0, Math.min(s.filter, s.width) - (t - s.rawEnd));
  }

  function chargeGeometry(s) {
    if (s.filter === 0) return null;
    const base = 41;
    const peak = Math.min(s.filter, s.width);
    const top = base - 34 * peak / s.filter;
    const start = x(s.start, s.total);
    const riseEnd = x(s.start + peak, s.total);
    const highEnd = x(s.rawEnd, s.total);
    const fallEnd = x(s.rawEnd + peak, s.total);
    const line = 'M 0 ' + base + ' L ' + start + ' ' + base +
      ' L ' + riseEnd + ' ' + top + ' L ' + highEnd + ' ' + top +
      ' L ' + fallEnd + ' ' + base + ' L 1000 ' + base;
    const area = 'M ' + start + ' ' + base + ' L ' + riseEnd + ' ' + top +
      ' L ' + highEnd + ' ' + top + ' L ' + fallEnd + ' ' + base + ' Z';
    return { line, area };
  }

  function setReadout(time, s, highest = false) {
    const charge = highest ? Math.min(s.filter, s.width) : filterCharge(time, s);
    $('meter-text').textContent = s.filter === 0
      ? '0 ms：跳过滤波'
      : (highest ? '最高 ' : '当前 ') + fmt(charge) + ' / ' + fmt(s.filter) + ' ms';
  }

  function render(s) {
    const timelines = [
      squareEvents(s.start, s.rawEnd, s.total),
      s.passed ? squareEvents(s.filteredStart, s.filteredEnd, s.total) : [],
      s.regular,
      s.caught
    ];
    ids.forEach((id, index) => {
      const filterRow = index === 1;
      const height = filterRow ? 84 : 52;
      const grid = [];
      for (let t = s.scan; t < s.total; t += s.scan) {
        const px = x(t, s.total);
        grid.push('<line class="grid" x1="' + px + '" x2="' + px + '" y1="0" y2="' + height + '"/>');
      }
      const dots = index === 2 || index === 3
        ? (index === 2 ? s.regular : s.caught)
          .filter((sample) => sample.t > 0 && sample.t < s.total)
          .map((sample) => '<line class="sample-dot" x1="' + x(sample.t, s.total) + '" x2="' + x(sample.t, s.total) + '" y1="' + (y(sample.v) - .5) + '" y2="' + (y(sample.v) + .5) + '"/>').join('')
        : '';
      const charge = filterRow ? chargeGeometry(s) : null;
      const waveContent = filterRow
        ? '<line class="threshold" x1="0" x2="1000" y1="7" y2="7"/>' +
          '<line class="band-line" x1="0" x2="1000" y1="41" y2="41"/>' +
          '<line class="band-line" x1="0" x2="1000" y1="74" y2="74"/>' +
          '<g clip-path="url(#clip-filtered)">' +
            (charge ? '<path class="charge-area" d="' + charge.area + '"/><path class="charge-line" d="' + charge.line + '"/>' : '') +
            '<path class="accepted-trace" d="' + pathFor(timelines[index], s.total, 74, 55) + '"/>' +
          '</g>'
        : '<line class="baseline" x1="0" x2="1000" y1="42" y2="42"/>' +
          '<g clip-path="url(#clip-' + id + ')"><path class="trace" d="' + pathFor(timelines[index], s.total) + '" stroke="' + colors[index] + '"/>' + dots + '</g>';
      $('wave-' + id).innerHTML =
        '<svg viewBox="0 0 1000 ' + height + '" preserveAspectRatio="none" aria-hidden="true">' +
          grid.join('') +
          '<defs><clipPath id="clip-' + id + '"><rect class="reveal" x="0" y="0" width="0" height="' + height + '"/></clipPath></defs>' +
          waveContent +
          '<line class="cursor" x1="0" x2="0" y1="0" y2="' + height + '" visibility="hidden"/>' +
        '</svg>';
    });
    $('time-axis').innerHTML = '<span>0 ms</span><span>' + fmt(s.total / 2) + ' ms</span><span>' + fmt(s.total) + ' ms</span>';
    setProgress(0, s);
  }

  function setProgress(progress, s) {
    const px = Math.round(1000 * progress);
    document.querySelectorAll('.reveal').forEach((rect) => rect.setAttribute('width', px));
    document.querySelectorAll('.cursor').forEach((line) => {
      line.setAttribute('x1', px);
      line.setAttribute('x2', px);
      line.setAttribute('visibility', progress > 0 && progress < 1 ? 'visible' : 'hidden');
    });
    setReadout(progress * s.total, s);
  }

  function finish(s) {
    setProgress(1, s);
    setReadout(s.total, s, true);
    counts[0].textContent = s.passed ? '1 次' : '0 次';
    counts[1].textContent = s.regularSeen ? '1 次' : '0 次';
    counts[2].textContent = s.caughtSeen ? '1 次' : '0 次';
    if (!s.passed) {
      explanation.textContent = '最高累计没有到达滤波时间，第二行没有输出；后两行也就读不到。';
    } else if (!s.regularSeen) {
      explanation.textContent = '累计到达滤波时间，第二行出现了波；它夹在两次读取之间，普通采样漏掉，脉冲捕捉接住。';
    } else {
      explanation.textContent = '累计到达滤波时间，第二行出现了波；它赶上 CPU 读取，普通采样也能看到。';
    }
    result.hidden = false;
    emit.disabled = false;
    emit.innerHTML = '再发一个波 <span aria-hidden="true">→</span>';
  }

  function reset() {
    cancelAnimationFrame(frame);
    emit.disabled = false;
    counts.forEach((count) => count.textContent = '—');
    const settings = readSettings();
    if (settings.error) {
      result.hidden = false;
      result.classList.add('error');
      explanation.textContent = settings.error;
      if (current) setProgress(0, current);
      return;
    }
    result.hidden = true;
    result.classList.remove('error');
    current = simulate(settings);
    render(current);
    explanation.textContent = '';
  }

  function play() {
    cancelAnimationFrame(frame);
    const settings = readSettings();
    if (settings.error) {
      result.hidden = false;
      result.classList.add('error');
      explanation.textContent = settings.error;
      return;
    }
    result.hidden = true;
    result.classList.remove('error');
    current = simulate(settings);
    render(current);
    counts.forEach((count) => count.textContent = '—');
    emit.disabled = true;
    if (motionReduced) {
      finish(current);
      return;
    }
    const started = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - started) / 3200);
      setProgress(progress, current);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else finish(current);
    }
    frame = requestAnimationFrame(tick);
  }

  Object.values(inputs).forEach((input) => {
    input.addEventListener('input', reset);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); play(); }
    });
  });
  emit.addEventListener('click', play);
  current = simulate(readSettings());
  render(current);
})();
