/**
 * rhine-scene-host.js —— 阵列宿主（KbMonitor 侧的新代码，不是移植件）
 *
 * 职责：把移植过来的 ArchiveScene 包成一个好用的小接口，
 * 负责容器、逐帧驱动、课表数据注入、生命周期与降级。
 *
 * 上游 app 的 main.ts 里这段编排被拆散在开场动画、模式切换、弹窗等逻辑中；
 * KbMonitor 只需要「课表总览里的阵列」这一条链路，所以在这里重新收拢，
 * 但所有实际渲染与交互都交给 ArchiveScene 本体，不做二次实现。
 */
import { ArchiveScene } from './rhine/scene.js';
import { setRecords } from './rhine/data.js';

/** 把 KbMonitor 的课程行映射成阵列需要的「档案」形状。 */
export function coursesToRecords(rows) {
  const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return (rows || []).map((r, i) => {
    const day = Number(r.day) || 1;
    const span = r.start && r.end && r.end !== r.start ? `${r.start}-${r.end} 节` : `${r.start || '—'} 节`;
    return {
      id: `KB-${String(i + 1).padStart(3, '0')}`,
      title: r.name || '未命名课程',
      en: r.room || '',
      department: r.teacher || '—',
      category: DAYS[Math.min(6, Math.max(0, day - 1))],
      date: r.weeks || '',
      lead: r.teacher || '—',
      clearance: '可读取',
      abstract: `${r.teacher || ''} · ${r.room || ''}`.trim(),
      findings: [span, r.weeks || ''],
      source: '',
    };
  });
}

