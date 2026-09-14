/**
 * ivory-viewer.js —— 课程详情弹窗里的象牙牌（三维建模，不是 CSS 拼的方块）
 *
 * ⚠ 当前未接入。用户明确不要课表侧的 3D 检视，app.js 已改回原版文字列表，
 *    build-rhine.mjs 里的导入也注释掉了，所以这个文件不会进 bundle。
 *    要加回来：取消 build-rhine.mjs 里那两行注释，再在 openSlot() 里挂一次。
 *
 * 需求原话是「高级象牙牌建模」，所以这里是一块**真的模型**：
 *   · 牌身用圆角矩形拉伸 + 倒角（ExtrudeGeometry 的 bevel），斜过来能看到厚度和棱边；
 *   · 牌面文字画进 canvas 当贴图，按 DPR 出图，所以在近景也是清的；
 *    · 香槟色索引条是独立的一小块金属，跟阵列那张卡的 Champagne_Index 一个语气；
 *    · 光照用 PMREM 生成一张渐变环境贴图，象牙面和香槟条才有像样的高光反应。
 *
 * 和阵列共用同一个 WebGL 上下文是不行的（一个 canvas 一个上下文），
 * 但一个弹窗只开这一个上下文：所有牌画在同一个场景里，一次绘制。
 */
import * as THREE from 'three';

/* —— 牌的物理尺寸（世界单位），后面所有排版都按这个换算 —— */
const CARD_W = 3.2;
const CARD_H = 2.0;
const CARD_D = 0.16;
const BEVEL = 0.022;
const LABEL_W = 1.42;
const LABEL_H = 0.44;

/** 象牙色 —— 与界面的暖纸面色同一族，暗色下由主题参数覆盖 */
const IVORY = { light: 0xf1ece0, dark: 0x3a4145 };
const INK = { light: 0x2b2820, dark: 0xdfe4e0 };
const CHAMPAGNE = { light: 0xbfa06a, dark: 0xc5a16b };

/** 圆角矩形轮廓，给 ExtrudeGeometry 用 */
function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** 一张竖直渐变的贴图，用来做环境光照；比纯色均匀光有层次得多 */
function gradientEnvironment(renderer) {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.45, '#efe9dd');
  grad.addColorStop(0.55, '#cfc7b6');
  grad.addColorStop(1, '#4a463d');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(10, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide }),
  ));
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  tex.dispose();
  return rt;
}

