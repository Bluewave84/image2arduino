// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  images: [],   // { id, name, img, url }
  rawCode: ''   // generated plain-text code
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const dropzone        = document.getElementById('dropzone');
const fileInput       = document.getElementById('file-input');
const imageList       = document.getElementById('image-list');
const emptyHint       = document.getElementById('empty-hint');
const btnGenerate     = document.getElementById('btn-generate');
const btnClear        = document.getElementById('btn-clear');
const btnCopy         = document.getElementById('btn-copy');
const btnDownload     = document.getElementById('btn-download');
const codeOutput      = document.getElementById('code-output');
const codePlaceholder = document.getElementById('code-placeholder');
const outputStats     = document.getElementById('output-stats');
const canvas          = document.getElementById('canvas');
const ctx             = canvas.getContext('2d');
const toast           = document.getElementById('toast');

// Settings
const selFormat    = document.getElementById('format');
const sliderThresh = document.getElementById('threshold');
const valThresh    = document.getElementById('threshold-val');
const thresholdRow = document.getElementById('threshold-row');
const chkResize    = document.getElementById('do-resize');
const resizeOpts   = document.getElementById('resize-options');
const inpW         = document.getElementById('resize-w');
const inpH         = document.getElementById('resize-h');
const chkAspect    = document.getElementById('keep-aspect');
const chkProgmem   = document.getElementById('use-progmem');
const chkDims      = document.getElementById('add-dims');
const selBPL       = document.getElementById('bytes-per-line');

// ─── Upload: Drop Zone ────────────────────────────────────────────────────────
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
});

/**
 * Load FileList items as Images and push them into state.
 * @param {FileList} files
 */