export class RhineArray {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.scene = null;
    this.raf = 0;
    this.running = false;
    this.loaded = false;
    this.index = 0;
    this.detail = false; // 检视态（用户当前不要三维检视，见 setDetail 注释）
    this.clearGlass = options.clearGlass !== false; // 盖板一律清晰，不做「解密磨砂」
    this.warmed = false; // 场景是否由 warmup() 提前建好（首次进入要补放入场动画）
    this.entrancePlayed = false; // 全流程入场每次启动只放一次
    this._warming = null; // 进行中的预热 promise，正式 start() 要等它
    this.records = [];
    this.reduced = !!(options.reduced && options.reduced());
    this.onSelect = options.onSelect || null;
    this._layout = ''; // 最近一次已应用的「容器尺寸@像素密度」，用于挡住重复 resize
    this._frame = this._frame.bind(this);
    /* 入场动画允许打断：点一下或按任意键直接到位。
       用捕获阶段，免得被场景自己的 pointerdown（入场期间它会直接 return）挡掉。 */
    this.entrance = null;
    this._skip = () => { if (this.entrance) this.endEntrance(); };
    if (container && container.addEventListener) {
      container.addEventListener('pointerdown', this._skip, true);
      window.addEventListener('keydown', this._skip);
    }
  }

  /** 注入课表；同时刷新阵列内容。 */
  setCourses(rows) {
    this.records = coursesToRecords(rows);
    // 阵列的循环池固定为 9 列 × 32 行（见 archive-loop.js 的 LOOP_COLUMNS/LOOP_ROWS），
    // 不需要、也没有 setPoolSize 这个接口 —— 每列的份数由 data.js 的 columnFiles 决定。
    setRecords(this.records);
    return this.records.length;
  }

  /**
   * 切换画质。两个参数都直接转给移植过来的 ArchiveScene，不在这里做二次实现：
   *   preset           —— render-quality.js 的档位对象（scale/pixelRatio/shadows/
   *                       aoSamples/depthOfField/transmission/anisotropy/antialias）
   *   superPerformance —— 上游的「超级性能模式」：跳过整条后处理链
   *                       （scene.ts 里 `if (superPerformance) renderer.render(...)
   *                        else composer.render()`），并把阵列材质换成无折射、
   *                       无清漆的快速版本。
   * 可以在运行中调用：setQuality 会按需重建 AO、调整渲染尺寸与纹理倍率。
   */
  setPerformance({ preset, superPerformance } = {}) {
    if (!this.scene) {
      this.options.superPerformance = superPerformance;
      if (preset) this.options.quality = preset;
      return;
    }
    if (preset) this.scene.setQuality(preset);
    if (typeof superPerformance === 'boolean') this.scene.setSuperPerformance(superPerformance);
    // 画质变了渲染倍率也变（renderDimensions 的 ratio 由 scale/pixelRatio 决定），
    // 但容器尺寸没动 —— 所以要清掉去重键，否则这次 resize 会被当成重复调用跳过，
    // 表现就是切了档位分辨率却没变。
    this._layout = '';
    this.resize();
  }

  /** 建场景（首次进入与预热共用；只负责把场景造好，不碰逐帧开关）。 */
  async _createScene() {
    if (this.scene) return this.scene;
    const scene = new ArchiveScene(this.container);
    scene.setReduced(this.reduced);
    if (this.options.quality) scene.setQuality(this.options.quality);
    if (this.options.superPerformance) scene.setSuperPerformance(true);
    scene.onSelect = (fileIndex, cell) => {
      /* 场景给的下标可能是 undefined：某一天一节课都没有时，fileAtCell 从空列里
         取出来就是 undefined，直接往下传会让 fileLocation 读 undefined.category
         抛异常（实测点一下就崩）。这里是移植件与应用层的边界，必须在这里挡住。 */
      if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= this.records.length) return;
      // 上游 select 回调给的是内容下标；KbMonitor 只需要把它透出去
      this.index = fileIndex;
      if (this.onSelect) this.onSelect(fileIndex, cell);
    };
    await scene.load();
    // 关键：load() 之后场景还停在「开场」模式（targetReveal = 0），阵列不绘制。
    // setMode('archive') 才切到浏览态：targetReveal → 1、looping 打开、
    // 相机与实例覆盖开始按交互取景。上游 app 由开场时间轴负责这一步，
    // KbMonitor 没有开场，进页面就是浏览态，所以直接切。
    scene.setMode('archive');
    this.scene = scene;
    this.loaded = true;
    return scene;
  }

  /**
   * 去掉「解密 / 磨砂」。
   *
   * 上游的设计是：档案盖板先是磨砂，进详情后沿对角线解密、由磨砂变清晰
   * （scene.ts 用 decryption.clarity 驱动 appearance.setClarity）。
   * KbMonitor 不做详情页，于是 clarity 一直停在 0 —— 卡片永远是磨砂的，
   * 看上去就是「糊」。这里直接把它钉在清晰态：
   * decryption.finish() 是上游自己表达「直接到清晰」的路径（减少动态效果时也走它）。
   *
   * 注意 update() 里非 active 会把 clarity 按指数衰减回 0，
   * 所以除了 finish() 还要把 active 置真，否则下一帧就又糊回去。
   */
  _keepGlassClear() {
    const dec = this.scene && this.scene.decryption;
    if (!dec) return;
    if (dec.clarity < 1 || !dec.active) {
      dec.finish();
      dec.active = true;
    }
    // 正在归位的旧卡片是独立副本，clarity 也在 scene.update 里单独衰减
    for (const o of this.scene.outgoing) o.clarity = 1;
  }

  async start(opts = {}) {
    // 预热可能正在建场景。等它建完再接手，否则这里会再建第二个场景。
    if (this._warming) { try { await this._warming; } catch (e) { /* 预热失败就走下面的新建 */ } }
    if (this.running) return;
    this.running = true;
    if (!this.scene) {
      // 场景只在第一次进入时建。切换到别的栏走的是 stop()，它只停逐帧，不销毁场景；
      // 早先这里每次 start() 都 new 一个，于是每回点进课程清单都要重新解析 GLB、
      // 传贴图、编译着色器（表现为「点进去就卡壳」），旧场景也一直留在容器里不释放。
      await this._createScene();
    } else if (this.warmed) {
      // 场景是预热时建好的，直接进入入场动画（下面 _beginEntrance），
      // 不用再把 reveal/presence 手动清零 —— 那条路已经被 cinematic 取代了。
      this.warmed = false;
    }
    if (this.clearGlass) this._keepGlassClear();
    /* 这里只调 resize()，**不**清去重键。
       清键会强制 setSize + composer.setSize，把每个后处理 pass 的 render target
       全部重建 —— 而"进列表"这件事本身并不改变渲染分辨率。
       尺寸真变了（离开时改过窗口、或预热用的是临时布局尺寸）由去重键自己判定。 */
    this.resize();
    this._beginEntrance();
    if (this.options.onReady) this.options.onReady();
    this.raf = requestAnimationFrame(this._frame);
  }

  /**
   * 预热：空闲时先把场景建出来渲染若干帧，把最贵的一次性成本提前付掉 ——
   * 解析内联 GLB、上传贴图、编译着色器，实测首次进入时阻塞主线程约 600ms
   * （逐帧探针里最差一帧 230ms）。预热之后首次进入就没有这段空档。
   *
   * 这里**故意不碰 running / raf**：早先的实现是复用 start() 再 stop()，
   * 结果用户恰好在预热期间点进列表时，正式进入会因为 running 为真直接返回，
   * 随后预热的收尾又把逐帧停掉 —— 阵列冻在入场动画中途，点什么都没反应。
   * 现在预热自己驱动有限的几帧，一旦发现正式进入已接管就立刻让路。
   *
   * 调用方必须保证容器此刻有真实尺寸：容器是 0 宽高时渲染尺寸会被压到 1×1，
   * 相机 aspect 变成 0/0，场景就废了。见 app.js 里的 .warming。
   */
  warmup() {
    if (this.scene || this.running) return Promise.resolve(false);
    if (this._warming) return this._warming;
    const done = this._doWarmup().then(
      (v) => { this._warming = null; return v; },
      () => { this._warming = null; return false; },
    );
    this._warming = done;
    return done;
  }

  async _doWarmup() {
    try {
      await this._createScene();
      this.warmed = true;
      this._layout = '';
      this.resize();
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        if (this.running) return true;   // 正式进入已经接管，马上让路
        this.scene.update(performance.now() / 1000);
      }
      return true;
    } catch (e) {
      // 预热失败不该影响正常进入：丢掉这个半成品，走原来的首次构建。
      // 但如果正式进入已经接管，就不能在这里销毁场景。
      if (!this.running) {
        try { this.dispose(); } catch (err) { /* 半成品，忽略 */ }
      }
      return false;
    }
  }

  /**
   * 选中第 index 份（内容下标，不是格位）。
   * navigation 直接转给 scene.select：点阵列上某一张卡片时要传 { cell }，
   * 这样抬起的才是被点的那一张；上游 main.ts:992 的 onSelect 也是这么回传的。
   * 不传则落到最近的同内容格位（上一张 / 下一张按钮走这条）。
   */
  select(index, navigation) {
    if (!this.scene || !this.loaded) return;
    // 同 onSelect：下标必须先验证。越界或非数字一律静默忽略，
    // 不能让它落到 fileLocation 里变成 TypeError。
    if (!Number.isInteger(index) || index < 0 || index >= this.records.length) return;
    this.index = index;
    this.scene.select(index, navigation);
  }

  /**
   * 进出「检视」态。上游 main.ts 的 setMode("detail")：
   * targetDetail → 1，卡片从阵列升起、镜头重新取景，
   * 起来之后 scene.js:1496 的 canInspect 才为真，此时按住拖动是旋转卡片
   * （不再是平移阵列）。
   *
   * 用户明确不要三维检视（阵列与课表详情两边都不要），所以这个接口目前不再被调用，
   * 保留是为了将来要加回来时不用重新查一遍上游的开关顺序。
   */
  setDetail(on) {
    if (!this.scene || !this.loaded) return;
    const want = !!on;
    if (this.detail === want) return;
    this.detail = want;
    this.scene.setMode(want ? 'detail' : 'archive');
    if (this.clearGlass) this._keepGlassClear();
    this._layout = '';
    this.resize();
  }

  /** 重播全流程入场（调试/自检用；界面上没有入口）。 */
  replayEntrance() {
    this.entrancePlayed = false;
    return this._beginEntrance();
  }

  /**
   * 入场动画用的 cinematic 帧。
   *
   * 三条曲线逐字取自上游 main.ts:922-924（ease 是那里同名函数的
   * smoothstep t²(3-2t)）：
   *     reveal = ease((t - 22)   / 0.4)      阵列浮现
   *     lift   = ease((t - 26)   / 1.8)      卡片抬起（本窗口内还是 0）
   *     zoom   = 0.55*ease((t-27.3)/1.65) + 0.45*ease((t-29)/5)
   *
   * 真正让阵列"飞进来"的是 time（上游叫 shot）：scene.js 里
   *     entryZ = -23 * (1 - clamp((shot-21.92)/0.75))²
   * 然后还有相机的三段轨道 orbit(22.6→24.2) / settle(24.25→26.5) /
   * pan(25.4→26.35)。所以这段不能提前截断，否则交回交互态时相机会跳。
   * 终点就用上游的 ARRAY_OPENING_END = 25.9（wallpaper-opening.ts）。
   */
  _cinematicAt(shot) {
    const ease = (v) => {
      const t = Math.max(0, Math.min(1, v));
      return t * t * (3 - 2 * t);
    };
    return {
      reveal: ease((shot - 22) / 0.4),
      lift: ease((shot - 26) / 1.8),
      zoom: 0.55 * ease((shot - 27.3) / 1.65) + 0.45 * ease((shot - 29) / 5),
      time: shot,
    };
  }

  /**
   * 开始入场动画。
   * 期间把场景切到 hidden 模式（targetReveal = 0），改由 cinematic 全权驱动 ——
   * 这正是上游的做法：开场时场景一直是 hidden，靠 bootFrame 喂帧。
   *
   * 全流程 = 21.9 → 35 秒处：
   *   21.9  阵列从远处飞入（entryZ）
   *   22.0  阵列浮现（reveal 0→1）
   *   22.6  镜头绕轨（orbit）
   *   24.25 镜头就位（settle）
   *   25.68 进入「选中」段
   *   26.0  卡片升起（lift 0→1）
   *   27.3  镜头推近 + 抽取特写（zoom / extractionCamera / earlyTurn）
   *   28.3  进入「检视」段
   *   35    落到检视态（上游这里就是 setMode("detail")）
   *
   * 曾经只跑到 ARRAY_OPENING_END = 25.9 就切回浏览态，两个后果：
   *   · 后面半段（卡片升起 + 镜头推近）整个没了；
   *   · settle 在 25.9 才走到 0.82，交回交互相机时镜头会跳一下。
   */
  _beginEntrance() {
    const s = this.scene;
    this.entrance = null;
    if (!s || this.reduced) return false;   // 减少动态效果：直接到位
    /* 全流程只放一次（上游的开场也是每次启动一次）。
       之后进课程清单直接到位 —— 否则每切一次栏都要等十秒。 */
    if (this.entrancePlayed) {
      s.setMode(this.detail ? 'detail' : 'archive');
      return false;
    }
    this.entrancePlayed = true;
    s.setMode('hidden');
    this.entrance = {
      at: 0,                                 // 第一帧才记时，免得建场景的时间也算进去
      from: 21.9,
      to: 35,                                // 上游 bootFrame 的终点（main.ts:925）
      shot: 21.9,
      dur: this.options.entranceMs == null ? 10000 : this.options.entranceMs,
    };
    return true;
  }

  /**
   * 结束入场（时间走完，或用户点击/按键打断）。
   *
   * 落点是检视态还是浏览态，看去到了哪一段：
   *   shot >= 30 —— 镜头已经推近、卡片在升起途中，落到检视态（上游 t>=35 就是 setMode("detail")）
   *   否则       —— 还在阵列飞入/就位阶段，落回浏览态
   * 这样无论自然放完还是中途打断，交接处都是连续的。
   */
  endEntrance() {
    const e = this.entrance;
    if (!e) return;
    this.entrance = null;
    /* 入场一律落在浏览态（archive），不按上游那条 shot>=30 的规则切 detail。
       上游把「抽出一张卡片做特写」当作开场的收尾演出，是因为官网的下一屏就是详情；
       这里不一样：课程清单是给人翻的，落在检视态等于一进列表就被怼到一张卡片的
       特写上、四周全被裁掉，而且 instance.detail 为真会把 ↑/↓ 与 Enter 一起挡掉
       （键盘守卫要求非检视态），表现就是"箭头怎么按都没反应"。
       要进检视请按 ACCESS FILE / Enter —— 那是用户的主动操作。 */
    if (this.scene) {
      this.detail = false;
      this.scene.setMode('archive');
    }
    if (this.clearGlass) this._keepGlassClear();
    if (this.options.onEntranceEnd) this.options.onEntranceEnd();
  }

  /** 入场进行中？ */
  get entering() { return !!this.entrance; }

  setReduced(value) {
    this.reduced = !!value;
    if (this.scene) this.scene.setReduced(this.reduced);
  }

  /**
   * 按容器实际尺寸对齐渲染缓冲。
   *
   * 这里必须自己去重：scene.resize() 会 setSize 渲染器与 composer，而 composer
   * 会重建每个后处理 pass 的 render target。拖动或最大化窗口时系统在一帧里能连发
   * 十几个 resize 事件，逐个照做就是把 framebuffer 反复重分配，界面自然跟不上。
   * 上游 main.ts:306 用 layoutKey 比较来挡住重复调用，这里按同样的思路做，
   * 并且把「容器尺寸 + 像素密度」当作键 —— 尺寸没变的 resize 直接跳过。
   */
  resize() {
    if (!this.scene) return;
    /* 容器被隐藏时宽高是 0（课程清单切到表格视图的那段时间）。
       这时若把渲染尺寸压到 0，相机的 aspect 会变成 0/0 —— 而且渲染器
       一旦按 0 尺寸重建过后处理 target，切回来还得再走一次完整重建。
       直接跳过，保留上一次的有效尺寸；容器恢复尺寸后 key 自然变化，会重新 resize。 */
    if (!this.container.clientWidth || !this.container.clientHeight) return;
    const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
    const key = this.container.clientWidth + 'x' + this.container.clientHeight + '@' + dpr;
    if (key === this._layout) return;
    this._layout = key;
    this.scene.resize();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    // 停在入场中途时把场景交回浏览态，免得下次进来还挂在 hidden 上
    if (this.entrance) {
      this.entrance = null;
      if (this.scene) this.scene.setMode('archive');
    }
  }

  dispose() {
    this.stop();
    if (this.container && this.container.removeEventListener) {
      this.container.removeEventListener('pointerdown', this._skip, true);
    }
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this._skip);
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
    this.loaded = false;
    this._layout = '';
    this.warmed = false;
  }

  _frame(now) {
    if (!this.running) return;
    if (this.scene) {
      try {
        // 放在 update() 之前：update 内部会按 clarity 设置材质，
        // 先钉在清晰态，同一帧就能用上，不用等下一帧。
        if (this.clearGlass) this._keepGlassClear();
        if (this.entrance) {
          if (!this.entrance.at) this.entrance.at = now;
          const k = Math.min(1, (now - this.entrance.at) / this.entrance.dur);
          const shot = this.entrance.from + (this.entrance.to - this.entrance.from) * k;
          this.entrance.shot = shot;      // endEntrance 靠它决定落到哪个态
          this.scene.update(now / 1000, this._cinematicAt(shot));
          if (k >= 1) this.endEntrance();
        } else {
          this.scene.update(now / 1000);
        }
      } catch (e) {
        // 渲染出错不要静默吞掉：报一次然后停下，避免每帧刷屏
        this.running = false;
        this.error = e;
        if (this.options.onError) this.options.onError(e);
        return;
      }
    }
    this.raf = requestAnimationFrame(this._frame);
  }

  /**
   * 诊断快照 —— 排查「场景在渲染但看不见」这类问题用。
   * 不是产品功能，只在控制台/自动化里调用。
   */
  diagnose() {
    const s = this.scene;
    if (!s) return { error: 'no scene' };
    const r = s.renderer;
    const cam = s.camera;
    const out = {
      loaded: this.loaded,
      running: this.running,
      frames: s.renderedFrames,
      reusedFrames: s.reusedFrames,
      presence: s.presence,
      presenceTarget: s.presenceTarget,
      reveal: s.reveal,
      targetReveal: s.targetReveal,
      selectedCell: s.selectedCell,
      canvas: {
        cssOpacity: r.domElement.style.opacity,
        clientW: r.domElement.clientWidth,
        clientH: r.domElement.clientHeight,
        bufW: r.domElement.width,
        bufH: r.domElement.height,
      },
      render: {
        calls: r.info.render.calls,
        triangles: r.info.render.triangles,
        frame: r.info.render.frame,
        autoClear: r.autoClear,
        clearAlpha: r.getClearAlpha(),
        clearColor: r.getClearColor(new RHINE_THREE.Color()).getHexString(),
      },
      camera: {
        aspect: cam.aspect,
        fov: cam.fov,
        near: cam.near,
        far: cam.far,
        position: cam.position.toArray(),
        aim: s.cameraAim ? s.cameraAim.toArray() : null,
      },
      lights: (() => {
        const list = [];
        s.scene.traverse((o) => {
          if (o.isLight) list.push({ type: o.type, intensity: o.intensity, visible: o.visible });
        });
        return list;
      })(),
      instanceCounts: (() => {
        const list = [];
        s.scene.traverse((o) => {
          if (o.isInstancedMesh) {
            list.push({
              name: o.name || '(unnamed)',
              count: o.count,
              capacity: o.instanceMatrix.count,
              visible: o.visible,
              frustumCulled: o.frustumCulled,
              hasBounds: !!o.boundingSphere,
            });
          }
        });
        return list;
      })(),
      meshCount: (() => {
        let n = 0;
        s.scene.traverse((o) => { if (o.isMesh) n++; });
        return n;
      })(),
    };
    return out;
  }
}

/** 只为 diagnose 里构造 Color 用；优先用全局 THREE */
const RHINE_THREE = (typeof window !== 'undefined' && window.THREE) || { Color: class { getHexString() { return '?'; } } };