/** 牌面：白标签块 + 编号 + 课名 + 明细，画进 canvas 当贴图 */
function drawFace(card, theme) {
  const px = 1024;
  const py = Math.round(px * (CARD_H / CARD_W));
  const c = document.createElement('canvas');
  c.width = px;
  c.height = py;
  const g = c.getContext('2d');
  const S = px / CARD_W;                    // 世界单位 → 像素
  const dark = theme === 'dark';
  const ink = dark ? '#e7ebe7' : '#23201a';
  const soft = dark ? '#98a4a8' : '#6b6454';
  const hair = dark ? 'rgba(160,172,176,.42)' : 'rgba(80,75,65,.34)';
  const labelBg = dark ? '#2b3236' : '#fbfaf6';
  const labelLine = dark ? '#4a5459' : '#cfc6b2';
  const sans = '"MiSans","Microsoft YaHei","PingFang SC",sans-serif';
  const mono = '"Cascadia Mono",Consolas,ui-monospace,monospace';

  // 内圈刻线
  g.strokeStyle = hair;
  g.lineWidth = 2;
  const inset = 0.2 * S;
  g.strokeRect(inset, inset, px - inset * 2, py - inset * 2);

  // 白标签块（跟阵列那张卡同一个位置、同一个语气）
  const lx = 0.42 * S;
  const ly = 0.36 * S;
  const lw = LABEL_W * S;
  const lh = LABEL_H * S;
  g.fillStyle = labelBg;
  g.fillRect(lx, ly, lw, lh);
  g.strokeStyle = labelLine;
  g.lineWidth = 2;
  g.strokeRect(lx, ly, lw, lh);
  g.fillStyle = ink;
  g.font = `700 ${0.2 * S}px ${mono}`;
  g.textBaseline = 'middle';
  g.fillText(card.code || 'KB-000', lx + 0.13 * S, ly + lh * 0.36);
  g.fillStyle = soft;
  g.font = `500 ${0.115 * S}px ${mono}`;
  g.fillText('RHINE LAB · ARCHIVE', lx + 0.13 * S, ly + lh * 0.72);

  // 右上：分类与节次
  g.textAlign = 'right';
  g.fillStyle = soft;
  g.font = `500 ${0.13 * S}px ${mono}`;
  g.fillText((card.day || '') + '  ' + (card.slot || ''), px - 0.42 * S, ly + lh * 0.5);
  g.textAlign = 'left';

  // 发丝横线
  const ruleY = ly + lh + 0.26 * S;
  g.strokeStyle = hair;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(lx, ruleY);
  g.lineTo(px - 0.42 * S, ruleY);
  g.stroke();

  // 课名
  g.fillStyle = ink;
  g.font = `650 ${0.3 * S}px ${sans}`;
  g.fillText(card.name || '', lx, ruleY + 0.4 * S);

  // 明细
  g.fillStyle = soft;
  g.font = `500 ${0.15 * S}px ${mono}`;
  g.fillText(card.meta || '', lx, ruleY + 0.8 * S);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class IvoryViewer {
  constructor(container, options = {}) {
    this.container = container;
    this.theme = options.theme || 'light';
    this.cards = [];
    this.plates = [];
    this.running = false;
    this.raf = 0;
    this.active = null;
    this._lastX = 0;
    this._lastY = 0;
    this._frame = this._frame.bind(this);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    this.envRT = gradientEnvironment(this.renderer);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.85;

    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6b6154, 0.55));
    const key = new THREE.DirectionalLight(0xfff4e2, 1.5);
    key.position.set(2.4, 3.2, 4.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xdfe6ff, 0.55);
    rim.position.set(-3.4, -1.2, 2.0);
    this.scene.add(rim);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._bind();
  }

  /** 换一组课程牌；数据没变就不重建 */
  setCards(cards) {
    const key = JSON.stringify(cards) + '|' + this.theme;
    if (key === this._key) return;
    this._key = key;
    this.cards = cards || [];
    this._build();
  }

  _build() {
    for (const p of this.plates) {
      p.group.parent?.remove(p.group);
      p.group.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
    }
    this.plates = [];
    const dark = this.theme === 'dark';
    const n = this.cards.length;
    if (!n) { this._fit(0); return; }

    const shape = roundedRect(CARD_W, CARD_H, 0.16);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: CARD_D,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 3,
      curveSegments: 12,
    });
    geometry.translate(0, 0, -CARD_D / 2);
    geometry.computeVertexNormals();

    const pitch = CARD_W + 0.42;
    const total = (n - 1) * pitch;

    this.cards.forEach((card, i) => {
      const group = new THREE.Group();
      group.position.x = i * pitch - total / 2;

      const body = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({
        color: dark ? IVORY.dark : IVORY.light,
        roughness: 0.4,
        metalness: 0.02,
        clearcoat: 0.42,
        clearcoatRoughness: 0.34,
      }));
      group.add(body);

      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(CARD_W - BEVEL * 2, CARD_H - BEVEL * 2),
        new THREE.MeshBasicMaterial({ map: drawFace(card, this.theme), transparent: true }),
      );
      /* 必须放在倒角之后的正面外侧。
         开了倒角的 ExtrudeGeometry 总厚度是 depth + 2*bevelThickness，
         几何体又往下平移了 depth/2，所以正面在 (depth/2 + bevelThickness) 处 ——
         只按 depth/2 放会把整张牌面埋进实体里（牌是白的，字一个也看不见）。 */
      face.position.z = CARD_D / 2 + BEVEL + 0.003;
      group.add(face);

      // 香槟色索引条：贴在牌的左边棱上，是整块牌唯一的高光金属
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, CARD_H - 0.44, CARD_D + BEVEL * 2 + 0.012),
        new THREE.MeshPhysicalMaterial({
          color: dark ? CHAMPAGNE.dark : CHAMPAGNE.light,
          roughness: 0.28,
          metalness: 0.62,
          clearcoat: 0.3,
        }),
      );
      strip.position.set(-CARD_W / 2 + 0.1, 0, 0);
      group.add(strip);

      this.scene.add(group);
      this.plates.push({
        group,
        body,
        hit: [body],
        rx: 0,
        ry: 0,
        base: 1,
      });
    });

    this._fit(total);
  }

  _fit(total) {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const fov = (this.camera.fov * Math.PI) / 180;
    const distV = (CARD_H / 2 + 0.16) / Math.tan(fov / 2);
    const distH = (total / 2 + CARD_W / 2 + 0.16) / (Math.tan(fov / 2) * this.camera.aspect);
    this.camera.position.set(0, 0.22, Math.max(distV, distH));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  _bind() {
    const el = this.renderer.domElement;
    const pick = (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.plates.map((p) => p.body), false);
      if (!hits.length) return null;
      return this.plates.find((p) => p.body === hits[0].object) || null;
    };
    el.addEventListener('pointerdown', (e) => {
      const p = pick(e);
      if (!p) return;
      this.active = p;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      el.style.cursor = 'grabbing';
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 没有捕获也能用 */ }
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.active) { el.style.cursor = pick(e) ? 'grab' : 'default'; return; }
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.active.ry = Math.max(-0.95, Math.min(0.95, this.active.ry + dx * 0.006));
      this.active.rx = Math.max(-0.6, Math.min(0.6, this.active.rx - dy * 0.005));
    });
    const release = () => { this.active = null; el.style.cursor = 'grab'; };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('dblclick', (e) => {
      const p = pick(e);
      if (p) { p.rx = 0; p.ry = 0; }
    });
    el.style.cursor = 'grab';

    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        const total = Math.max(0, (this.cards.length - 1) * (CARD_W + 0.42));
        this._fit(total);
      });
      this.observer.observe(this.container);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  _frame(now) {
    if (!this.running) return;
    const t = now / 1000;
    this.plates.forEach((p, i) => {
      // 轻微的悬浮摇摆：静止时也有点生气，但幅度压得很小，不抢戏
      const idleY = this.active === p ? 0 : Math.sin(t * 0.55 + i * 0.9) * 0.055;
      const idleX = this.active === p ? 0 : Math.sin(t * 0.42 + i * 1.4) * 0.022;
      p.group.rotation.y = p.ry + idleY;
      p.group.rotation.x = p.rx + idleX;
      p.group.position.y = Math.sin(t * 0.5 + i * 1.1) * 0.022;
    });
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this._frame);
  }

  setTheme(theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    this._key = null;             // 强制重建材质与牌面贴图
    const cards = this.cards;
    this._buildWith(cards);
  }

  _buildWith(cards) {
    this.cards = cards;
    this._build();
    this._key = JSON.stringify(cards) + '|' + this.theme;
  }

  dispose() {
    this.stop();
    if (this.observer) this.observer.disconnect();
    for (const p of this.plates) {
      p.group.parent?.remove(p.group);
      p.group.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
    }
    this.plates = [];
    if (this.envRT) this.envRT.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
    this.container = null;
  }
}