function handleFiles(files) {
  [...files].forEach(file => {
    if (!file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const id = Date.now() + Math.random();
        state.images.push({ id, name: file.name, img, url: e.target.result });
        renderImageList();
        updateButtons();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  fileInput.value = '';
}

// ─── Image List ───────────────────────────────────────────────────────────────
function renderImageList() {
  imageList.innerHTML = '';

  if (state.images.length === 0) {
    imageList.appendChild(emptyHint);
    return;
  }

  state.images.forEach(item => {
    const div = document.createElement('div');
    div.className = 'image-item';
    div.innerHTML = `
      <img class="image-thumb" src="${item.url}" alt="${item.name}" />
      <div class="image-info">
        <div class="image-name">${item.name}</div>
        <div class="image-size">${item.img.width} × ${item.img.height} px</div>
      </div>
      <button class="image-remove" title="Entfernen">×</button>
    `;
    div.querySelector('.image-remove').addEventListener('click', () => {
      state.images = state.images.filter(i => i.id !== item.id);
      renderImageList();
      updateButtons();
    });
    imageList.appendChild(div);
  });
}

function updateButtons() {
  const has = state.images.length > 0;
  btnGenerate.disabled = !has;
  btnClear.disabled = !has;
}

// ─── Settings UI ──────────────────────────────────────────────────────────────
selFormat.addEventListener('change', () => {
  const mono = selFormat.value.startsWith('mono');
  thresholdRow.style.display = mono ? 'flex' : 'none';
});

sliderThresh.addEventListener('input', () => {
  valThresh.textContent = sliderThresh.value;
});

chkResize.addEventListener('change', () => {
  resizeOpts.style.display = chkResize.checked ? 'block' : 'none';
});

// ─── Code Generation ──────────────────────────────────────────────────────────

/**
 * Compute the target canvas size for an image.
 * @param {number} origW
 * @param {number} origH
 * @returns {[number, number]}
 */
function getTargetSize(origW, origH) {
  if (!chkResize.checked) return [origW, origH];

  let tw = parseInt(inpW.value) || origW;
  let th = parseInt(inpH.value) || origH;

  if (chkAspect.checked) {
    const ratio = origW / origH;
    if (tw / th > ratio) tw = Math.round(th * ratio);
    else th = Math.round(tw / ratio);
  }

  return [Math.max(1, tw), Math.max(1, th)];
}

/**
 * Turn a filename into a valid C identifier.
 * @param {string} filename
 * @returns {string}
 */
function sanitizeName(filename) {
  let name = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_');
  if (/^\d/.test(name)) name = '_' + name;
  return name;
}

/** RGB → RGB565 (uint16_t) */
function rgb565(r, g, b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

/** RGB → 8-bit luminance */
function toGray(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Draw image onto hidden canvas at target size and return pixel data.
 * @param {HTMLImageElement} imgEl
 * @param {number} w
 * @param {number} h
 * @returns {Uint8ClampedArray}
 */
function getPixels(imgEl, w, h) {
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(imgEl, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * Format a byte value as a zero-padded hex literal.
 * @param {number} v - value 0-255
 * @returns {string}
 */
function hex8(v) { return '0x' + v.toString(16).toUpperCase().padStart(2, '0'); }

/**
 * Format a 16-bit value as a zero-padded hex literal.
 * @param {number} v
 * @returns {string}
 */
function hex16(v) { return '0x' + v.toString(16).toUpperCase().padStart(4, '0'); }

/**
 * Split an array into lines of `bpl` items each.
 * @param {string[]} values
 * @param {number} bpl - bytes per line
 * @returns {string[]}
 */
function chunkLines(values, bpl) {
  const lines = [];
  for (let i = 0; i < values.length; i += bpl) {
    const isLast = i + bpl >= values.length;
    lines.push('  ' + values.slice(i, i + bpl).join(', ') + (isLast ? '' : ','));
  }
  return lines;
}

/**
 * Generate Arduino C code for a single image entry.
 * @param {{ name: string, img: HTMLImageElement }} item
 * @returns {string}
 */
function generateForImage(item) {
  const format    = selFormat.value;
  const progmem   = chkProgmem.checked;
  const addDims   = chkDims.checked;
  const bpl       = parseInt(selBPL.value);
  const threshold = parseInt(sliderThresh.value);
  const varName   = sanitizeName(item.name);
  const [tw, th]  = getTargetSize(item.img.width, item.img.height);
  const pixels    = getPixels(item.img, tw, th);
  const progStr   = progmem ? ' PROGMEM' : '';
  const lines     = [];

  // ── Header comment
  lines.push(`// ${item.name}  (${tw}×${th} px, ${format.toUpperCase()})`);

  if (addDims) {
    const nameUp = varName.toUpperCase();
    lines.push(`#define ${nameUp}_WIDTH  ${tw}`);
    lines.push(`#define ${nameUp}_HEIGHT ${th}`);
  }

  // ── Format-specific conversion
  if (format === 'rgb565') {
    const values = [];
    for (let i = 0; i < pixels.length; i += 4) {
      values.push(hex16(rgb565(pixels[i], pixels[i + 1], pixels[i + 2])));
    }
    lines.push(`// ${values.length} pixels, ${values.length * 2} bytes`);
    lines.push(`const uint16_t ${varName}[]${progStr} = {`);
    lines.push(...chunkLines(values, bpl));
    lines.push(`};`);

  } else if (format === 'rgb888') {
    const values = [];
    for (let i = 0; i < pixels.length; i += 4) {
      values.push(hex8(pixels[i]), hex8(pixels[i + 1]), hex8(pixels[i + 2]));
    }
    lines.push(`// ${tw * th} pixels, ${values.length} bytes (R, G, B)`);
    lines.push(`const uint8_t ${varName}[]${progStr} = {`);
    lines.push(...chunkLines(values, bpl));
    lines.push(`};`);

  } else if (format === 'gray8') {
    const values = [];
    for (let i = 0; i < pixels.length; i += 4) {
      values.push(hex8(toGray(pixels[i], pixels[i + 1], pixels[i + 2])));
    }
    lines.push(`// ${values.length} pixels, ${values.length} bytes`);
    lines.push(`const uint8_t ${varName}[]${progStr} = {`);
    lines.push(...chunkLines(values, bpl));
    lines.push(`};`);

  } else if (format === 'mono_h') {
    // Horizontal packing: MSB = leftmost pixel
    const bits = [];
    for (let i = 0; i < pixels.length; i += 4) {
      bits.push(toGray(pixels[i], pixels[i + 1], pixels[i + 2]) > threshold ? 1 : 0);
    }
    const values = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        if (bits[i + b]) byte |= (0x80 >> b);
      }
      values.push(hex8(byte));
    }
    lines.push(`// ${tw * th} pixels, ${values.length} bytes (horizontal bit packing)`);
    lines.push(`const uint8_t ${varName}[]${progStr} = {`);
    lines.push(...chunkLines(values, bpl));
    lines.push(`};`);

  } else if (format === 'mono_v') {
    // Vertical page packing for SSD1306 OLED: each byte = 8 vertical pixels per page
    const pages = Math.ceil(th / 8);
    const values = [];
    for (let page = 0; page < pages; page++) {
      for (let x = 0; x < tw; x++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const y = page * 8 + bit;
          if (y < th) {
            const i = (y * tw + x) * 4;
            if (toGray(pixels[i], pixels[i + 1], pixels[i + 2]) > threshold) {
              byte |= (1 << bit);
            }
          }
        }
        values.push(hex8(byte));
      }
    }
    lines.push(`// ${tw}×${th} px → ${pages} pages, ${values.length} bytes (SSD1306 vertical pages)`);
    lines.push(`const uint8_t ${varName}[]${progStr} = {`);
    lines.push(...chunkLines(values, bpl));
    lines.push(`};`);
  }

  return lines.join('\n');
}

/** Entry point: generate code for all loaded images. */
function generateAll() {
  if (state.images.length === 0) return;

  btnGenerate.disabled = true;
  btnGenerate.textContent = '⏳ Generiere…';

  // Defer so the UI can repaint before heavy canvas work
  setTimeout(() => {
    try {
      const parts = [
        `// Generated by image2code – Arduino Bildkonverter`,
        `// Format: ${selFormat.options[selFormat.selectedIndex].text}`,
        `// ${state.images.length} image(s)\n`,
        `#pragma once`,
        chkProgmem.checked ? `#include <avr/pgmspace.h>\n` : '',
      ];

      state.images.forEach((item, idx) => {
        if (idx > 0) parts.push('');
        parts.push(generateForImage(item));
      });

      state.rawCode = parts.join('\n');
      renderCode(state.rawCode);
      updateOutputStats(state.rawCode);

      codePlaceholder.style.display = 'none';
      codeOutput.style.display      = 'block';
      btnCopy.disabled               = false;
      btnDownload.disabled           = false;

      showToast('✅ Code generiert!');
    } catch (e) {
      console.error(e);
      showToast('❌ Fehler beim Generieren');
    }

    btnGenerate.disabled    = false;
    btnGenerate.textContent = '⚡ Generieren';
  }, 30);
}

btnGenerate.addEventListener('click', generateAll);

// ─── Syntax Highlighting ──────────────────────────────────────────────────────
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightLine(line) {
  if (/^\s*\/\//.test(line)) {
    return `<span class="tok-cmt">${esc(line)}</span>`;
  }
  if (/^\s*#(pragma|include|ifndef|define|endif)/.test(line)) {
    return line.replace(/(#\w+)(.*)/, (_, kw, rest) =>
      `<span class="tok-def">${esc(kw)}</span><span class="tok-str">${esc(rest)}</span>`);
  }
  if (/^\s*const\s/.test(line)) {
    return line
      .replace(/\b(const)\b/g,                          '<span class="tok-kw">$1</span>')
      .replace(/\b(uint16_t|uint8_t|int16_t|int8_t|uint32_t)\b/g, '<span class="tok-type">$1</span>')
      .replace(/\b(PROGMEM)\b/g,                        '<span class="tok-kw">$1</span>')
      .replace(/\b([a-zA-Z_]\w*)\b(?=\s*\[\])/,        '<span class="tok-name">$1</span>')
      .replace(/[{}]/g, m => `<span class="tok-punc">${m}</span>`);
  }
  if (/0x[0-9A-Fa-f]+/.test(line)) {
    return line.replace(/0x[0-9A-Fa-f]+/g, m => `<span class="tok-num">${m}</span>`);
  }
  return esc(line);
}

function renderCode(code) {
  codeOutput.innerHTML = code.split('\n').map(highlightLine).join('\n');
}

function updateOutputStats(code) {
  const lines = code.split('\n').length;
  const kb    = (new TextEncoder().encode(code).length / 1024).toFixed(1);
  outputStats.innerHTML = `<span>${lines}</span> Zeilen &nbsp;·&nbsp; <span>${kb}</span> KB`;
}

// ─── Copy & Download ──────────────────────────────────────────────────────────
btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(state.rawCode)
    .then(() => showToast('📋 In Zwischenablage kopiert!'));
});

btnDownload.addEventListener('click', () => {
  const blob = new Blob([state.rawCode], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'images.h';
  a.click();
  URL.revokeObjectURL(url);
  showToast('⬇ images.h heruntergeladen!');
});

// ─── Clear ────────────────────────────────────────────────────────────────────
btnClear.addEventListener('click', () => {
  state.images  = [];
  state.rawCode = '';
  renderImageList();
  updateButtons();
  codeOutput.style.display      = 'none';
  codePlaceholder.style.display = 'flex';
  outputStats.innerHTML         = '';
  btnCopy.disabled              = true;
  btnDownload.disabled          = true;
});

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}
