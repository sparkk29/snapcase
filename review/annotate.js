function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the screenshot'));
    img.src = src;
  });
}

function normRect(s) {
  const x = Math.min(s.x1, s.x2);
  const y = Math.min(s.y1, s.y2);
  return { x, y, w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
}

export class Annotator {
  constructor(stage, { onChange } = {}) {
    this.stage = stage;
    this.onChange = onChange || (() => {});
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'annot-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Screenshot. Draw on it to point out the problem.');
    this.stage.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.committed = document.createElement('canvas');
    this.shapes = [];
    this.redoStack = [];
    this.draft = null;
    this.tool = 'rect';
    this.color = '#e11d48';
    this.textInput = null;
    this.bindPointer();
  }

  async load(dataUrl) {
    this.image = await loadImage(dataUrl);
    const { naturalWidth: w, naturalHeight: h } = this.image;
    this.canvas.width = this.committed.width = w;
    this.canvas.height = this.committed.height = h;
    this.lineWidth = Math.max(3, Math.round(w / 350));
    this.fontSize = Math.max(18, Math.round(w / 55));
    this.shapes = [];
    this.redoStack = [];
    this.rebuild();
  }

  setTool(tool) {
    this.commitText();
    this.tool = tool;
    this.canvas.dataset.tool = tool;
  }

  setColor(color) {
    this.color = color;
  }

  get canUndo() {
    return this.shapes.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.shapes.length) return;
    this.redoStack.push(this.shapes.pop());
    this.rebuild();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.shapes.push(this.redoStack.pop());
    this.rebuild();
  }

  clear() {
    if (!this.shapes.length) return;
    this.redoStack = [];
    this.shapes = [];
    this.rebuild();
  }

  toDataURL() {
    this.commitText();
    return this.committed.toDataURL('image/png');
  }

  // ---------- drawing ----------

  rebuild() {
    const ctx = this.committed.getContext('2d');
    ctx.clearRect(0, 0, this.committed.width, this.committed.height);
    ctx.drawImage(this.image, 0, 0);
    for (const s of this.shapes) this.drawShape(ctx, s);
    this.paint();
    this.onChange();
  }

  paint() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.committed, 0, 0);
    if (this.draft) this.drawShape(this.ctx, this.draft);
  }

  drawShape(ctx, s) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    switch (s.type) {
      case 'rect': {
        const r = normRect(s);
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = s.width;
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(8, r.w / 4, r.h / 4));
        ctx.stroke();
        break;
      }
      case 'arrow':
        this.drawArrow(ctx, s);
        break;
      case 'pen':
        ctx.beginPath();
        s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        break;
      case 'blur':
        this.pixelate(ctx, normRect(s));
        break;
      case 'text':
        ctx.font = `bold ${s.size}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.lineWidth = Math.max(3, s.size / 5);
        ctx.strokeStyle = '#ffffff';
        s.text.split('\n').forEach((line, i) => {
          ctx.strokeText(line, s.x, s.y + i * s.size * 1.25);
          ctx.fillText(line, s.x, s.y + i * s.size * 1.25);
        });
        break;
      default:
        break;
    }
    ctx.restore();
  }

  drawArrow(ctx, s) {
    const { x1, y1, x2, y2, width } = s;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = width * 4.5;
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(angle) * head * 0.6, y2 - Math.sin(angle) * head * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }

  pixelate(ctx, r) {
    if (r.w < 1 || r.h < 1) return;
    const block = Math.max(10, Math.round(this.canvas.width / 90));
    const sw = Math.max(1, Math.round(r.w / block));
    const sh = Math.max(1, Math.round(r.h / block));
    const tmp = document.createElement('canvas');
    tmp.width = sw;
    tmp.height = sh;
    tmp.getContext('2d').drawImage(this.image, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
    ctx.imageSmoothingEnabled = true;
  }

  // ---------- input ----------

  toImageCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(this.canvas.width, ((e.clientX - rect.left) * this.canvas.width) / rect.width)),
      y: Math.max(0, Math.min(this.canvas.height, ((e.clientY - rect.top) * this.canvas.height) / rect.height)),
    };
  }

  bindPointer() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.image) return;
      e.preventDefault();
      const p = this.toImageCoords(e);
      if (this.tool === 'text') {
        this.startText(e, p);
        return;
      }
      this.commitText();
      this.canvas.setPointerCapture(e.pointerId);
      this.draft =
        this.tool === 'pen'
          ? { type: 'pen', points: [[p.x, p.y]], color: this.color, width: this.lineWidth }
          : { type: this.tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: this.color, width: this.lineWidth };
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.draft) return;
      const p = this.toImageCoords(e);
      if (this.draft.type === 'pen') this.draft.points.push([p.x, p.y]);
      else {
        this.draft.x2 = p.x;
        this.draft.y2 = p.y;
      }
      this.paint();
    });

    const finish = () => {
      const d = this.draft;
      this.draft = null;
      if (!d) return;
      const big = d.type === 'pen' ? d.points.length > 2 : Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 6;
      if (big) {
        this.shapes.push(d);
        this.redoStack = [];
        this.rebuild();
      } else {
        this.paint();
      }
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);
  }

  startText(e, p) {
    this.commitText();
    const stageRect = this.stage.getBoundingClientRect();
    const scale = this.canvas.getBoundingClientRect().width / this.canvas.width;
    const input = document.createElement('textarea');
    input.className = 'annot-text';
    input.rows = 1;
    input.placeholder = 'Type, then press Enter';
    input.style.left = `${e.clientX - stageRect.left}px`;
    input.style.top = `${e.clientY - stageRect.top}px`;
    input.style.color = this.color;
    input.style.fontSize = `${Math.max(13, this.fontSize * scale)}px`;
    this.stage.appendChild(input);
    this.textInput = { el: input, x: p.x, y: p.y, color: this.color, size: this.fontSize };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        this.commitText();
      } else if (ev.key === 'Escape') {
        this.textInput = null;
        input.remove();
      }
    });
    input.addEventListener('blur', () => setTimeout(() => this.commitText(), 0));
    setTimeout(() => input.focus(), 0);
  }

  commitText() {
    const t = this.textInput;
    if (!t) return;
    this.textInput = null;
    const text = t.el.value.trim();
    t.el.remove();
    if (!text) return;
    this.shapes.push({ type: 'text', x: t.x, y: t.y, text, color: t.color, size: t.size });
    this.redoStack = [];
    this.rebuild();
  }
}
